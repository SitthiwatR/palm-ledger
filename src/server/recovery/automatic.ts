import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Pool, PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createArchive } from "./data";
import {
  canonical,
  decryptArchive,
  encryptArchive,
  sha,
  type Row,
} from "./format";

export const RETENTION_DAYS = 7;
export const MAX_OFFSITE_BYTES = 350 * 1024 * 1024;
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;
export type Artifact = {
  id: string;
  name: string;
  size: number;
  expired: boolean;
  runId: string;
};
export interface Offsite {
  repository: string;
  assertPrivate(): Promise<void>;
  list(): Promise<Artifact[]>;
  upload(name: string, path: string): Promise<string>;
  download(id: string, path: string): Promise<string>;
}
async function tx<T>(
  pool: Pool,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
export function proofName(snapshot: string, id: string, attempt: number) {
  return `palm-ledger-verified-${Date.parse(snapshot)}-${id}-${attempt}`;
}
export function archiveName(id: string, attempt: number) {
  return `palm-ledger-archive-${id}-${attempt}`;
}
export function offsiteHealth(artifacts: Artifact[], now = Date.now()) {
  const candidates = artifacts
    .filter((a) => !a.expired && a.size > 0 && /^\d+$/.test(a.runId))
    .flatMap((a) => {
      const m =
        /^palm-ledger-verified-(\d{13})-([a-f0-9-]{36})-([1-9]\d*)$/.exec(
          a.name,
        );
      if (!m) return [];
      const timestamp = Number(m[1]);
      if (
        !Number.isSafeInteger(timestamp) ||
        timestamp > now + 300000 ||
        !artifacts.some(
          (b) =>
            !b.expired &&
            b.size > 0 &&
            b.name === archiveName(m[2], Number(m[3])) &&
            b.runId === a.runId,
        )
      )
        return [];
      return [
        {
          snapshotAt: new Date(timestamp).toISOString(),
          timestamp,
          runId: a.runId,
        },
      ];
    })
    .sort((a, b) => b.timestamp - a.timestamp);
  const latest = candidates[0];
  return {
    status: !latest
      ? "missing"
      : now - latest.timestamp > MAX_BACKUP_AGE_MS
        ? "stale"
        : "fresh",
    snapshotAt: latest?.snapshotAt ?? null,
    runId: latest?.runId ?? null,
  };
}
export async function automaticStatus(
  pool: Pool,
  owner: string,
  now = Date.now(),
) {
  const result = (
    await pool.query(
      `select
    (select to_jsonb(t)-'lease_token' from private.automatic_backup_runs t where owner_id=$1 order by slot desc limit 1) latest,
    (select to_jsonb(t)-'lease_token' from private.automatic_backup_runs t where owner_id=$1 and status='complete' order by snapshot_at desc limit 1) success`,
      [owner],
    )
  ).rows[0];
  const success = result.success ?? null,
    latest = result.latest ?? null;
  const stale =
    !success || now - Date.parse(success.snapshot_at) > MAX_BACKUP_AGE_MS;
  const failed =
    latest &&
    (latest.status === "failed" ||
      (latest.status === "running" && Date.parse(latest.lease_until) < now));
  return {
    state: !latest
      ? "not-configured"
      : failed
        ? "failed"
        : stale
          ? "stale"
          : "healthy",
    lastSuccess: success,
    latest,
    retentionDays: RETENTION_DAYS,
    maxAgeHours: 24,
  };
}
export function validateAutomaticSource(
  pool: Pool,
  env: Record<string, string | undefined>,
) {
  if (env.PALM_AUTOMATED_BACKUP !== "true")
    throw new Error("Automatic backup is not enabled");
  const url = new URL(env.SUPABASE_URL!),
    db = new URL(pool.options.connectionString!);
  if (
    env.PALM_TEST_ENVIRONMENT === "true" &&
    url.origin === "http://127.0.0.1:54421" &&
    db.hostname === "127.0.0.1" &&
    db.port === "54422"
  )
    return;
  const ref = "feotpdylvprtihgklndj";
  const ssl = pool.options.ssl;
  const strict =
    typeof ssl === "object" && ssl !== null && ssl.rejectUnauthorized !== false;
  if (
    url.origin !== `https://${ref}.supabase.co` ||
    !(
      db.hostname === `db.${ref}.supabase.co` ||
      (db.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(db.username) === `postgres.${ref}`)
    ) ||
    ssl === false ||
    (typeof ssl === "object" && ssl?.rejectUnauthorized === false) ||
    (!strict && db.searchParams.get("sslmode") !== "verify-full") ||
    (db.searchParams.has("sslmode") &&
      db.searchParams.get("sslmode") !== "verify-full")
  )
    throw new Error("Automatic backup source/project/TLS mismatch");
}
export async function runAutomaticBackup(options: {
  db: Pool;
  storage: SupabaseClient;
  sourceUrl: string;
  password: string;
  offsite: Offsite;
  runId: string;
}) {
  const { db, storage, sourceUrl, password, offsite, runId } = options;
  if (
    password.length < 32 ||
    password.length > 256 ||
    !/^\d+$/.test(runId) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(offsite.repository)
  )
    throw new Error("Invalid automatic backup configuration");
  await offsite.assertPrivate();
  const files = await offsite.list();
  const token = randomUUID();
  const job = await tx(db, async (client) => {
    const owners = (
      await client.query(
        "select id from public.owner_accounts order by id for share",
      )
    ).rows;
    if (owners.length !== 1) throw new Error("Expected one owner");
    const owner = owners[0].id;
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      "automatic-backup:" + owner,
    ]);
    const existing = (
      await client.query(
        "select * from private.automatic_backup_runs where owner_id=$1 and slot=(now() at time zone 'UTC')::date for update",
        [owner],
      )
    ).rows[0];
    if (existing?.status === "complete") return { ...existing, skip: true };
    if (
      existing?.status === "running" &&
      Date.parse(existing.lease_until) > Date.now()
    )
      return { ...existing, busy: true };
    return (
      await client.query(
        "insert into private.automatic_backup_runs(owner_id,slot,destination_repository,status,lease_token,lease_until,workflow_run_id) values($1,(now() at time zone 'UTC')::date,$2,'running',$3,now()+interval '30 minutes',$4) on conflict(owner_id,slot) do update set destination_repository=excluded.destination_repository,status='running',attempt=automatic_backup_runs.attempt+1,lease_token=excluded.lease_token,lease_until=excluded.lease_until,started_at=now(),workflow_run_id=excluded.workflow_run_id,error_code=null returning *",
        [owner, offsite.repository, token, runId],
      )
    ).rows[0];
  });
  if (job.skip || job.busy)
    return { status: job.skip ? "already-complete" : "running", id: job.id };
  let directory: string | undefined;
  try {
    // Reserve enough space before downloading any sensitive source data. Never
    // delete a previous good backup to make room for a failing new attempt.
    if (
      files.filter((f) => !f.expired).reduce((n, f) => n + f.size, 0) +
        40 * 1024 * 1024 +
        16384 >
      MAX_OFFSITE_BYTES
    )
      throw new Error("Offsite quota guard");
    const archive = await createArchive(db, storage, job.owner_id, sourceUrl);
    const bytes = await encryptArchive(archive, password);
    const expected = sha(bytes);
    directory = await mkdtemp(join(tmpdir(), "palm-automatic-"));
    const path = join(directory, "backup.palmbackup");
    await writeFile(path, bytes, { mode: 0o600 });
    const artifactId = await offsite.upload(
      archiveName(job.id, job.attempt),
      path,
    );
    const restoredPath = await offsite.download(
      artifactId,
      join(directory, "verify"),
    );
    const downloaded = await readFile(restoredPath);
    if (sha(downloaded) !== expected)
      throw new Error("Offsite checksum mismatch");
    const checked = await decryptArchive(downloaded, password);
    if (canonical(checked) !== canonical(archive))
      throw new Error("Offsite snapshot mismatch");
    const proofPath = join(directory, "receipt.json");
    await writeFile(
      proofPath,
      JSON.stringify({
        format: "palm-ledger-offsite-proof",
        version: 1,
        jobId: job.id,
        attempt: job.attempt,
        snapshotAt: checked.createdAt,
        sha256: expected,
        artifactId,
        runId,
      }),
      { mode: 0o600 },
    );
    const proofId = await offsite.upload(
      proofName(checked.createdAt, job.id, job.attempt),
      proofPath,
    );
    if (!/^\d+$/.test(artifactId) || !/^\d+$/.test(proofId))
      throw new Error("Invalid offsite receipt");
    await tx(db, async (client) => {
      const done = await client.query(
        "update private.automatic_backup_runs set status='complete',completed_at=now(),snapshot_at=$3,sha256=$4,size_bytes=$5,artifact_id=$6,proof_artifact_id=$7 where id=$1 and lease_token=$2 and status='running' and lease_until>now() returning id",
        [
          job.id,
          token,
          checked.createdAt,
          expected,
          bytes.length,
          artifactId,
          proofId,
        ],
      );
      if (!done.rowCount) throw new Error("Automatic backup lease changed");
      await client.query(
        "insert into public.audit_events(owner_id,action,entity_id,after_data) values($1,'backup.automatic_completed',$2,$3)",
        [
          job.owner_id,
          job.id,
          JSON.stringify({
            snapshot: checked.createdAt,
            sha256: expected,
            artifactId,
            proofId,
            repository: offsite.repository,
          }),
        ],
      );
    });
    return {
      status: "complete",
      id: job.id,
      artifactId,
      snapshotAt: checked.createdAt,
    };
  } catch {
    await db.query(
      "update private.automatic_backup_runs set status='failed',error_code='BACKUP_FAILED' where id=$1 and lease_token=$2 and status='running'",
      [job.id, token],
    );
    throw new Error("Automatic backup failed; no earlier backup was replaced");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
