import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from "node:crypto";

import { z } from "zod";
import { validImageSignature } from "../../lib/image-signature";
export const MAX_ARCHIVE = 40 * 1024 * 1024;
export const tables = [
  "owner_accounts",
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
export type Row = Record<string, any>;
export type Data = Record<(typeof tables)[number], Row[]>;
export const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export const passphrase = z
  .string()
  .min(12, "รหัสชุดสำรองต้องมีอย่างน้อย 12 ตัวอักษร")
  .max(256);
const row = z.record(z.string(), z.unknown());
const archiveSchema = z
  .object({
    format: z.literal("palm-ledger-backup"),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    sourceProject: z.string().max(200),
    migrations: z
      .array(
        z
          .object({
            name: z.string(),
            checksum: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(200),
    data: z.record(z.string(), z.array(row).max(200000)),
    imports: z.array(row).max(50000),
    auth: z
      .object({
        users: z.array(row).length(1),
        identities: z.array(row).max(10),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            id: z.uuid(),
            key: z.string().min(1).max(1024),
            mime: z.string(),
            size: z.number().int().min(1).max(10485760),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            base64: z.string().max(14000000),
          })
          .strict(),
      )
      .max(1000),
    manifest: z
      .object({ dataSha256: z.string(), authSha256: z.string(), summary: row })
      .strict(),
  })
  .strict();
export type Archive = Omit<
  z.infer<typeof archiveSchema>,
  "data" | "auth" | "imports"
> & { data: Data; auth: { users: Row[]; identities: Row[] }; imports: Row[] };
const scryptAsync = (
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const magic = Buffer.from("PALM-LEDGER-BACKUP-1\n");
export async function encryptArchive(archive: Archive, password: string) {
  passphrase.parse(password);
  const bytes = Buffer.from(JSON.stringify(archive));
  if (bytes.length > MAX_ARCHIVE - 128)
    throw new Error("ชุดสำรองเกิน 40 MiB กรุณาติดต่อผู้ดูแล");
  const salt = randomBytes(32),
    iv = randomBytes(12),
    key = (await scryptAsync(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 96 * 1024 * 1024,
    })) as Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally {
    key.fill(0);
    bytes.fill(0);
  }
}
export async function decryptArchive(
  bytes: Buffer,
  password: string,
): Promise<Archive> {
  passphrase.parse(password);
  if (
    bytes.length > MAX_ARCHIVE ||
    bytes.length < magic.length + 61 ||
    !bytes.subarray(0, magic.length).equals(magic)
  )
    throw new Error("รูปแบบชุดสำรองไม่รองรับ");
  const start = magic.length,
    salt = bytes.subarray(start, start + 32),
    iv = bytes.subarray(start + 32, start + 44),
    tag = bytes.subarray(start + 44, start + 60),
    key = (await scryptAsync(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 96 * 1024 * 1024,
    })) as Buffer;
  let plain: Buffer | undefined;
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(magic);
    cipher.setAuthTag(tag);
    plain = Buffer.concat([
      cipher.update(bytes.subarray(start + 60)),
      cipher.final(),
    ]);
    return validateArchive(JSON.parse(plain.toString("utf8")));
  } catch {
    throw new Error(
      "รหัสชุดสำรองไม่ถูกต้อง หรือไฟล์เสียหาย ไม่เปลี่ยนข้อมูลเดิม",
    );
  } finally {
    key.fill(0);
    plain?.fill(0);
  }
}
export function summarize(data: Data) {
  const amounts = (rows: Row[], field: string) =>
    rows.filter((r) => !r.voided_at).reduce((s, r) => s + BigInt(r[field]), 0n);
  const paid = data.expense_payments
    .filter((p) => !p.voided_at)
    .reduce((s, p) => s + BigInt(p.amount_minor), 0n);
  const income = amounts(data.sales, "net_minor"),
    expense =
      amounts(data.expenses, "amount_minor") +
      amounts(data.sale_labor, "amount_minor"),
    debt = amounts(data.opening_debts, "amount_minor"),
    opening = data.gardens.reduce((s, g) => s + BigInt(g.opening_minor), 0n);
  const safe = (n: bigint) => {
    if (
      n > BigInt(Number.MAX_SAFE_INTEGER) ||
      n < BigInt(Number.MIN_SAFE_INTEGER)
    )
      throw new Error("ผลรวมเกินขอบเขตจำนวนเต็มที่รองรับ");
    return Number(n);
  };
  return {
    gardens: data.gardens.length,
    records:
      data.sales.length +
      data.expenses.length +
      data.sale_labor.length +
      data.opening_debts.length,
    payments: data.expense_payments.length,
    photos: data.receipt_files.length,
    audit: data.audit_events.length,
    incomeMinor: safe(income),
    expenseMinor: safe(expense),
    openingMinor: safe(opening),
    netMinor: safe(opening + income - expense),
    pendingMinor: safe(expense + debt - paid),
    gardenTotals: data.gardens.map((g) => {
      const share = (e: Row) => {
        const a = data.expense_allocations.filter((a) => a.expense_id === e.id);
        return a.length
          ? a
              .filter((a) => a.garden_id === g.id)
              .reduce((s, a) => s + BigInt(a.amount_minor), 0n)
          : e.garden_id === g.id
            ? BigInt(e.amount_minor)
            : 0n;
      };
      const net =
        BigInt(g.opening_minor) +
        amounts(
          data.sales.filter((r) => r.garden_id === g.id),
          "net_minor",
        ) -
        amounts(
          data.sale_labor.filter((r) => r.garden_id === g.id),
          "amount_minor",
        ) -
        data.expenses
          .filter((e) => !e.voided_at)
          .reduce((s, e) => s + share(e), 0n);
      return { id: g.id, name: g.name, netMinor: safe(net) };
    }),
  };
}
export function validateArchive(value: unknown): Archive {
  const a = archiveSchema.parse(value) as Archive,
    data = a.data as Data;
  if (Object.keys(data).sort().join() !== [...tables].sort().join())
    throw new Error("ตารางข้อมูลไม่ครบหรือมีตารางที่ไม่รองรับ");
  if (
    sha(canonical(data)) !== a.manifest.dataSha256 ||
    sha(canonical(a.auth)) !== a.manifest.authSha256
  )
    throw new Error("Checksum ข้อมูลไม่ตรง");
  if (data.owner_accounts.length !== 1)
    throw new Error("ชุดสำรองต้องมีเจ้าของหนึ่งบัญชี");
  const owner = data.owner_accounts[0].id;
  z.uuid().parse(owner);
  if (
    a.auth.users[0].id !== owner ||
    a.auth.users[0].deleted_at ||
    a.auth.users[0].is_super_admin ||
    a.auth.users[0].role !== "authenticated" ||
    !a.auth.users[0].encrypted_password
  )
    throw new Error("ข้อมูลเชื่อมบัญชีไม่รองรับการกู้คืน");
  if (a.auth.identities.some((r) => r.user_id !== owner))
    throw new Error("Auth identity ไม่ตรงเจ้าของ");
  for (const table of tables) {
    const ids = new Set<string>();
    for (const r of data[table]) {
      if ((table === "owner_accounts" ? r.id : r.owner_id) !== owner)
        throw new Error("พบข้อมูลนอกบัญชีเจ้าของ");
      const id =
        table === "expense_allocations"
          ? r.expense_id + ":" + r.garden_id
          : String(r.id);
      if (ids.has(id)) throw new Error("พบ ID ซ้ำในชุดสำรอง");
      ids.add(id);
    }
  }
  const known = (table: keyof Data, id: unknown) =>
    data[table].some((r) => r.id === id);
  for (const r of [
    ...data.sales,
    ...data.expenses,
    ...data.sale_labor,
    ...data.opening_debts,
  ]) {
    z.uuid().parse(r.id);
    if (r.garden_id !== null && !known("gardens", r.garden_id))
      throw new Error("สวนอ้างอิงขาด");
    const n = BigInt(r.net_minor ?? r.amount_minor);
    if (n < 1n || n > 9000000000000n) throw new Error("ยอดไม่ถูกต้อง");
  }
  for (const l of data.sale_labor)
    if (!known("sales", l.sale_id)) throw new Error("บิลอ้างอิงค่าแรงขาด");
  for (const s of data.sales) {
    if (
      BigInt(s.gross_minor) - BigInt(s.deductions_minor) !==
        BigInt(s.net_minor) ||
      data.sale_deductions
        .filter((d) => d.sale_id === s.id)
        .reduce((n, d) => n + BigInt(d.amount_minor), 0n) !==
        BigInt(s.deductions_minor)
    )
      throw new Error("ยอดบิลและรายการหักไม่ตรง");
  }
  for (const d of data.sale_deductions)
    if (!known("sales", d.sale_id) || BigInt(d.amount_minor) <= 0n)
      throw new Error("รายการหักอ้างอิงผิด");
  const paymentSource = (p: Row) =>
    [p.expense_id, p.sale_labor_id, p.opening_debt_id].filter(Boolean).length;
  for (const p of data.expense_payments) {
    if (
      paymentSource(p) !== 1 ||
      BigInt(p.amount_minor) <= 0n ||
      !(p.expense_id
        ? known("expenses", p.expense_id)
        : p.sale_labor_id
          ? known("sale_labor", p.sale_labor_id)
          : known("opening_debts", p.opening_debt_id))
    )
      throw new Error("ประวัติการจ่ายอ้างอิงผิด");
  }
  for (const [table, column] of [
    ["expenses", "expense_id"],
    ["sale_labor", "sale_labor_id"],
    ["opening_debts", "opening_debt_id"],
  ] as const)
    for (const r of data[table]) {
      const paid = data.expense_payments
        .filter((p) => p[column] === r.id && !p.voided_at)
        .reduce((s, p) => s + BigInt(p.amount_minor), 0n);
      if (paid > BigInt(r.amount_minor) || (r.voided_at && paid > 0n))
        throw new Error("จ่ายเกินยอดหรือมีการจ่ายที่มีผลในต้นทางยกเลิก");
    }
  for (const p of data.expense_allocations)
    if (
      !known("expenses", p.expense_id) ||
      !known("gardens", p.garden_id) ||
      BigInt(p.amount_minor) <= 0n
    )
      throw new Error("ชุดแบ่งอ้างอิงผิด");
  for (const e of data.expenses) {
    const parts = data.expense_allocations.filter((a) => a.expense_id === e.id);
    if (
      parts.length &&
      (e.garden_id !== null ||
        parts.reduce((s, p) => s + BigInt(p.amount_minor), 0n) !==
          BigInt(e.amount_minor))
    )
      throw new Error("ชุดแบ่งไม่ครบยอด");
  }
  const fileIds = new Set<string>();
  for (const f of a.files) {
    if (fileIds.has(f.id)) throw new Error("รูปซ้ำ");
    fileIds.add(f.id);
    const receipt = data.receipt_files.find((r) => r.id === f.id);
    const b = Buffer.from(f.base64, "base64");
    if (!validImageSignature(b, f.mime) || !f.key.startsWith(owner + "/"))
      throw new Error("รูปหรือเส้นทางรูปไม่ถูกต้อง");
    if (
      !receipt ||
      receipt.storage_key !== f.key ||
      receipt.mime_type !== f.mime ||
      Number(receipt.size_bytes) !== f.size ||
      receipt.sha256 !== f.sha256 ||
      b.length !== f.size ||
      sha(b) !== f.sha256 ||
      b.toString("base64") !== f.base64
    )
      throw new Error("รูปขาดหรือ checksum รูปไม่ตรง");
  }
  if (a.files.length !== data.receipt_files.length)
    throw new Error("จำนวนรูปไม่ครบ");
  for (const r of data.receipt_files) {
    const keys = [
      r.sale_id,
      r.expense_id,
      r.sale_labor_id,
      r.opening_debt_id,
    ].filter(Boolean);
    if (
      keys.length !== 1 ||
      !(r.sale_id
        ? known("sales", r.sale_id)
        : r.expense_id
          ? known("expenses", r.expense_id)
          : r.sale_labor_id
            ? known("sale_labor", r.sale_labor_id)
            : known("opening_debts", r.opening_debt_id))
    )
      throw new Error("รูปอ้างอิงผิด");
  }
  const importIds = new Set<string>();
  for (const m of a.imports) {
    const id = m.entity_type + ":" + m.legacy_id;
    if (
      importIds.has(id) ||
      !["garden", "record"].includes(m.entity_type) ||
      typeof m.legacy_id !== "string" ||
      !m.legacy_id ||
      !(m.entity_type === "garden"
        ? known("gardens", m.target_id)
        : ["sales", "expenses", "sale_labor", "opening_debts"].some((t) =>
            known(t as keyof Data, m.target_id),
          ))
    )
      throw new Error("ประวัติการนำเข้าอ้างอิงผิดหรือซ้ำ");
    importIds.add(id);
  }
  if (canonical(summarize(data)) !== canonical(a.manifest.summary))
    throw new Error("ผลรวมชุดสำรองไม่ตรง manifest");
  return a;
}
