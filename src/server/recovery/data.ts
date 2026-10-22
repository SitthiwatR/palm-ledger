import type { Pool, PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonical,
  sha,
  summarize,
  tables,
  type Archive,
  type Data,
  type Row,
} from "./format";
export async function readData(db: PoolClient, owner: string): Promise<Data> {
  const data = {} as Data;
  for (const table of tables) {
    data[table] = (
      await db.query(
        `select to_jsonb(t) row from public.${table} t where ${table === "owner_accounts" ? "id" : "owner_id"}=$1 order by ${table === "expense_allocations" ? "expense_id,garden_id" : "id"}`,
        [owner],
      )
    ).rows.map((r) => r.row);
  }
  return data;
}
export const businessHash = (data: Data) =>
  sha(
    canonical(
      Object.fromEntries(
        tables
          .filter((t) => !["owner_accounts", "audit_events"].includes(t))
          .map((t) => [t, data[t]]),
      ),
    ),
  );
export async function createArchive(
  dbPool: Pool,
  storage: SupabaseClient,
  owner: string,
  sourceProject: string,
): Promise<Archive> {
  const db = await dbPool.connect();
  let a: Archive;
  try {
    await db.query("begin isolation level repeatable read");
    await db.query("set local timezone to 'UTC'");
    const account = (
      await db.query(
        "select id from public.owner_accounts where id=$1 for share",
        [owner],
      )
    ).rows[0];
    if (!account) throw new Error("ไม่พบบัญชีเจ้าของ");
    const data = await readData(db, owner);
    const imports = (
      await db.query(
        "select entity_type,legacy_id,target_id from private.legacy_imports where owner_id=$1 order by entity_type,legacy_id",
        [owner],
      )
    ).rows;
    const auth = {
      users: (
        await db.query("select to_jsonb(u) row from auth.users u where id=$1", [
          owner,
        ])
      ).rows.map((r) => r.row),
      identities: (
        await db.query(
          "select to_jsonb(i) row from auth.identities i where user_id=$1 order by id",
          [owner],
        )
      ).rows.map((r) => r.row),
    };
    const migrations = (
      await db.query(
        "select name,checksum from private.schema_migrations order by name",
      )
    ).rows;
    a = {
      format: "palm-ledger-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      sourceProject,
      migrations,
      data,
      auth,
      imports,
      files: [],
      manifest: {
        dataSha256: sha(canonical(data)),
        authSha256: sha(canonical(auth)),
        summary: summarize(data),
      },
    };
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
  let total = 0;
  if (a.data.receipt_files.length > 1000)
    throw new Error("ชุดสำรองรองรับไม่เกิน 1,000 รูป");
  // Committed receipt objects are immutable; downloading after the MVCC snapshot
  // cannot mix later receipt edits into that snapshot. Every byte is verified.
  for (const r of a.data.receipt_files) {
    const got = await storage.storage
      .from("palm-receipts")
      .download(r.storage_key);
    if (got.error || !got.data)
      throw new Error("รูปที่อ้างอิงขาด ไม่สร้างชุดสำรองครึ่งชุด");
    const bytes = Buffer.from(await got.data.arrayBuffer());
    total += bytes.length;
    if (
      total > 28 * 1024 * 1024 ||
      bytes.length !== Number(r.size_bytes) ||
      sha(bytes) !== r.sha256
    )
      throw new Error("รูปไม่ตรง checksum หรือชุดสำรองเกินขนาด");
    a.files.push({
      id: r.id,
      key: r.storage_key,
      mime: r.mime_type,
      size: bytes.length,
      sha256: sha(bytes),
      base64: bytes.toString("base64"),
    });
  }
  return a;
}
const q = (id: string) => '"' + id.replaceAll('"', '""') + '"';
const permitted = new Set([
  ...tables.map((t) => "public." + t),
  "auth.users",
  "auth.identities",
]);
export async function insertRows(db: PoolClient, table: string, rows: Row[]) {
  if (!permitted.has(table)) throw new Error("Unsupported restore table");
  if (!rows.length) return;
  const [schema, name] = table.split(".");
  const meta = (
    await db.query(
      "select column_name,is_generated,is_identity,column_default,is_nullable from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position",
      [schema, name],
    )
  ).rows;
  const allowed = meta
      .filter((m) => m.is_generated === "NEVER")
      .map((m) => m.column_name),
    generated = meta
      .filter((m) => m.is_generated !== "NEVER")
      .map((m) => m.column_name);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const unknown = Object.keys(r).filter(
      (k) => !allowed.includes(k) && !generated.includes(k),
    );
    if (unknown.length)
      throw new Error("เวอร์ชันตารางปลายทางไม่รองรับชุดสำรอง");
    const keys = allowed.filter((k) => Object.hasOwn(r, k));
    const signature = keys.join(",");
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature)!.push(r);
  }
  for (const [signature, items] of groups) {
    const columns = signature.split(",").map(q).join(",");
    for (let start = 0; start < items.length; start += 500)
      await db.query(
        `insert into ${q(schema)}.${q(name)}(${columns}) overriding system value select ${columns} from jsonb_populate_recordset(null::${q(schema)}.${q(name)},$1::jsonb)`,
        [JSON.stringify(items.slice(start, start + 500))],
      );
  }
}
export const insertOrder = [
  "gardens",
  "sales",
  "sale_deductions",
  "sale_labor",
  "labor_profiles",
  "expenses",
  "opening_debts",
  "expense_payments",
  "expense_allocations",
  "receipt_files",
  "audit_events",
] as const;
