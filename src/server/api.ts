import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { calculateExpense, expenseRequest } from "../lib/expense-math";
import { calculateLabor } from "../lib/sale-math";
import type { PoolClient } from "pg";
import {
  AppError,
  SESSION_COOKIE,
  SESSION_SECONDS,
  authenticate,
  audit,
  hash,
  login,
  supabase,
  type Owner,
} from "./auth";
import { pool, transaction } from "./db";

const uuid = z.uuid();
const name = z
  .string()
  .trim()
  .min(1, "กรุณากรอกชื่อสวน")
  .max(80, "ชื่อสวนยาวไม่เกิน 80 ตัวอักษร");
const opening = z.number().int().min(-99999999999).max(99999999999);
const createGarden = z.object({ name, openingMinor: opening }).strict();
const patchGarden = z
  .object({
    name: name.optional(),
    openingMinor: opening.optional(),
    archived: z.boolean().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.openingMinor !== undefined ||
      v.archived !== undefined,
  );
const credentials = z
  .object({
    username: z.string().min(1).max(80),
    password: z.string().min(1).max(128),
  })
  .strict();
const receiptTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
const uploadRequest = z
  .object({
    mimeType: z.enum(receiptTypes),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
const saleRequest = z
  .object({
    gardenId: uuid,
    saleDate: z.iso.date(),
    buyer: z.string().trim().min(1).max(120),
    invoiceNumber: z.string().trim().min(1).max(80),
    weightKg: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/),
    priceBahtPerKg: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
    deductions: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(120),
            amountBaht: z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/),
          })
          .strict(),
      )
      .max(40),
    labor: z
      .array(
        z
          .object({
            rememberRate: z.boolean().optional(),
            mode: z.enum(["daily", "weight"]),
            payee: z.string().trim().min(1).max(120),
            quantity: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/),
            rateBaht: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
          })
          .strict(),
      )
      .max(20)
      .refine(
        (items) =>
          !items.length ||
          (items.every((item) => item.mode === items[0].mode) &&
            (items[0].mode !== "weight" || items.length === 1)),
        "เลือกวิธีคิดค่าแรงแบบเดียวต่อบิล",
      )
      .default([]),
    pendingReceiptId: uuid,
    receivedFull: z.literal(true),
    confirmDuplicate: z.boolean().default(false),
  })
  .strict();
