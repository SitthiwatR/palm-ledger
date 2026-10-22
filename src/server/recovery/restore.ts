import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonical,
  decryptArchive,
  sha,
  summarize,
  tables,
  type Data,
} from "./format";
import { insertOrder, insertRows, readData } from "./data";
export function assertRecoveryTarget(db: Pool, urlText: string) {
  const url = new URL(urlText),
    options = (
      db as unknown as {
        options: {
          connectionString?: string;
          ssl?: { rejectUnauthorized?: boolean } | boolean;
        };
      }
    ).options;
  if (!options.connectionString)
    throw new Error("ปลายทางต้องระบุ database URL ชัดเจน");
  const database = new URL(options.connectionString);
  if (url.hostname === "feotpdylvprtihgklndj.supabase.co")
    throw new Error("ห้ามกู้คืนหรือเตรียม schema บน production");
  if (
    url.hostname === "127.0.0.1" &&
    database.hostname === "127.0.0.1" &&
    Number(database.port) === Number(url.port) + 1
  )
    return;
  const ref = url.hostname.split(".")[0];
  if (
    url.protocol !== "https:" ||
    !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(urlText) ||
    !(
      database.hostname === `db.${ref}.supabase.co` ||
      (decodeURIComponent(database.username) === `postgres.${ref}` &&
        database.hostname.endsWith(".pooler.supabase.com"))
    )
  )
    throw new Error("ฐานข้อมูลและ Supabase ปลายทางไม่ตรงโครงการ");
  const mode = database.searchParams.get("sslmode");
  if (
    options.ssl === false ||
    (typeof options.ssl === "object" &&
      options.ssl?.rejectUnauthorized === false) ||
    (mode && mode !== "verify-full")
  )
    throw new Error("ปลายทางต้องใช้ TLS พร้อมตรวจ certificate");
  const strict =
    typeof options.ssl === "object" &&
    options.ssl !== null &&
    options.ssl.rejectUnauthorized !== false;
  if (!strict && database.searchParams.get("sslmode") !== "verify-full")
    throw new Error(
      "ปลายทางต้องใช้ TLS พร้อมตรวจ certificate ห้ามปิด TLS verification",
    );
}
export async function restoreToEmptyEnvironment(
  bytes: Buffer,
  password: string,
  target: { db: Pool; storage: SupabaseClient; url: string; enabled: boolean },
  commit: boolean,
) {
  const archive = await decryptArchive(bytes, password);
  const url = new URL(target.url);
  if (
    !target.enabled ||
    url.hostname === "feotpdylvprtihgklndj.supabase.co" ||
    target.url.replace(/\/$/, "") === archive.sourceProject.replace(/\/$/, "")
  )
    throw new Error(
      "กู้คืนได้เฉพาะระบบใหม่ที่ระบุเป็น recovery target ห้ามใช้ production หรือระบบต้นทาง",
    );
  assertRecoveryTarget(target.db, target.url);
  const db = await target.db.connect(),
    uploaded: { bucket: string; key: string }[] = [];
  const cleanup = async () => {
    for (const f of uploaded)
      await target.storage.storage.from(f.bucket).remove([f.key]);
  };
  try {
    await db.query("begin");
    await db.query("set local timezone to 'UTC'");
    await db.query("select pg_advisory_xact_lock(1926020)");
    const buckets = (
      await db.query(
        "select id,public from storage.buckets where id in ('palm-receipts','palm-transfers') for share",
      )
    ).rows;
    if (buckets.length !== 2 || buckets.some((b) => b.public))
      throw new Error(
        "ปลายทางต้องมี private buckets ทั้งรูปและชุดสำรองก่อนกู้คืน",
      );
    await db.query(
      "lock table " +
        tables.map((t) => "public." + t).join(",") +
        " in access exclusive mode",
    );
    for (const table of tables)
      if (
        (await db.query(`select exists(select 1 from public.${table}) present`))
          .rows[0].present
      )
        throw new Error(
          "ปลายทางมีข้อมูลแล้ว ไม่แทนข้อมูลเดิม กรุณาใช้ระบบใหม่ที่ว่าง",
        );
    if (
      (await db.query("select exists(select 1 from auth.users) present"))
        .rows[0].present
    )
      throw new Error("ปลายทางมีบัญชีแล้ว ไม่แทนบัญชีหรือรหัสเดิม");
    const migrations = (
      await db.query(
        "select name,checksum from private.schema_migrations order by name",
      )
    ).rows;
    if (canonical(migrations) !== canonical(archive.migrations))
      throw new Error(
        "เวอร์ชัน/migration ปลายทางไม่ตรงชุดสำรอง กรุณาใช้ code version เดียวกัน",
      );
    const owner = archive.data.owner_accounts[0].id,
      job = randomUUID();
    const recoveredData = structuredClone(archive.data);
    const files = archive.files.map((f) => ({
      ...f,
      originalKey: f.key,
      key: `${owner}/recovered/${job}/${f.id}`,
    }));
    for (const f of files)
      recoveredData.receipt_files.find((r) => r.id === f.id)!.storage_key =
        f.key;

    // Triggers enforcing immutable *history* cannot accept an already-voided
    // historical payment as a new write. Only in this locked, empty recovery DB,
    // suspend USER triggers transactionally; FK/CHECK constraints remain enabled.
    // All history/attribution invariants are validated before and after loading.
    for (const table of tables)
      await db.query(`alter table public.${table} disable trigger user`);
    await insertRows(db, "auth.users", archive.auth.users);
    await insertRows(db, "auth.identities", archive.auth.identities);
    await insertRows(db, "public.owner_accounts", recoveredData.owner_accounts);
    for (const table of insertOrder)
      await insertRows(db, "public." + table, recoveredData[table]);
    for (const table of tables)
      await db.query(`alter table public.${table} enable trigger user`);
    const restored = await readData(db, owner);
    if (
      canonical(restored) !== canonical(recoveredData) ||
      canonical(summarize(restored)) !== canonical(archive.manifest.summary)
    )
      throw new Error("ข้อมูลหลังคืนไม่ตรง snapshot ไม่ commit");

    // Preview exercises the real database constraints and rolls everything back.
    if (!commit) {
      await db.query("rollback");
      return {
        status: "preview",
        summary: archive.manifest.summary,
        username: archive.data.owner_accounts[0].username,
        photos: archive.files.length,
        requiresNewLogin: true,
      };
    }
    await db.query(
      "select setval(pg_get_serial_sequence('public.audit_events','id'),coalesce((select max(id) from public.audit_events),0)+1,false)",
    );
    for (const f of files) {
      const result = await target.storage.storage
        .from("palm-receipts")
        .upload(f.key, Buffer.from(f.base64, "base64"), {
          contentType: f.mime,
          upsert: false,
        });
      if (result.error) throw new Error("คัดลอกรูปไม่สำเร็จ ไม่ commit");
      uploaded.push({ bucket: "palm-receipts", key: f.key });
      const check = await target.storage.storage
        .from("palm-receipts")
        .download(f.key);
      if (
        check.error ||
        sha(new Uint8Array(await check.data!.arrayBuffer())) !== f.sha256
      )
        throw new Error("ตรวจรูปหลังคืนไม่ผ่าน ไม่ commit");
    }
    const archiveKey = `${owner}/recovered/${job}`;
    const artifact = await target.storage.storage
      .from("palm-transfers")
      .upload(archiveKey, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (artifact.error) throw new Error("จัดเก็บชุดกู้คืนไม่สำเร็จ");
    uploaded.push({ bucket: "palm-transfers", key: archiveKey });
    await db.query(
      "insert into private.transfer_jobs(id,owner_id,request_key,request_hash,kind,status,storage_key,size_bytes,object_hash,summary,result) values($1,$2,$1,$3,'restore','confirmed',$4,$5,$3,$6,$7)",
      [
        job,
        owner,
        sha(bytes),
        archiveKey,
        bytes.length,
        archive.manifest.summary,
        JSON.stringify({ restored: true, requiresNewLogin: true }),
      ],
    );
    await db.query(
      "insert into private.transfer_objects(owner_id,transfer_id,bucket,storage_key,expires_at) values($1,$2,'palm-transfers',$3,now()+interval '7 days')",
      [owner, job, archiveKey],
    );
    for (const m of archive.imports)
      await db.query(
        "insert into private.legacy_imports(owner_id,entity_type,legacy_id,target_id,transfer_id) values($1,$2,$3,$4,$5)",
        [owner, m.entity_type, m.legacy_id, m.target_id, job],
      );
    await db.query(
      "insert into public.audit_events(owner_id,action,after_data) values($1,'recovery.restored',$2)",
      [
        owner,
        JSON.stringify({
          snapshot: archive.createdAt,
          checksum: sha(bytes),
          summary: archive.manifest.summary,
          requiresNewLogin: true,
        }),
      ],
    );
    await db.query("commit");
    return {
      status: "restored",
      summary: archive.manifest.summary,
      receiptKeyMapping: files.map((f) => ({
        id: f.id,
        from: f.originalKey,
        to: f.key,
        sha256: f.sha256,
      })),
      username: archive.data.owner_accounts[0].username,
      photos: archive.files.length,
      requiresNewLogin: true,
    };
  } catch (e) {
    await db.query("rollback");
    await cleanup();
    throw e;
  } finally {
    db.release();
  }
}
