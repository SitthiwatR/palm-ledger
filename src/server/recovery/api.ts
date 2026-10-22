import "server-only";
import { randomUUID, createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, audit, supabase, type Owner } from "../auth";
import { pool, transaction } from "../db";
import {
  createArchive,
  readData,
  businessHash,
  insertRows,
  insertOrder,
} from "./data";
import {
  canonical,
  sha,
  passphrase,
  encryptArchive,
  decryptArchive,
  MAX_ARCHIVE,
  summarize,
  type Row,
} from "./format";
import { convertPrototype } from "./prototype";
import { trackObject, cleanupExpired } from "./storage";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function bad(message: string, code = "TRANSFER_INVALID", status = 422): never {
  throw new AppError(status, code, message);
}
const key = (req: NextRequest) =>
  z.uuid().parse(req.headers.get("idempotency-key"));
async function ownerLock(db: PoolClient, owner: Owner, exclusive = false) {
  const row = (
    await db.query(
      `select auth_epoch from public.owner_accounts where id=$1 for ${exclusive ? "update" : "share"}`,
      [owner.id],
    )
  ).rows[0];
  if (!row || row.auth_epoch !== owner.auth_epoch)
    bad("กรุณาเข้าสู่ระบบใหม่", "SESSION_EXPIRED", 401);
}
function fingerprint(
  owner: Owner,
  requestKey: string,
  resource: string,
  input: unknown,
) {
  return createHmac(
    "sha256",
    Buffer.from(process.env.SESSION_ENCRYPTION_KEY!, "hex"),
  )
    .update(resource + owner.id + requestKey + canonical(input))
    .digest("hex");
}
async function replay(
  db: Pick<PoolClient, "query">,
  owner: Owner,
  requestKey: string,
  hash: string,
) {
  const row = (
    await db.query(
      "select request_hash,response from private.idempotency_requests where owner_id=$1 and key=$2",
      [owner.id, requestKey],
    )
  ).rows[0];
  if (row && row.request_hash !== hash)
    bad("รหัสคำขอใช้กับข้อมูลอื่นแล้ว", "IDEMPOTENCY_CONFLICT", 409);
  return row?.response;
}
async function remember(
  db: PoolClient,
  owner: Owner,
  requestKey: string,
  hash: string,
  response: unknown,
) {
  await db.query(
    "insert into private.idempotency_requests(owner_id,key,request_hash,response) values($1,$2,$3,$4) on conflict(owner_id,key) do nothing",
    [owner.id, requestKey, hash, JSON.stringify(response)],
  );
}
async function recordedResult(
  owner: Owner,
  requestKey: string,
  hash: string,
  result: unknown,
) {
  return transaction(async (db) => {
    await ownerLock(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + requestKey,
    ]);
    const prior = await replay(db, owner, requestKey, hash);
    if (prior) return prior;
    await remember(db, owner, requestKey, hash, result);
    return result;
  });
}
async function signed(job: Row) {
  const result = await supabase(true)
    .storage.from("palm-transfers")
    .createSignedUrl(job.storage_key, 300, {
      download:
        job.kind === "prototype"
          ? "palm-prototype.json"
          : "palm-ledger.palmbackup",
    });
  if (result.error)
    bad("เปิดชุดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง", "STORAGE_UNAVAILABLE", 503);
  return {
    id: job.id,
    status: job.status,
    summary: job.summary,
    sizeBytes: job.size_bytes,
    url: result.data!.signedUrl,
    expiresIn: 300,
  };
}
async function getJob(owner: Owner, id: string) {
  const job = (
    await pool().query(
      "select * from private.transfer_jobs where id=$1 and owner_id=$2 and expires_at>now()",
      [id, owner.id],
    )
  ).rows[0];
  if (!job) bad("ไม่พบชุดข้อมูลหรือหมดอายุแล้ว", "NOT_FOUND", 404);
  return job;
}
async function objectBytes(job: Row) {
  const result = await supabase(true)
    .storage.from("palm-transfers")
    .download(job.storage_key);
  if (result.error || !result.data)
    bad("อัปโหลดชุดข้อมูลไม่ครบ กรุณาลองส่งไฟล์เดิมใหม่");
  if (result.data.size !== job.size_bytes || result.data.size > MAX_ARCHIVE)
    bad("ขนาดชุดข้อมูลไม่ตรงที่แจ้ง");
  return Buffer.from(await result.data.arrayBuffer());
}
type Dependencies = {
  body: (req: NextRequest) => Promise<unknown>;
  checkImage: (bytes: Buffer, mime: string) => boolean;
};
async function backup(req: NextRequest, owner: Owner, deps: Dependencies) {
  const input = z
      .object({ passphrase })
      .strict()
      .parse(await deps.body(req)),
    requestKey = key(req),
    fingerprint = createHmac(
      "sha256",
      Buffer.from(process.env.SESSION_ENCRYPTION_KEY!, "hex"),
    )
      .update("palm-backup:" + owner.id + requestKey + canonical(input))
      .digest("hex"),
    token = randomUUID();
  const job = await transaction(async (db) => {
    await ownerLock(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + requestKey,
    ]);
    await replay(db, owner, requestKey, fingerprint);
    let job = (
      await db.query(
        "select * from private.transfer_jobs where owner_id=$1 and request_key=$2 for update",
        [owner.id, requestKey],
      )
    ).rows[0];
    if (job) {
      if (job.request_hash !== fingerprint || job.kind !== "backup")
        bad("รหัสคำขอใช้กับข้อมูลอื่นแล้ว", "IDEMPOTENCY_CONFLICT", 409);
      if (job.status === "ready") return job;
      if (
        job.status === "processing" &&
        new Date(job.lease_until).getTime() > Date.now()
      )
        return job;
    }
    const id = job?.id ?? randomUUID(),
      storageKey = `${owner.id}/backups/${id}/${token}`;
    job = (
      await db.query(
        "insert into private.transfer_jobs(id,owner_id,request_key,request_hash,kind,status,storage_key,size_bytes,lease_token,lease_until) values($1,$2,$3,$4,'backup','processing',$5,1,$6,now()+interval '5 minutes') on conflict(owner_id,request_key) do update set status='processing',storage_key=excluded.storage_key,lease_token=excluded.lease_token,lease_until=excluded.lease_until returning *",
        [id, owner.id, requestKey, fingerprint, storageKey, token],
      )
    ).rows[0];
    await remember(db, owner, requestKey, fingerprint, { transferId: job.id });
    return job;
  });
  if (job.status === "ready") return json(await signed(job));
  if (job.lease_token !== token)
    return json({ id: job.id, status: "processing" }, 202);
  let uploaded = false,
    committed = false;
  try {
    await trackObject(
      pool(),
      job.id,
      owner.id,
      "palm-transfers",
      job.storage_key,
      7,
    );
    const archive = await createArchive(
      pool(),
      supabase(true),
      owner.id,
      process.env.SUPABASE_URL!,
    );
    const bytes = await encryptArchive(archive, input.passphrase);
    const upload = await supabase(true)
      .storage.from("palm-transfers")
      .upload(job.storage_key, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (upload.error) throw new Error("Upload failed");
    uploaded = true;
    const done = await transaction(async (db) => {
      await ownerLock(db, owner);
      const row = (
        await db.query(
          "update private.transfer_jobs set status='ready',size_bytes=$4,object_hash=$5,summary=$6,lease_until=null where id=$1 and owner_id=$2 and lease_token=$3 and status='processing' returning *",
          [
            job.id,
            owner.id,
            token,
            bytes.length,
            sha(bytes),
            JSON.stringify(archive.manifest.summary),
          ],
        )
      ).rows[0];
      if (!row)
        bad("คำขอนี้ถูกเริ่มใหม่ กรุณาโหลดสถานะล่าสุด", "TRANSFER_RETRY", 409);
      await audit(db, owner.id, "backup.created", job.id, null, {
        checksum: sha(bytes),
        summary: archive.manifest.summary,
        snapshot: archive.createdAt,
      });
      return row;
    });
    committed = true;
    return json(await signed(done));
  } catch (error) {
    if (uploaded && !committed)
      await supabase(true)
        .storage.from("palm-transfers")
        .remove([job.storage_key]);
    if (!committed)
      await pool().query(
        "update private.transfer_jobs set status='failed',lease_until=null where id=$1 and owner_id=$2 and lease_token=$3 and status='processing'",
        [job.id, owner.id, token],
      );
    if (error instanceof AppError) throw error;
    bad(
      error instanceof Error && /รูป|ขนาด|ชุดสำรอง/.test(error.message)
        ? error.message
        : "สร้างชุดสำรองไม่สำเร็จ กรุณาลองอีกครั้ง",
      "BACKUP_FAILED",
      503,
    );
  }
}
async function upload(req: NextRequest, owner: Owner, deps: Dependencies) {
  const input = z
    .object({
      kind: z.enum(["restore", "prototype"]),
      sizeBytes: z.number().int().min(1).max(MAX_ARCHIVE),
    })
    .strict()
    .parse(await deps.body(req));
  if (input.kind === "prototype" && input.sizeBytes > 15 * 1024 * 1024)
    bad("JSON ต้นแบบต้องไม่เกิน 15 MB");
  const requestKey = key(req),
    fingerprint = sha(canonical(input));
  const job = await transaction(async (db) => {
    await ownerLock(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + requestKey,
    ]);
    await replay(db, owner, requestKey, fingerprint);
    const existing = (
      await db.query(
        "select * from private.transfer_jobs where owner_id=$1 and request_key=$2",
        [owner.id, requestKey],
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== fingerprint)
        bad("รหัสคำขอใช้กับข้อมูลอื่นแล้ว", "IDEMPOTENCY_CONFLICT", 409);
      if (new Date(existing.expires_at).getTime() < Date.now())
        bad("ชุดอัปโหลดหมดอายุแล้ว");
      return existing;
    }
    const id = randomUUID();
    const created = (
      await db.query(
        "insert into private.transfer_jobs(id,owner_id,request_key,request_hash,kind,status,storage_key,size_bytes,expires_at) values($1,$2,$3,$4,$5,'pending',$6,$7,now()+interval '24 hours') returning *",
        [
          id,
          owner.id,
          requestKey,
          fingerprint,
          input.kind,
          `${owner.id}/uploads/${id}`,
          input.sizeBytes,
        ],
      )
    ).rows[0];
    await remember(db, owner, requestKey, fingerprint, {
      transferId: created.id,
    });
    return created;
  });
  await trackObject(
    pool(),
    job.id,
    owner.id,
    "palm-transfers",
    job.storage_key,
    1,
  );
  if (job.status !== "pending") return json({ id: job.id, status: job.status });
  // A failed preview (for example a wrong passphrase) must reuse the immutable
  // object. Storage refuses another upload token once that path already exists.
  const present = await supabase(true)
    .storage.from("palm-transfers")
    .exists(job.storage_key);
  if (present.data) return json({ id: job.id, status: "uploaded" });
  const result = await supabase(true)
    .storage.from("palm-transfers")
    .createSignedUploadUrl(job.storage_key, { upsert: false });
  if (result.error) bad("เตรียมอัปโหลดไม่สำเร็จ", "STORAGE_UNAVAILABLE", 503);
  return json({
    id: job.id,
    path: result.data!.path,
    token: result.data!.token,
    bucket: "palm-transfers",
    supabaseUrl: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  });
}
async function inspect(
  job: Row,
  bytes: Buffer,
  password: string | undefined,
  owner: Owner,
  deps: Dependencies,
) {
  if (job.kind === "restore") {
    if (!password) bad("กรุณากรอกรหัสชุดสำรอง");
    const archive = await decryptArchive(bytes, password);
    const migrations = (
      await pool().query(
        "select name,checksum from private.schema_migrations order by name",
      )
    ).rows;
    if (canonical(migrations) !== canonical(archive.migrations))
      bad("เวอร์ชันชุดสำรองไม่ตรงระบบนี้");
    return {
      kind: "restore" as const,
      archive,
      summary: {
        ...archive.manifest.summary,
        snapshot: archive.createdAt,
        username: archive.data.owner_accounts[0].username,
        warnings: [
          "กู้คืนในระบบใหม่ที่ว่างและตรวจบัญชี/รูปก่อนสลับใช้งาน",
          "ต้องเข้าสู่ระบบใหม่หลังคืนบัญชี ไม่ใช้ tokens จากโครงการเดิม",
        ],
      },
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    bad("JSON ต้นแบบไม่ถูกต้อง");
  }
  const converted = convertPrototype(value, owner.id, deps.checkImage);
  const existing = (
    await pool().query(
      "select entity_type,legacy_id from private.legacy_imports where owner_id=$1",
      [owner.id],
    )
  ).rows;
  if (
    converted.mapping.some((m) =>
      existing.some(
        (e) => e.entity_type === m.type && e.legacy_id === m.legacyId,
      ),
    )
  )
    bad("พบ ID ที่เคยนำเข้าแล้ว ไม่สร้างรายการซ้ำ", "IMPORT_DUPLICATE", 409);
  const db = await pool().connect();
  let current;
  try {
    await db.query("begin isolation level repeatable read read only");
    current = await readData(db, owner.id);
    await db.query("commit");
  } finally {
    db.release();
  }
  if (
    converted.state.gardens.some((g) =>
      current.gardens.some(
        (e) => e.name.toLowerCase() === g.name.toLowerCase() || e.id === g.id,
      ),
    )
  )
    bad(
      "ชื่อหรือ ID สวนมีอยู่แล้ว กรุณาตรวจต้นแบบก่อนนำเข้า",
      "IMPORT_DUPLICATE",
      409,
    );
  if (
    converted.state.records.some((r) =>
      [
        ...current.sales,
        ...current.expenses,
        ...current.sale_labor,
        ...current.opening_debts,
      ].some((e) => e.id === r.id),
    )
  )
    bad("ID รายการมีอยู่แล้ว", "IMPORT_DUPLICATE", 409);
  const before = summarize(current),
    delta = converted.summary;
  return {
    kind: "prototype" as const,
    converted,
    baseline: businessHash(current),
    summary: {
      ...delta,
      demo: converted.state.demo,
      warnings: converted.warnings,
      before: { netMinor: before.netMinor, pendingMinor: before.pendingMinor },
      after: {
        netMinor: before.netMinor + delta.netMinor,
        pendingMinor: before.pendingMinor + delta.pendingMinor,
      },
      gardenNames: converted.state.gardens.map((g) => g.name),
    },
  };
}
async function preview(
  req: NextRequest,
  owner: Owner,
  id: string,
  deps: Dependencies,
) {
  const input = z
      .object({ passphrase: passphrase.optional() })
      .strict()
      .parse(await deps.body(req)),
    job = await getJob(owner, id);
  if (
    !["restore", "prototype"].includes(job.kind) ||
    job.status === "confirmed"
  )
    bad("ชุดข้อมูลนี้ตรวจหรือยืนยันแล้วไม่ได้");
  const bytes = await objectBytes(job);
  let parsed: Awaited<ReturnType<typeof inspect>>;
  try {
    parsed = await inspect(job, bytes, input.passphrase, owner, deps);
  } catch (e) {
    if (e instanceof AppError) throw e;
    bad(e instanceof Error ? e.message : "ตรวจชุดข้อมูลไม่สำเร็จ");
  }
  const objectHash = sha(bytes),
    previewHash = sha(objectHash + canonical(parsed.summary));
  await transaction(async (db) => {
    await ownerLock(db, owner);
    const updated = await db.query(
      "update private.transfer_jobs set status='ready',object_hash=$3,preview_hash=$4,baseline_hash=$5,summary=$6 where id=$1 and owner_id=$2 and status<>'confirmed' and expires_at>now()",
      [
        id,
        owner.id,
        objectHash,
        previewHash,
        parsed.kind === "prototype" ? parsed.baseline : null,
        JSON.stringify(parsed.summary),
      ],
    );
    if (!updated.rowCount)
      bad("ชุดข้อมูลเปลี่ยนหรือหมดอายุ", "STALE_PREVIEW", 409);
    await audit(db, owner.id, "recovery.previewed", id, null, {
      kind: job.kind,
      checksum: objectHash,
      summary: parsed.summary,
    });
  });
  return json({ id, kind: job.kind, previewHash, summary: parsed.summary });
}
async function confirm(
  req: NextRequest,
  owner: Owner,
  id: string,
  deps: Dependencies,
) {
  const input = z
      .object({
        previewHash: z.string().regex(/^[a-f0-9]{64}$/),
        acknowledge: z.literal(true),
        allowDemo: z.boolean().default(false),
        passphrase: passphrase.optional(),
      })
      .strict()
      .parse(await deps.body(req)),
    requestKey = key(req),
    job = await getJob(owner, id);
  const requestHash = fingerprint(owner, requestKey, "confirm:" + id, input);
  const previous = await replay(pool(), owner, requestKey, requestHash);
  if (previous) return json(previous);
  if (job.status === "confirmed") {
    if (job.preview_hash !== input.previewHash)
      bad("ตัวอย่างข้อมูลเปลี่ยน", "STALE_PREVIEW", 409);
    return json(
      await recordedResult(owner, requestKey, requestHash, job.result),
    );
  }
  if (job.status !== "ready" || job.preview_hash !== input.previewHash)
    bad("กรุณาตรวจตัวอย่างข้อมูลล่าสุดก่อนยืนยัน", "STALE_PREVIEW", 409);
  const bytes = await objectBytes(job);
  if (sha(bytes) !== job.object_hash)
    bad("ไฟล์เปลี่ยนหลังตรวจ ไม่ใช้ตัวอย่างเดิม", "STALE_PREVIEW", 409);
  let parsed: Awaited<ReturnType<typeof inspect>>;
  try {
    parsed = await inspect(job, bytes, input.passphrase, owner, deps);
  } catch (e) {
    const latest = await getJob(owner, id);
    if (
      latest.status === "confirmed" &&
      latest.preview_hash === input.previewHash
    )
      return json(
        await recordedResult(owner, requestKey, requestHash, latest.result),
      );
    if (e instanceof AppError) throw e;
    bad(e instanceof Error ? e.message : "ตรวจชุดข้อมูลไม่สำเร็จ");
  }
  if (
    parsed.kind === "prototype" &&
    parsed.converted.state.demo &&
    !input.allowDemo
  )
    bad(
      "ไฟล์นี้เป็นข้อมูลตัวอย่าง ต้องยืนยันแยกก่อนนำเข้า",
      "DEMO_CONFIRMATION",
    );
  if (parsed.kind === "restore") {
    const result = {
      id,
      status: "verified-for-new-environment",
      summary: parsed.summary,
      requiresNewLogin: true,
    };
    await transaction(async (db) => {
      await ownerLock(db, owner);
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        owner.id + requestKey,
      ]);
      await replay(db, owner, requestKey, requestHash);
      const row = (
        await db.query(
          "select * from private.transfer_jobs where id=$1 and owner_id=$2 for update",
          [id, owner.id],
        )
      ).rows[0];
      if (row.status === "confirmed") {
        await remember(db, owner, requestKey, requestHash, row.result);
        return;
      }
      if (row.preview_hash !== input.previewHash)
        bad("ตัวอย่างเปลี่ยน", "STALE_PREVIEW", 409);
      await db.query(
        "update private.transfer_jobs set status='confirmed',result=$3 where id=$1 and owner_id=$2",
        [id, owner.id, JSON.stringify(result)],
      );
      await remember(db, owner, requestKey, requestHash, result);
      await audit(db, owner.id, "recovery.verified", id, null, {
        checksum: job.object_hash,
        summary: parsed.summary,
        requestKey,
      });
    });
    return json(result);
  }
  const converted = parsed.converted,
    uploaded: string[] = [];
  try {
    // Stage immutable photos first. A failed financial transaction leaves only
    // temporary private objects, which are removed here; no half ledger rows.
    for (const f of converted.photos) {
      await trackObject(pool(), job.id, owner.id, "palm-receipts", f.key, 1);
      const up = await supabase(true)
        .storage.from("palm-receipts")
        .upload(f.key, f.bytes, { contentType: f.mime, upsert: false });
      if (up.error)
        bad("จัดเก็บรูปต้นแบบไม่สำเร็จ", "STORAGE_UNAVAILABLE", 503);
      uploaded.push(f.key);
      const read = await supabase(true)
        .storage.from("palm-receipts")
        .download(f.key);
      if (
        read.error ||
        sha(new Uint8Array(await read.data!.arrayBuffer())) !== f.sha256
      )
        bad("รูปต้นแบบหลังจัดเก็บตรวจไม่ผ่าน");
    }
    const result = await transaction(async (db) => {
      await ownerLock(db, owner, true);
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        owner.id + requestKey,
      ]);
      const old = await replay(db, owner, requestKey, requestHash);
      if (old) return { response: old, replayed: true };
      const current = (
        await db.query(
          "select * from private.transfer_jobs where id=$1 and owner_id=$2 for update",
          [id, owner.id],
        )
      ).rows[0];
      if (current.status === "confirmed") {
        await remember(db, owner, requestKey, requestHash, current.result);
        return { response: current.result, replayed: true };
      }
      if (
        current.preview_hash !== input.previewHash ||
        current.baseline_hash !== businessHash(await readData(db, owner.id))
      )
        bad(
          "ข้อมูลปัจจุบันเปลี่ยน กรุณาตรวจตัวอย่างใหม่ก่อนนำเข้า",
          "STALE_PREVIEW",
          409,
        );
      const prior = (
        await db.query(
          "select entity_type,legacy_id from private.legacy_imports where owner_id=$1",
          [owner.id],
        )
      ).rows;
      if (
        converted.mapping.some((m) =>
          prior.some(
            (p) => p.entity_type === m.type && p.legacy_id === m.legacyId,
          ),
        )
      )
        bad("ID นี้เคยนำเข้าแล้ว", "IMPORT_DUPLICATE", 409);
      if (new Date(current.expires_at).getTime() <= Date.now())
        bad("ชุดนำเข้าหมดอายุแล้ว", "STALE_PREVIEW", 409);
      for (const table of insertOrder)
        await insertRows(db, "public." + table, converted.data[table]);
      for (const m of converted.mapping)
        await db.query(
          "insert into private.legacy_imports(owner_id,entity_type,legacy_id,target_id,transfer_id) values($1,$2,$3,$4,$5)",
          [owner.id, m.type, m.legacyId, m.id, id],
        );
      if (converted.photos.length)
        await db.query(
          "delete from private.transfer_objects where owner_id=$1 and storage_key=any($2::text[])",
          [owner.id, converted.photos.map((f) => f.key)],
        );
      const after = summarize(await readData(db, owner.id));
      if (
        after.netMinor !== parsed.summary.after.netMinor ||
        after.pendingMinor !== parsed.summary.after.pendingMinor
      )
        bad("ยอดหลังนำเข้าไม่ตรงตัวอย่าง ไม่บันทึก");
      const response = {
        id,
        status: "imported",
        summary: converted.summary,
        after: { netMinor: after.netMinor, pendingMinor: after.pendingMinor },
      };
      await audit(
        db,
        owner.id,
        "prototype.imported",
        id,
        parsed.summary.before,
        {
          ...response,
          sourceHash: converted.sourceHash,
          demo: converted.state.demo,
          requestKey,
        },
      );
      await db.query(
        "update private.transfer_jobs set status='confirmed',result=$3 where id=$1 and owner_id=$2",
        [id, owner.id, JSON.stringify(response)],
      );
      await remember(db, owner, requestKey, requestHash, response);
      return { response, replayed: false };
    });
    if (result.replayed && uploaded.length)
      await supabase(true).storage.from("palm-receipts").remove(uploaded);
    return json(result.response);
  } catch (e) {
    if (uploaded.length)
      await supabase(true).storage.from("palm-receipts").remove(uploaded);
    throw e;
  }
}
export async function transferRoutes(
  req: NextRequest,
  owner: Owner,
  path: string[],
  deps: Dependencies,
): Promise<NextResponse | undefined> {
  if (!["backups", "recoveries"].includes(path[0])) return;
  if (req.method === "POST")
    await cleanupExpired(pool(), supabase(true), owner.id);
  if (path.length === 1 && path[0] === "backups" && req.method === "POST")
    return backup(req, owner, deps);
  if (path.length === 1 && path[0] === "backups" && req.method === "GET") {
    const jobs = (
      await pool().query(
        "select id,kind,status,summary,size_bytes,created_at,expires_at from private.transfer_jobs where owner_id=$1 and expires_at>now() order by created_at desc limit 30",
        [owner.id],
      )
    ).rows;
    return json({ jobs });
  }
  if (path.join("/") === "recoveries/upload-url" && req.method === "POST")
    return upload(req, owner, deps);
  if (path.length === 2 && path[0] === "backups" && req.method === "GET") {
    const job = await getJob(owner, z.uuid().parse(path[1]));
    return json(
      ["ready", "confirmed"].includes(job.status)
        ? await signed(job)
        : { id: job.id, status: job.status },
    );
  }
  if (path.length === 3 && path[0] === "recoveries" && req.method === "POST") {
    const id = z.uuid().parse(path[1]);
    if (path[2] === "preview") return preview(req, owner, id, deps);
    if (path[2] === "confirm") return confirm(req, owner, id, deps);
  }
}
