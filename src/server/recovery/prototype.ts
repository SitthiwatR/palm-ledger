import { randomUUID } from "node:crypto";
import { z } from "zod";
import { calculateLabor, scaled } from "../../lib/sale-math";
import {
  canonical,
  sha,
  summarize,
  tables,
  type Data,
  type Row,
} from "./format";
const date = z.iso.date(),
  cents = z.number().int().min(0).max(9000000000000);
const legacySchema = z
  .object({
    version: z.literal(1),
    demo: z.boolean(),
    gardens: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            name: z.string().trim().min(1).max(80),
            opening: z.number().int().min(-99999999999).max(99999999999),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    records: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            garden: z.string().min(1).max(200),
            kind: z.enum(["income", "expense"]),
            title: z.string().trim().min(1).max(120),
            date,
            category: z.enum([
              "sale",
              "production",
              "daily",
              "fertilizer",
              "material",
              "maintenance",
              "other",
            ]),
            amount: cents.refine((n) => n > 0),
            paid: cents,
            party: z.string().max(120).default(""),
            note: z.string().max(2000).default(""),
            payments: z
              .array(
                z.object({ amount: cents.refine((n) => n > 0), date }).strict(),
              )
              .max(10000)
              .default([]),
            photo: z.string().max(2800000).nullable().optional(),
            details: z.record(z.string(), z.unknown()).default({}),
            opening: z.boolean().optional(),
            saleId: z.string().max(200).optional(),
            allocatedFrom: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(25000),
  })
  .strict();