function garden(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    openingMinor: Number(row.opening_minor),
    netMinor: Number(row.net_minor ?? row.opening_minor),
    laborPendingMinor: Number(row.labor_minor ?? 0),
    expensePendingMinor: Number(row.expense_pending_minor ?? 0),
    archived: row.archived,
    version: row.version,
  };
}
function balanceJoins(ownerParameter: 1 | 2) {
  return `left join (select garden_id,sum(net_minor) net_minor from public.sales where owner_id=$${ownerParameter} group by garden_id) s on s.garden_id=g.id
    left join (select s.garden_id,sum(l.amount_minor) labor_minor from public.sale_labor l join public.sales s on s.id=l.sale_id and s.owner_id=l.owner_id where l.owner_id=$${ownerParameter} group by s.garden_id) l on l.garden_id=g.id
    left join (select e.garden_id,sum(e.amount_minor) expense_minor,
      sum(e.amount_minor-coalesce(p.paid_minor,0)) expense_pending_minor
      from public.expenses e left join (select expense_id,owner_id,sum(amount_minor) paid_minor from public.expense_payments group by expense_id,owner_id) p on p.expense_id=e.id and p.owner_id=e.owner_id
      where e.owner_id=$${ownerParameter} group by e.garden_id) e on e.garden_id=g.id`;
}
function decimalMinor(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function weightGrams(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
function saleDto(
  row: Record<string, unknown>,
  deductions: Record<string, unknown>[],
  receipt?: Record<string, unknown>,
  labor: Record<string, unknown>[] = [],
) {
  return {
    id: row.id,
    gardenId: row.garden_id,
    gardenName: row.garden_name,
    saleDate: row.sale_date,
    buyer: row.buyer,
    invoiceNumber: row.invoice_number,
    weightKg: (Number(row.net_weight_grams) / 1000)
      .toFixed(3)
      .replace(/\.?0+$/, ""),
    priceBahtPerKg: (Number(row.price_minor_per_kg) / 100).toFixed(2),
    grossMinor: Number(row.gross_minor),
    deductionsMinor: Number(row.deductions_minor),
    netMinor: Number(row.net_minor),
    deductions: deductions.map((item) => ({
      description: item.description,
      amountMinor: Number(item.amount_minor),
    })),
    labor: labor.map((item) => ({
      id: item.id,
      mode: item.mode,
      payee: item.payee,
      quantity: String(
        Number(item.basis_units) / (item.mode === "daily" ? 2 : 1000),
      ),
      rateBaht: (Number(item.rate_minor) / 100).toFixed(2),
      amountMinor: Number(item.amount_minor),
    })),
    receipt: receipt
      ? {
          id: receipt.id,
          mimeType: receipt.mime_type,
          sizeBytes: receipt.size_bytes,
          sha256: receipt.sha256,
        }
      : null,
  };
}
function validImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "image/heic" || mime === "image/heif") {
    const boxType = bytes.toString("ascii", 4, 8);
    const brand = bytes.toString("ascii", 8, 12);
    const compatible = bytes.toString("ascii", 16, Math.min(bytes.length, 40));
    return (
      boxType === "ftyp" &&
      /^(heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1)$/.test(brand) &&
      /heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1/.test(compatible)
    );
  }
  return false;
}
async function deletePendingStorage(key: string) {
  const result = await supabase(true)
    .storage.from("palm-receipts")
    .remove([key]);
  if (result.error) throw new Error("Receipt cleanup failed");
}
async function cleanupExpiredReceipts() {
  const expired = (
    await pool().query(
      "select id,storage_key from private.pending_receipt_uploads where expires_at<=now() order by expires_at limit 20",
    )
  ).rows;
  for (const item of expired) {
    await deletePendingStorage(item.storage_key);
    await pool().query(
      "delete from private.pending_receipt_uploads where id=$1 and expires_at<=now()",
      [item.id],
    );
  }
}
async function receiptUpload(req: NextRequest, owner: Owner) {
  await cleanupExpiredReceipts();
  const input = uploadRequest.parse(await body(req));
  const key = req.headers.get("idempotency-key");
  if (!key || !uuid.safeParse(key).success)
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "กรุณาระบุรหัสคำขอแนบรูป",
    );
  const fingerprint = hash(JSON.stringify(input));
  const data = await transaction(async (db) => {
    await assertOwner(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + key,
    ]);
    const previous = (
      await db.query(
        "select * from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
        );
      return previous.response;
    }
    const id = randomUUID(),
      storageKey = `${owner.id}/${id}`;
    await db.query(
      "insert into private.pending_receipt_uploads(id,owner_id,storage_key,mime_type,size_bytes) values($1,$2,$3,$4,$5)",
      [id, owner.id, storageKey, input.mimeType, input.sizeBytes],
    );
    const { data: signed, error } = await supabase(true)
      .storage.from("palm-receipts")
      .createSignedUploadUrl(storageKey, { upsert: false });
    if (error || !signed)
      throw new AppError(
        503,
        "STORAGE_UNAVAILABLE",
        "แนบรูปไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    const response = {
      id,
      path: signed.path,
      token: signed.token,
      bucket: "palm-receipts",
      supabaseUrl: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    };
    await db.query(
      "insert into private.idempotency_requests(owner_id,key,request_hash,response) values($1,$2,$3,$4)",
      [owner.id, key, fingerprint, JSON.stringify(response)],
    );
    return response;
  });
  return json(data, 201);
}
async function validatedReceipt(pendingReceiptId: string, owner: Owner) {
  const storage = supabase(true).storage.from("palm-receipts");
  const pending = (
    await pool().query(
      "select * from private.pending_receipt_uploads where id=$1 and owner_id=$2 and expires_at>now()",
      [pendingReceiptId, owner.id],
    )
  ).rows[0];
  if (!pending)
    throw new AppError(422, "RECEIPT_REQUIRED", "กรุณาแนบรูปบิลใหม่ก่อนบันทึก");
  const downloaded = await storage.download(pending.storage_key);
  if (downloaded.error || !downloaded.data)
    throw new AppError(
      422,
      "RECEIPT_UPLOAD_MISSING",
      "อัปโหลดรูปไม่สำเร็จ กรุณาแนบรูปอีกครั้ง",
    );
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (
    bytes.length !== pending.size_bytes ||
    bytes.length > 10 * 1024 * 1024 ||
    downloaded.data.type !== pending.mime_type ||
    !validImageSignature(bytes, pending.mime_type)
  )
    throw new AppError(
      422,
      "RECEIPT_INVALID",
      "ชนิดหรือขนาดรูปบิลไม่ถูกต้อง กรุณาแนบรูปใหม่",
    );
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { pending, checksum };
}
async function saveSale(req: NextRequest, owner: Owner) {
  const input = saleRequest.parse(await body(req));
  const key = req.headers.get("idempotency-key");
  if (!key || !uuid.safeParse(key).success)
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "กรุณาระบุรหัสคำขอบันทึก",
    );
  const { confirmDuplicate: _confirm, ...stableInput } = input;
  const { labor: _labor, ...legacyInput } = stableInput;
  const fingerprint = hash(
    JSON.stringify(input.labor.length ? stableInput : legacyInput),
  );
  const prior = (
    await pool().query(
      "select request_hash,response from private.idempotency_requests where owner_id=$1 and key=$2",
      [owner.id, key],
    )
  ).rows[0];
  if (prior) {
    if (prior.request_hash !== fingerprint)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
      );
    return json(prior.response);
  }
  const grams = weightGrams(input.weightKg),
    rate = decimalMinor(input.priceBahtPerKg);
  const gross = (grams * rate + 500n) / 1000n;
  const deductions = input.deductions.map((item) => ({
    description: item.description,
    amount: decimalMinor(item.amountBaht),
  }));
  const totalDeduction = deductions.reduce(
    (sum, item) => sum + item.amount,
    0n,
  );
  let labor;
  try {
    labor = input.labor.map((item) => ({ ...item, ...calculateLabor(item) }));
  } catch (problem) {
    throw new AppError(
      422,
      "INVALID_LABOR",
      problem instanceof Error ? problem.message : "กรุณาตรวจค่าแรง",
    );
  }
  if (
    grams < 1n ||
    grams > 1_000_000_000n ||
    rate < 1n ||
    rate > 100_000_000n ||
    gross > 9_000_000_000_000n
  )
    throw new AppError(
      422,
      "VALIDATION",
      "น้ำหนักหรือราคาขายเกินขอบเขตที่รองรับ",
    );
  if (
    deductions.some((item) => item.amount < 1n) ||
    totalDeduction > gross ||
    gross - totalDeduction < 1n
  )
    throw new AppError(
      422,
      "INVALID_DEDUCTIONS",
      "ยอดหักต้องไม่เกินยอดขายและต้องเหลือรายรับสุทธิ",
    );
  const { pending, checksum } = await validatedReceipt(
    input.pendingReceiptId,
    owner,
  );
  const result = await transaction(async (db) => {
    await assertOwner(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + key,
    ]);
    const previous = (
      await db.query(
        "select * from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
        );
      return { response: previous.response, existing: true };
    }
    const gardenRow = (
      await db.query(
        "select id from public.gardens where id=$1 and owner_id=$2 and archived=false for update",
        [input.gardenId, owner.id],
      )
    ).rows[0];
    if (!gardenRow)
      throw new AppError(404, "GARDEN_NOT_FOUND", "ไม่พบสวนที่ยังใช้งาน");
    const pendingRow = (
      await db.query(
        "select id from private.pending_receipt_uploads where id=$1 and owner_id=$2 and expires_at>now() for update",
        [pending.id, owner.id],
      )
    ).rows[0];
    if (!pendingRow)
      throw new AppError(
        409,
        "RECEIPT_ALREADY_USED",
        "รูปนี้ถูกใช้กับรายการอื่นแล้ว กรุณาตรวจรายการขาย",
      );
    const matches = (
      await db.query(
        "select id,garden_id,sale_date,buyer,invoice_number,net_minor from public.sales where owner_id=$1 and garden_id=$2 and lower(invoice_number)=lower($3)",
        [owner.id, input.gardenId, input.invoiceNumber],
      )
    ).rows;
    if (matches.length && !input.confirmDuplicate)
      return {
        duplicate: matches.map((item) => ({
          id: item.id,
          invoiceNumber: item.invoice_number,
          saleDate: item.sale_date,
          buyer: item.buyer,
          netMinor: Number(item.net_minor),
        })),
      };
    const weightNumber = Number(grams),
      rateNumber = Number(rate),
      grossNumber = Number(gross),
      deductionNumber = Number(totalDeduction),
      netNumber = grossNumber - deductionNumber;
    const sale = (
      await db.query(
        "insert into public.sales(owner_id,garden_id,sale_date,buyer,invoice_number,net_weight_grams,price_minor_per_kg,gross_minor,deductions_minor,net_minor) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
        [
          owner.id,
          input.gardenId,
          input.saleDate,
          input.buyer,
          input.invoiceNumber,
          weightNumber,
          rateNumber,
          grossNumber,
          deductionNumber,
          netNumber,
        ],
      )
    ).rows[0];
    for (const item of deductions)
      await db.query(
        "insert into public.sale_deductions(owner_id,sale_id,description,amount_minor) values($1,$2,$3,$4)",
        [owner.id, sale.id, item.description, Number(item.amount)],
      );
    for (const item of labor) {
      await db.query(
        "insert into public.sale_labor(owner_id,sale_id,mode,payee,basis_units,rate_minor,amount_minor) values($1,$2,$3,$4,$5,$6,$7)",
        [
          owner.id,
          sale.id,
          item.mode,
          item.payee,
          item.basisUnits,
          item.rateMinor,
          item.amountMinor,
        ],
      );
      if (item.rememberRate !== false)
        await db.query(
          "insert into public.labor_profiles(owner_id,mode,payee,rate_minor) values($1,$2,$3,$4) on conflict(owner_id,mode,payee) do update set rate_minor=excluded.rate_minor,updated_at=now()",
          [owner.id, item.mode, item.payee, item.rateMinor],
        );
    }
    await db.query(
      "insert into public.receipt_files(owner_id,sale_id,storage_key,mime_type,size_bytes,sha256) values($1,$2,$3,$4,$5,$6)",
      [
        owner.id,
        sale.id,
        pending.storage_key,
        pending.mime_type,
        pending.size_bytes,
        checksum,
      ],
    );
    await db.query("delete from private.pending_receipt_uploads where id=$1", [
      pending.id,
    ]);
    await audit(db, owner.id, "sale.created", sale.id, null, {
      gardenId: input.gardenId,
      netMinor: netNumber,
      receiptSha256: checksum,
      labor,
    });
    const response = {
      id: sale.id,
      netMinor: netNumber,
      laborMinor: labor.reduce((sum, item) => sum + item.amountMinor, 0),
    };
    await db.query(
      "insert into private.idempotency_requests(owner_id,key,request_hash,response) values($1,$2,$3,$4)",
      [owner.id, key, fingerprint, JSON.stringify(response)],
    );
    return { response };
  });
  if ("duplicate" in result)
    throw new AppError(
      409,
      "DUPLICATE_BILL",
      "อาจมีบิลเลขนี้อยู่แล้ว กรุณาตรวจสอบก่อนยืนยัน",
      { duplicate: JSON.stringify(result.duplicate) },
    );
  if (!result.existing) {
    // The database transaction owns the receipt now. Failed commits leave it pending for retry.
  }
  return json(result.response, result.existing ? 200 : 201);
}
async function saveExpense(req: NextRequest, owner: Owner) {
  const input = expenseRequest.parse(await body(req));
  const key = req.headers.get("idempotency-key");
  if (!key || !uuid.safeParse(key).success)
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "กรุณาระบุรหัสคำขอบันทึก",
    );
  const fingerprint = hash(JSON.stringify({ resource: "expenses", input }));
  const replay = (prior: { request_hash: string; response: unknown }) => {
    if (prior.request_hash !== fingerprint)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
      );
    return prior.response;
  };
  const prior = (
    await pool().query(
      "select request_hash,response from private.idempotency_requests where owner_id=$1 and key=$2",
      [owner.id, key],
    )
  ).rows[0];
  if (prior) return json(replay(prior));
  let amounts;
  try {
    amounts = calculateExpense(input);
  } catch (problem) {
    throw new AppError(
      422,
      "INVALID_EXPENSE",
      problem instanceof Error ? problem.message : "กรุณาตรวจรายจ่าย",
    );
  }
  let receipt: Awaited<ReturnType<typeof validatedReceipt>> | null = null;
  try {
    receipt = input.pendingReceiptId
      ? await validatedReceipt(input.pendingReceiptId, owner)
      : null;
  } catch (problem) {
    // Another request using this key may have committed and consumed the upload
    // after the first replay lookup. Return its result instead of a stale-upload error.
    const committed = (
      await pool().query(
        "select request_hash,response from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (committed) return json(replay(committed));
    throw problem;
  }
  const result = await transaction(async (db) => {
    await assertOwner(db, owner);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + key,
    ]);
    const previous = (
      await db.query(
        "select request_hash,response from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (previous) return replay(previous);
    const garden = (
      await db.query(
        "select id from public.gardens where id=$1 and owner_id=$2 and archived=false for update",
        [input.gardenId, owner.id],
      )
    ).rows[0];
    if (!garden)
      throw new AppError(404, "GARDEN_NOT_FOUND", "ไม่พบสวนที่ยังใช้งาน");
    if (receipt) {
      const pending = (
        await db.query(
          "select id from private.pending_receipt_uploads where id=$1 and owner_id=$2 and expires_at>now() for update",
          [receipt.pending.id, owner.id],
        )
      ).rows[0];
      if (!pending)
        throw new AppError(
          409,
          "RECEIPT_ALREADY_USED",
          "รูปนี้ถูกใช้แล้ว กรุณาตรวจรายการ",
        );
    }
    const expense = (
      await db.query(
        `insert into public.expenses(owner_id,garden_id,expense_date,kind,payee,note,unit,quantity_milli,rate_minor,amount_minor)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [
          owner.id,
          input.gardenId,
          input.expenseDate,
          input.kind,
          input.payee,
          input.note,
          input.unit,
          amounts.quantityMilli,
          amounts.rateMinor,
          amounts.amountMinor,
        ],
      )
    ).rows[0];
    if (amounts.paidMinor > 0) {
      const payment = (
        await db.query(
          "insert into public.expense_payments(owner_id,expense_id,payment_date,amount_minor) values($1,$2,$3,$4) returning id",
          [owner.id, expense.id, input.paymentDate, amounts.paidMinor],
        )
      ).rows[0];
      await audit(db, owner.id, "expense.payment.created", payment.id, null, {
        expenseId: expense.id,
        paymentDate: input.paymentDate,
        amountMinor: amounts.paidMinor,
      });
    }
    if (
      (input.kind === "daily_labor" || input.kind === "weight_labor") &&
      input.rememberRate
    )
      await db.query(
        "insert into public.labor_profiles(owner_id,mode,payee,rate_minor) values($1,$4,$2,$3) on conflict(owner_id,mode,payee) do update set rate_minor=excluded.rate_minor,updated_at=now()",
        [
          owner.id,
          input.payee,
          amounts.rateMinor,
          input.kind === "daily_labor" ? "daily" : "weight",
        ],
      );
    if (receipt) {
      const p = receipt.pending;
      await db.query(
        "insert into public.receipt_files(owner_id,expense_id,storage_key,mime_type,size_bytes,sha256) values($1,$2,$3,$4,$5,$6)",
        [
          owner.id,
          expense.id,
          p.storage_key,
          p.mime_type,
          p.size_bytes,
          receipt.checksum,
        ],
      );
      await db.query(
        "delete from private.pending_receipt_uploads where id=$1",
        [p.id],
      );
    }
    await audit(db, owner.id, "expense.created", expense.id, null, {
      ...input,
      ...amounts,
      receiptSha256: receipt?.checksum,
    });
    const response = {
      id: expense.id,
      amountMinor: amounts.amountMinor,
      paidMinor: amounts.paidMinor,
      pendingMinor: amounts.amountMinor - amounts.paidMinor,
    };
    await db.query(
      "insert into private.idempotency_requests(owner_id,key,request_hash,response) values($1,$2,$3,$4)",
      [owner.id, key, fingerprint, JSON.stringify(response)],
    );
    return response;
  });
  return json(result, 201);
}
async function listExpenses(owner: Owner) {
  const rows = (
    await pool().query(
      `select e.*,to_char(e.expense_date,'YYYY-MM-DD') business_date,g.name garden_name,
    coalesce((select sum(p.amount_minor) from public.expense_payments p where p.expense_id=e.id and p.owner_id=e.owner_id),0)::text paid_minor,
    coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'paymentDate',to_char(p.payment_date,'YYYY-MM-DD'),'amountMinor',p.amount_minor) order by p.created_at,p.id) from public.expense_payments p where p.expense_id=e.id and p.owner_id=e.owner_id),'[]'::jsonb) payments,
    (select r.id from public.receipt_files r where r.expense_id=e.id and r.owner_id=e.owner_id limit 1) receipt_id
    from public.expenses e join public.gardens g on g.id=e.garden_id and g.owner_id=e.owner_id
    where e.owner_id=$1 order by e.expense_date desc,e.created_at desc limit 200`,
      [owner.id],
    )
  ).rows;
  return json({
    expenses: rows.map((r) => ({
      id: r.id,
      gardenId: r.garden_id,
      gardenName: r.garden_name,
      expenseDate: r.business_date,
      kind: r.kind,
      payee: r.payee,
      note: r.note,
      unit: r.unit,
      quantity: String(Number(r.quantity_milli) / 1000),
      rateBaht: (Number(r.rate_minor) / 100).toFixed(2),
      amountMinor: Number(r.amount_minor),
      paidMinor: Number(r.paid_minor),
      pendingMinor: Number(r.amount_minor) - Number(r.paid_minor),
      payments: r.payments,
      receiptId: r.receipt_id,
    })),
  });
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function body(req: NextRequest) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "JSON_REQUIRED", "กรุณาส่งข้อมูล JSON");
  if (Number(req.headers.get("content-length")) > 32768)
    throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลใหญ่เกินไป");
  const reader = req.body?.getReader();
  if (!reader)
    throw new AppError(422, "INVALID_JSON", "กรุณาส่งข้อมูลที่ต้องการบันทึก");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลใหญ่เกินไป");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(422, "INVALID_JSON", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
}
async function assertOwner(db: PoolClient, owner: Owner) {
  const row = (
    await db.query(
      "select auth_epoch from public.owner_accounts where id=$1 for share",
      [owner.id],
    )
  ).rows[0];
  if (!row || row.auth_epoch !== owner.auth_epoch)
    throw new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบใหม่");
}
async function writeGarden(req: NextRequest, owner: Owner, id?: string) {
  const input = id
    ? patchGarden.parse(await body(req))
    : createGarden.parse(await body(req));
  const key = req.headers.get("idempotency-key");
  if (!key || !uuid.safeParse(key).success)
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "กรุณาระบุรหัสคำขอบันทึก",
    );
  const fingerprint = hash(JSON.stringify({ method: req.method, id, input }));
  const data = await transaction(async (db) => {
    await assertOwner(db, owner);
    // Serialize retries for one key, including the first insert, across app instances.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + key,
    ]);
    const previous = (
      await db.query(
        "select * from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
        );
      return previous.response;
    }
    let before = null,
      result;
    if (id) {
      const patch = input as z.infer<typeof patchGarden>;
      before = (
        await db.query(
          "select * from public.gardens where id=$1 and owner_id=$2 for update",
          [id, owner.id],
        )
      ).rows[0];
      if (!before) throw new AppError(404, "NOT_FOUND", "ไม่พบสวน");
      if (before.version !== patch.expectedVersion)
        throw new AppError(
          409,
          "STALE_VERSION",
          "ข้อมูลเปลี่ยนจากอีกหน้าจอ กรุณาโหลดข้อมูลล่าสุด",
        );
      result = (
        await db.query(
          `update public.gardens set name=$3,opening_minor=$4,archived=$5,version=version+1,updated_at=now()
        where id=$1 and owner_id=$2 returning *`,
          [
            id,
            owner.id,
            patch.name ?? before.name,
            patch.openingMinor ?? before.opening_minor,
            patch.archived ?? before.archived,
          ],
        )
      ).rows[0];
    } else {
      const create = input as z.infer<typeof createGarden>;
      result = (
        await db.query(
          "insert into public.gardens(owner_id,name,opening_minor) values ($1,$2,$3) returning *",
          [owner.id, create.name, create.openingMinor],
        )
      ).rows[0];
    }
    await audit(
      db,
      owner.id,
      id ? "garden.updated" : "garden.created",
      result.id,
      before,
      result,
    );
    const balanced = (
      await db.query(
        `select g.*,g.opening_minor+coalesce(s.net_minor,0)-coalesce(l.labor_minor,0)-coalesce(e.expense_minor,0) net_minor,coalesce(l.labor_minor,0) labor_minor,coalesce(e.expense_pending_minor,0) expense_pending_minor from public.gardens g ${balanceJoins(2)} where g.id=$1 and g.owner_id=$2`,
        [result.id, owner.id],
      )
    ).rows[0];
    const response = garden(balanced);
    await db.query(
      "insert into private.idempotency_requests(owner_id,key,request_hash,response) values ($1,$2,$3,$4)",
      [owner.id, key, fingerprint, JSON.stringify(response)],
    );
    return response;
  });
  return json(data, id ? 200 : 201);
}
export async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path,
      route = path.join("/"),
      method = req.method;
    if (!["GET", "HEAD"].includes(method)) {
      const expected = process.env.APP_URL;
      if (!expected) throw new Error("APP_URL is required");
      if (req.headers.get("origin") !== new URL(expected).origin)
        throw new AppError(
          403,
          "INVALID_ORIGIN",
          "ไม่สามารถส่งข้อมูลจากหน้านี้ได้",
        );
    }
    if (route === "session" && method === "POST") {
      const input = credentials.parse(await body(req));
      const result = await login(input.username, input.password);
      const response = json({ username: result.owner.username });
      response.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: new URL(process.env.APP_URL!).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_SECONDS,
      });
      return response;
    }
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (route === "session" && method === "DELETE") {
      if (token)
        await pool().query(
          "delete from private.owner_sessions where token_hash=$1",
          [hash(token)],
        );
      const response = json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
        secure: new URL(process.env.APP_URL!).protocol === "https:",
      });
      return response;
    }
    const owner = await authenticate(token);
    if (route === "session" && method === "GET")
      return json({ username: owner.username });
    if (route === "summary" && method === "GET") {
      const rows = await pool().query(
        `select coalesce(sum(g.opening_minor + coalesce(s.net_minor,0)-coalesce(l.labor_minor,0)-coalesce(e.expense_minor,0)),0)::text as total,count(*)::int as count,
         coalesce(sum(l.labor_minor),0)::text labor_minor,coalesce(sum(e.expense_pending_minor),0)::text expense_pending_minor from public.gardens g ${balanceJoins(1)} where g.owner_id=$1`,
        [owner.id],
      );
      return json({
        netMinor: Number(rows.rows[0].total),
        gardenCount: rows.rows[0].count,
        laborPendingMinor: Number(rows.rows[0].labor_minor),
        expensePendingMinor: Number(rows.rows[0].expense_pending_minor),
      });
    }
    if (route === "gardens" && method === "GET") {
      const rows = await pool().query(
        `select g.*,g.opening_minor + coalesce(s.net_minor,0)-coalesce(l.labor_minor,0)-coalesce(e.expense_minor,0) net_minor,coalesce(l.labor_minor,0) labor_minor,coalesce(e.expense_pending_minor,0) expense_pending_minor from public.gardens g
         ${balanceJoins(1)}
         where g.owner_id=$1 order by g.archived,g.name,g.id`,
        [owner.id],
      );
      return json({ gardens: rows.rows.map(garden) });
    }
    if (route === "gardens" && method === "POST")
      return await writeGarden(req, owner);
    if (path.length === 2 && path[0] === "gardens") {
      const id = uuid.parse(path[1]);
      if (method === "PATCH") return await writeGarden(req, owner, id);
      if (method === "GET") {
        const row = (
          await pool().query(
            `select g.*,g.opening_minor + coalesce(s.net_minor,0)-coalesce(l.labor_minor,0)-coalesce(e.expense_minor,0) net_minor,coalesce(l.labor_minor,0) labor_minor,coalesce(e.expense_pending_minor,0) expense_pending_minor from public.gardens g
             ${balanceJoins(2)}
             where g.id=$1 and g.owner_id=$2`,
            [id, owner.id],
          )
        ).rows[0];
        if (!row) throw new AppError(404, "NOT_FOUND", "ไม่พบสวน");
        return json(garden(row));
      }
    }
    if (route === "receipts/upload-url" && method === "POST")
      return await receiptUpload(req, owner);
    if (route === "receipts/verify" && method === "POST") {
      const input = z
        .object({ pendingReceiptId: uuid })
        .strict()
        .parse(await body(req));
      const { pending, checksum } = await validatedReceipt(
        input.pendingReceiptId,
        owner,
      );
      return json({ id: pending.id, sha256: checksum });
    }
    if (route === "sales/preferences" && method === "GET") {
      const latest = (
        await pool().query(
          "select id,garden_id,buyer from public.sales where owner_id=$1 order by created_at desc limit 1",
          [owner.id],
        )
      ).rows[0];
      const profiles = (
        await pool().query(
          "select mode,payee,rate_minor from public.labor_profiles where owner_id=$1 order by updated_at desc limit 100",
          [owner.id],
        )
      ).rows;
      const lastLabor = latest
        ? (
            await pool().query(
              "select mode,payee,rate_minor,basis_units from public.sale_labor where sale_id=$1 and owner_id=$2 order by created_at,id",
              [latest.id, owner.id],
            )
          ).rows
        : [];
      return json({
        gardenId: latest?.garden_id,
        buyer: latest?.buyer,
        profiles: profiles.map((p) => ({
          mode: p.mode,
          payee: p.payee,
          rateBaht: (Number(p.rate_minor) / 100).toFixed(2),
        })),
        lastLabor: lastLabor.map((p) => ({
          mode: p.mode,
          payee: p.payee,
          rateBaht: (Number(p.rate_minor) / 100).toFixed(2),
          quantity: p.mode === "daily" ? "1" : "",
        })),
      });
    }
    if (route === "expenses" && method === "POST")
      return await saveExpense(req, owner);
    if (route === "expenses" && method === "GET")
      return await listExpenses(owner);
    if (route === "sales" && method === "POST")
      return await saveSale(req, owner);
    if (route === "sales" && method === "GET") {
      const rows = await pool().query(
        `select s.*,to_char(s.sale_date,'YYYY-MM-DD') sale_date,g.name garden_name,
        coalesce((select jsonb_agg(jsonb_build_object('description',d.description,'amount_minor',d.amount_minor) order by d.id) from public.sale_deductions d where d.sale_id=s.id and d.owner_id=s.owner_id),'[]'::jsonb) deductions,
        (select jsonb_build_object('id',r.id,'mime_type',r.mime_type,'size_bytes',r.size_bytes,'sha256',r.sha256) from public.receipt_files r where r.sale_id=s.id and r.owner_id=s.owner_id limit 1) receipt,
        coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from public.sale_labor l where l.sale_id=s.id and l.owner_id=s.owner_id),'[]'::jsonb) labor
        from public.sales s join public.gardens g on g.id=s.garden_id
        where s.owner_id=$1 order by s.sale_date desc,s.created_at desc limit 200`,
        [owner.id],
      );
      const sales = rows.rows.map((row) =>
        saleDto(row, row.deductions, row.receipt ?? undefined, row.labor),
      );
      return json({ sales });
    }
    if (path.length === 2 && path[0] === "receipts" && method === "GET") {
      const receiptId = uuid.parse(path[1]);
      const receipt = (
        await pool().query(
          "select storage_key,mime_type from public.receipt_files where id=$1 and owner_id=$2",
          [receiptId, owner.id],
        )
      ).rows[0];
      if (!receipt) throw new AppError(404, "NOT_FOUND", "ไม่พบรูปบิล");
      const signed = await supabase(true)
        .storage.from("palm-receipts")
        .createSignedUrl(receipt.storage_key, 300);
      if (signed.error || !signed.data)
        throw new AppError(
          503,
          "STORAGE_UNAVAILABLE",
          "เปิดรูปบิลไม่สำเร็จ กรุณาลองอีกครั้ง",
        );
      return json({
        url: signed.data.signedUrl,
        mimeType: receipt.mime_type,
        expiresIn: 300,
      });
    }
    throw new AppError(404, "NOT_FOUND", "ไม่พบหน้าที่ต้องการ");
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fields = Object.fromEntries(
        error.issues.map((i) => [i.path.join("."), i.message]),
      );
      return json(
        {
          error: {
            code: "VALIDATION",
            message: "กรุณาตรวจข้อมูลที่กรอก",
            fields,
          },
        },
        422,
      );
    }
    if (error instanceof AppError)
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
          },
        },
        error.status,
      );
    if ((error as { code?: string }).code === "23505")
      return json(
        {
          error: {
            code: "DUPLICATE_NAME",
            message: "มีสวนชื่อนี้อยู่แล้ว",
            fields: { name: "กรุณาใช้ชื่อสวนอื่น" },
          },
        },
        409,
      );
    // Never log DB parameters, credentials, tokens or request bodies.
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่ ข้อมูลที่กรอกยังอยู่",
        },
      },
      500,
    );
  }
}