export type Prototype = z.infer<typeof legacySchema>;
export function validatePrototype(value: unknown) {
  const s = legacySchema.parse(value),
    gids = new Set<string>(),
    ids = new Set<string>();
  for (const g of s.gardens) {
    if (g.id === "shared" || gids.has(g.id))
      throw new Error("พบ ID สวนซ้ำหรือไม่ถูกต้อง");
    gids.add(g.id);
  }
  if (
    new Set(s.gardens.map((g) => g.name.toLowerCase())).size !==
    s.gardens.length
  )
    throw new Error("ชื่อสวนซ้ำ กรุณาแก้ชื่อในต้นแบบก่อนย้าย");
  for (const r of s.records) {
    if (ids.has(r.id)) throw new Error("พบ ID รายการซ้ำ");
    ids.add(r.id);
    if (!gids.has(r.garden) && r.garden !== "shared")
      throw new Error("สวนอ้างอิงขาด");
    if (r.paid > r.amount || (r.kind === "income" && r.paid !== r.amount))
      throw new Error("ยอดรับ/จ่ายไม่ถูกต้อง");
    if (
      r.kind === "income" &&
      (r.opening || r.garden === "shared" || r.saleId || r.payments.length)
    )
      throw new Error("ขายส่วนกลางหรือรูปแบบรายรับไม่รองรับ กรุณาตรวจต้นแบบ");
    if (r.payments.reduce((s, p) => s + p.amount, 0) > r.paid)
      throw new Error("ประวัติจ่ายเกิน paid เดิม");
    if (
      r.photo &&
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(r.photo)
    )
      throw new Error("รูปต้นแบบต้องเป็น data URL ภายในไฟล์");
  }
  for (const r of s.records)
    if (
      r.saleId &&
      (!s.records.some((p) => p.id === r.saleId && p.kind === "income") ||
        r.opening ||
        r.garden === "shared" ||
        !["production", "daily"].includes(r.category))
    )
      throw new Error("บิลอ้างอิงค่าแรงขาดหรือกำกวม กรุณาตรวจต้นแบบ");
  return s;
}
export function convertPrototype(
  value: unknown,
  owner: string,
  checkImage: (bytes: Buffer, mime: string) => boolean,
) {
  const s = validatePrototype(value),
    data = Object.fromEntries(tables.map((t) => [t, []])) as unknown as Data,
    now = new Date().toISOString(),
    ids = new Map<string, string>(),
    mapping: { type: string; legacyId: string; id: string }[] = [],
    photos: {
      id: string;
      key: string;
      mime: string;
      bytes: Buffer;
      sha256: string;
    }[] = [],
    warnings: string[] = [];
  const uid = (type: string, legacy: string) => {
    const id = randomUUID();
    ids.set(type + ":" + legacy, id);
    mapping.push({ type, legacyId: legacy, id });
    return id;
  };
  for (const g of s.gardens) {
    const id = uid("garden", g.id);
    data.gardens.push({
      id,
      owner_id: owner,
      name: g.name,
      opening_minor: g.opening,
      archived: false,
      version: 1,
      created_at: now,
      updated_at: now,
    });
  }
  for (const r of s.records) uid("record", r.id);
  for (const r of [...s.records].sort(
    (a, b) => (a.kind === "income" ? 0 : 1) - (b.kind === "income" ? 0 : 1),
  )) {
    const id = ids.get("record:" + r.id)!,
      garden = r.garden === "shared" ? null : ids.get("garden:" + r.garden),
      common = {
        id,
        owner_id: owner,
        garden_id: garden,
        payee: r.party.trim() || r.title,
        note: r.note,
        created_at: now,
        updated_at: now,
        version: 1,
        voided_at: null,
        void_reason: null,
        legacy_details: { ...r, photo: undefined, payments: undefined },
      },
      kind =
        r.category === "production"
          ? "weight_labor"
          : r.category === "daily"
            ? "daily_labor"
            : r.category;
    let source: "sales" | "sale_labor" | "expenses" | "opening_debts",
      column: string;
    if (r.kind === "income") {
      source = "sales";
      column = "sale_id";
      let grams: number | null = null,
        rate: number | null = null,
        deduction = 0;
      try {
        const g = scaled(String(r.details.weight), 3),
          p = scaled(String(r.details.rate), 2),
          d = scaled(String(r.details.deduction || "0"), 2);
        if (
          g <= 1000000000n &&
          g > 0n &&
          p > 0n &&
          p <= 100000000n &&
          (g * p + 500n) / 1000n - d === BigInt(r.amount)
        ) {
          grams = Number(g);
          rate = Number(p);
          deduction = Number(d);
        }
      } catch {}
      if (grams === null)
        warnings.push(
          `บิล ${r.id}: รักษายอดสุทธิเดิม ไม่ทราบฐานน้ำหนัก/ราคาที่ตรงยอด`,
        );
      const { payee, ...rest } = common;
      data.sales.push({
        ...rest,
        sale_date: r.date,
        buyer: payee,
        invoice_number: String(r.details.receiptNo || `ต้นแบบ ${r.id}`).slice(
          0,
          80,
        ),
        net_weight_grams: grams,
        price_minor_per_kg: rate,
        gross_minor: r.amount + deduction,
        deductions_minor: deduction,
        net_minor: r.amount,
      });
      if (deduction)
        data.sale_deductions.push({
          id: randomUUID(),
          owner_id: owner,
          sale_id: id,
          description: "ยอดหักจากต้นแบบ",
          amount_minor: deduction,
        });
    } else if (r.opening) {
      source = "opening_debts";
      column = "opening_debt_id";
      data.opening_debts.push({
        ...common,
        debt_date: r.date,
        amount_minor: r.amount,
      });
    } else if (r.saleId) {
      source = "sale_labor";
      column = "sale_labor_id";
      const mode = r.category === "production" ? "weight" : "daily";
      let basis: number | null = null,
        rate: number | null = null;
      try {
        const c = calculateLabor({
          mode,
          payee: common.payee,
          quantity: String(r.details.quantity),
          rateBaht: String(r.details.rate),
        });
        if (c.amountMinor === r.amount) {
          basis = c.basisUnits;
          rate = c.rateMinor;
        }
      } catch {}
      data.sale_labor.push({
        ...common,
        sale_id: ids.get("record:" + r.saleId),
        labor_date: r.date,
        mode,
        basis_units: basis,
        rate_minor: rate,
        amount_minor: r.amount,
      });
      if (basis === null)
        warnings.push(`ค่าแรง ${r.id}: เก็บยอดรวมโดยไม่สมมติจำนวน/อัตรา`);
    } else {
      source = "expenses";
      column = "expense_id";
      const expenseKind = kind === "sale" ? "other" : kind,
        unit =
          kind === "daily_labor"
            ? "day"
            : kind === "weight_labor"
              ? "kg"
              : kind === "fertilizer"
                ? "sack"
                : "item";
      let quantity: number | null = null,
        rate: number | null = null;
      try {
        const q = scaled(String(r.details.quantity), 3),
          p = scaled(String(r.details.rate), 2);
        const c =
          (q * p + (kind === "weight_labor" ? 500000n : 500n)) /
          (kind === "weight_labor" ? 1000000n : 1000n);
        if (
          q > 0n &&
          q <= 1000000000n &&
          p > 0n &&
          p <= 100000000000n &&
          c === BigInt(r.amount) &&
          (!["daily_labor", "weight_labor"].includes(kind) ||
            p <= 100000000n) &&
          (kind !== "daily_labor" || (q % 500n === 0n && q <= 366000n))
        ) {
          quantity = Number(q);
          rate = Number(p);
        }
      } catch {}
      data.expenses.push({
        ...common,
        expense_date: r.date,
        kind: expenseKind,
        unit,
        quantity_milli: quantity,
        rate_minor: rate,
        amount_minor: r.amount,
        allocation_version: 1,
      });
      if (quantity === null)
        warnings.push(`รายจ่าย ${r.id}: เก็บยอดรวมโดยไม่สมมติจำนวน/อัตรา`);
    }
    if (r.kind === "expense") {
      for (const p of r.payments)
        data.expense_payments.push({
          id: randomUUID(),
          owner_id: owner,
          expense_id: null,
          sale_labor_id: null,
          opening_debt_id: null,
          [column]: id,
          payment_date: p.date,
          amount_minor: p.amount,
          created_at: now,
          voided_at: null,
          void_reason: null,
          legacy_date_unknown: false,
        });
      const missing = r.paid - r.payments.reduce((s, p) => s + p.amount, 0);
      if (missing) {
        data.expense_payments.push({
          id: randomUUID(),
          owner_id: owner,
          expense_id: null,
          sale_labor_id: null,
          opening_debt_id: null,
          [column]: id,
          payment_date: r.date,
          amount_minor: missing,
          created_at: now,
          voided_at: null,
          void_reason: null,
          legacy_date_unknown: true,
        });
        warnings.push(
          `${r.id}: เพิ่มยอดจ่ายสะสมเดิม ${missing / 100} บาท โดยระบุว่าไม่ทราบวันจ่าย`,
        );
      }
    }
    if (r.photo) {
      const split = r.photo.indexOf(","),
        mime = r.photo.slice(5, r.photo.indexOf(";")),
        encoded = r.photo.slice(split + 1),
        bytes = Buffer.from(encoded, "base64");
      if (
        bytes.length > 10485760 ||
        bytes.toString("base64") !== encoded ||
        !checkImage(bytes, mime)
      )
        throw new Error("รูปต้นแบบเสียหรือชนิดไฟล์ไม่ตรง");
      const receipt = randomUUID(),
        key = `${owner}/imports/${receipt}`,
        checksum = sha(bytes);
      photos.push({ id: receipt, key, mime, bytes, sha256: checksum });
      data.receipt_files.push({
        id: receipt,
        owner_id: owner,
        sale_id: null,
        expense_id: null,
        sale_labor_id: null,
        opening_debt_id: null,
        [column]: id,
        storage_key: key,
        mime_type: mime,
        size_bytes: bytes.length,
        sha256: checksum,
        created_at: now,
      });
    }
  }
  const expected = {
    netMinor:
      s.gardens.reduce((s, g) => s + g.opening, 0) +
      s.records.reduce(
        (n, r) =>
          n + (r.kind === "income" ? r.amount : r.opening ? 0 : -r.amount),
        0,
      ),
    pendingMinor: s.records
      .filter((r) => r.kind === "expense")
      .reduce((n, r) => n + r.amount - r.paid, 0),
  };
  const summary = summarize(data);
  if (
    summary.netMinor !== expected.netMinor ||
    summary.pendingMinor !== expected.pendingMinor
  )
    throw new Error("ยอดแปลงต้นแบบไม่ตรง");
  return {
    state: s,
    data,
    mapping,
    photos,
    summary,
    warnings: [...new Set(warnings)],
    sourceHash: sha(canonical(s)),
  };
}
