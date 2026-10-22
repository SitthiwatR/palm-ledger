import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, audit, type Owner } from "./auth";
import { pool, transaction } from "./db";
import { calculateExpense, expenseRequest } from "../lib/expense-math";
import { calculateLabor, scaled } from "../lib/sale-math";
import { csvDocument } from "../lib/entry-csv";

const sources = {
  sales: "sales",
  expenses: "expenses",
  "sale-labor": "sale_labor",
  "opening-debts": "opening_debts",
} as const;
type Source = keyof typeof sources;
type Row = Record<string, any>;
type Dependencies = {
  body: (req: NextRequest) => Promise<unknown>;
  write: (
    req: NextRequest,
    owner: Owner,
    resource: string,
    input: unknown,
    work: (db: PoolClient) => Promise<unknown>,
  ) => Promise<NextResponse>;
};
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const amount = z.string().regex(/^\d{1,11}(?:\.\d{1,2})?$/);
const base = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
const linked = {
  acknowledgeLabor: z.boolean().default(false),
  laborVersions: z
    .array(
      z.object({ id: z.uuid(), version: z.number().int().positive() }).strict(),
    )
    .max(20)
    .default([]),
};
const allocation = z
  .array(z.object({ gardenId: z.uuid(), amountBaht: amount }).strict())
  .max(200)
  .refine(
    (a) => new Set(a.map((i) => i.gardenId)).size === a.length,
    "สวนต้องไม่ซ้ำ",
  );
const common = {
  gardenId: z.uuid(),
  date: z.iso.date(),
  payee: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).default(""),
};
const schemas = {
  sales: base
    .extend({
      ...common,
      invoiceNumber: z.string().trim().min(1).max(80),
      weightKg: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/),
      priceBahtPerKg: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
      deductions: z
        .array(
          z
            .object({
              description: z.string().trim().min(1).max(120),
              amountBaht: amount,
            })
            .strict(),
        )
        .max(40),
      receivedFull: z.literal(true),
      confirmDuplicate: z.boolean().default(false),
      ...linked,
    })
    .strict(),
  expenses: base
    .extend({
      ...expenseRequest.omit({
        expenseDate: true,
        paymentStatus: true,
        paidBaht: true,
        paymentDate: true,
        pendingReceiptId: true,
        rememberRate: true,
      }).shape,
      date: z.iso.date(),
      allocations: allocation.optional(),
    })
    .strict(),
  "sale-labor": base
    .extend({
      ...common,
      mode: z.enum(["daily", "weight"]),
      quantity: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/),
      rateBaht: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
    })
    .strict(),
  "opening-debts": base
    .extend({ ...common, gardenId: z.uuid().nullable(), amountBaht: amount })
    .strict(),
};
const legacyCommon = {
  ...common,
  gardenId: z.uuid().nullable(),
  amountBaht: amount,
};
const manualSchemas = {
  sales: base
    .extend({
      ...common,
      invoiceNumber: z.string().trim().min(1).max(80),
      amountBaht: amount,
      receivedFull: z.literal(true),
      confirmDuplicate: z.boolean().default(false),
      ...linked,
    })
    .strict(),
  expenses: base
    .extend({
      ...legacyCommon,
      kind: expenseRequest.shape.kind,
      allocations: allocation.optional(),
    })
    .strict(),
  "sale-labor": base
    .extend({
      ...common,
      mode: z.enum(["daily", "weight"]),
      amountBaht: amount,
    })
    .strict(),
};
const voidSchema = base
  .extend({
    acknowledgePayments: z.boolean().default(false),
    activePaymentIds: z.array(z.uuid()).max(10000).default([]),
    ...linked,
  })
  .strict();
const minor = (v: string) => {
  const [a, b = ""] = v.split(".");
  const n = BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
  if (n < 1n || n > 9_000_000_000_000n)
    fail("AMOUNT_RANGE", "กรุณาตรวจยอดเงิน", 422);
  return Number(n);
};
async function payments(
  db: PoolClient,
  owner: Owner,
  source: Source,
  id: string,
) {
  if (source === "sales") return [];
  const column =
    source === "expenses"
      ? "expense_id"
      : source === "sale-labor"
        ? "sale_labor_id"
        : "opening_debt_id";
  return (
    await db.query(
      `select *,to_char(payment_date,'YYYY-MM-DD') payment_date from public.expense_payments where owner_id=$1 and ${column}=$2 order by created_at,id`,
      [owner.id, id],
    )
  ).rows;
}
async function detail(
  db: PoolClient,
  owner: Owner,
  source: Source,
  id: string,
) {
  const row = (
    await db.query(
      `select to_jsonb(t) || jsonb_build_object('date',to_char(${source === "sales" ? "sale_date" : source === "expenses" ? "expense_date" : source === "sale-labor" ? "labor_date" : "debt_date"},'YYYY-MM-DD')) data from public.${sources[source]} t where id=$1 and owner_id=$2`,
      [id, owner.id],
    )
  ).rows[0]?.data;
  if (!row) fail("NOT_FOUND", "ไม่พบรายการ", 404);
  const history = await payments(db, owner, source, id);
  const labor =
    source === "sales"
      ? (
          await db.query(
            "select l.*,to_char(l.labor_date,'YYYY-MM-DD') date,g.name garden_name,coalesce((select sum(p.amount_minor) from public.expense_payments p where p.sale_labor_id=l.id and p.owner_id=l.owner_id and p.voided_at is null),0)::float8 paid_minor from public.sale_labor l join public.gardens g on g.id=l.garden_id and g.owner_id=l.owner_id where l.sale_id=$1 and l.owner_id=$2 order by l.id",
            [id, owner.id],
          )
        ).rows
      : [];
  const deductions =
    source === "sales"
      ? (
          await db.query(
            "select * from public.sale_deductions where sale_id=$1 and owner_id=$2 order by id",
            [id, owner.id],
          )
        ).rows
      : [];
  const allocations =
    source === "expenses"
      ? (
          await db.query(
            "select a.*,g.name garden_name from public.expense_allocations a join public.gardens g on g.id=a.garden_id and g.owner_id=a.owner_id where a.expense_id=$1 and a.owner_id=$2 order by a.garden_id",
            [id, owner.id],
          )
        ).rows
      : [];
  const receipts = (
    await db.query(
      `select id,mime_type from public.receipt_files where ${source === "sales" ? "sale_id" : source === "expenses" ? "expense_id" : source === "sale-labor" ? "sale_labor_id" : "opening_debt_id"}=$1 and owner_id=$2`,
      [id, owner.id],
    )
  ).rows;
  const events = (
    await db.query(
      "select action,before_data,after_data,created_at from public.audit_events where owner_id=$1 and entity_id=any($2::uuid[]) order by created_at,id",
      [owner.id, [id, ...history.map((p) => p.id)]],
    )
  ).rows;
  const paidMinor = history
    .filter((p) => !p.voided_at)
    .reduce((s, p) => s + Number(p.amount_minor), 0);
  return {
    source,
    record: row,
    payments: history,
    labor,
    deductions,
    allocations,
    receipts,
    audit: events,
    paidMinor,
    pendingMinor:
      row.voided_at || source === "sales"
        ? 0
        : Number(row.amount_minor) - paidMinor,
  };
}
async function garden(
  db: PoolClient,
  owner: Owner,
  id: string | null,
  previous: string[],
) {
  if (id === null) return;
  const g = (
    await db.query(
      "select id,archived from public.gardens where id=$1 and owner_id=$2 for share",
      [id, owner.id],
    )
  ).rows[0];
  if (!g || (g.archived && !previous.includes(id)))
    fail("GARDEN_NOT_FOUND", "ไม่พบสวนที่ยังใช้งาน", 404);
}
function sameIds(a: string[], b: string[]) {
  return [...a].sort().join() === [...b].sort().join();
}
async function reviewLabor(
  db: PoolClient,
  owner: Owner,
  id: string,
  input: Row,
) {
  const rows = (
    await db.query(
      "select id,version from public.sale_labor where sale_id=$1 and owner_id=$2 order by id for update",
      [id, owner.id],
    )
  ).rows;
  if (
    rows.length &&
    (!input.acknowledgeLabor ||
      !sameIds(
        rows.map((r) => `${r.id}:${r.version}`),
        input.laborVersions.map((r: Row) => `${r.id}:${r.version}`),
      ))
  )
    fail(
      "LABOR_REVIEW_REQUIRED",
      "ค่าแรงที่เกี่ยวข้องเปลี่ยน กรุณาโหลดล่าสุดและตรวจค่าแรงแยกก่อนยืนยัน",
    );
}
async function mutate(
  req: NextRequest,
  owner: Owner,
  source: Source,
  id: string,
  isVoid: boolean,
  deps: Dependencies,
) {
  const input: Row = (
    isVoid
      ? voidSchema
      : source === "opening-debts"
        ? schemas[source]
        : z.union([schemas[source], manualSchemas[source]])
  ).parse(await deps.body(req));
  return deps.write(
    req,
    owner,
    `entries/${source}/${id}/${isVoid ? "void" : "edit"}`,
    input,
    async (db) => {
      const before = (
        await db.query(
          `select * from public.${sources[source]} where id=$1 and owner_id=$2 for update`,
          [id, owner.id],
        )
      ).rows[0];
      if (!before) fail("NOT_FOUND", "ไม่พบรายการ", 404);
      if (before.voided_at) {
        if (isVoid) return { id, voided: true, version: before.version };
        fail("SOURCE_VOIDED", "รายการนี้ยกเลิกแล้ว");
      }
      if (before.version !== input.expectedVersion)
        fail(
          "STALE_VERSION",
          "รายการเปลี่ยนจากอีกหน้าจอ กรุณาโหลดล่าสุดก่อนแก้ไข",
        );
      if (source === "sales") await reviewLabor(db, owner, id, input);
      const history = await payments(db, owner, source, id);
      const active = history.filter((p) => !p.voided_at);
      const paid = active.reduce((s, p) => s + Number(p.amount_minor), 0);
      const oldAllocations: Row[] =
        source === "expenses"
          ? (
              await db.query(
                "select garden_id,amount_minor from public.expense_allocations where expense_id=$1 and owner_id=$2 order by garden_id",
                [id, owner.id],
              )
            ).rows
          : [];
      const oldDeductions: Row[] =
        source === "sales"
          ? (
              await db.query(
                "select description,amount_minor from public.sale_deductions where sale_id=$1 and owner_id=$2 order by id",
                [id, owner.id],
              )
            ).rows
          : [];
      let changes: Row;
      if (isVoid) {
        if (
          history.length &&
          (!input.acknowledgePayments ||
            !sameIds(
              active.map((p) => p.id),
              input.activePaymentIds,
            ))
        )
          fail(
            "PAYMENT_REVIEW_REQUIRED",
            "กรุณาตรวจผลกระทบและยืนยันประวัติการจ่ายล่าสุด",
          );
        for (const p of active) {
          const after = (
            await db.query(
              "update public.expense_payments set voided_at=now(),void_reason=$3 where id=$1 and owner_id=$2 returning *",
              [p.id, owner.id, input.reason],
            )
          ).rows[0];
          await audit(db, owner.id, "payment.voided", p.id, p, {
            ...after,
            sourceVoided: id,
          });
        }
        changes = { voided_at: new Date(), void_reason: input.reason };
      } else {
        await garden(db, owner, input.gardenId, [before.garden_id]);
        changes = {
          garden_id: input.gardenId,
          payee: input.payee,
          note: input.note,
        };
        try {
          if (input.amountBaht && source !== "opening-debts") {
            const unknown =
              source === "sales"
                ? before.net_weight_grams === null
                : source === "expenses"
                  ? before.quantity_milli === null
                  : before.basis_units === null;
            if (!before.legacy_details || !unknown)
              fail(
                "CALCULATION_REQUIRED",
                "รายการนี้ต้องคำนวณจากจำนวนและอัตรา",
                422,
              );
            const total = minor(input.amountBaht);
            if (source === "sales") {
              if (
                !input.confirmDuplicate &&
                (before.garden_id !== input.gardenId ||
                  before.invoice_number.toLowerCase() !==
                    input.invoiceNumber.toLowerCase())
              ) {
                const duplicate = await db.query(
                  "select id from public.sales where owner_id=$1 and garden_id=$2 and lower(invoice_number)=lower($3) and id<>$4 and voided_at is null",
                  [owner.id, input.gardenId, input.invoiceNumber, id],
                );
                if (duplicate.rowCount)
                  fail(
                    "DUPLICATE_BILL",
                    "อาจมีบิลเลขนี้ในสวนที่เลือกแล้ว กรุณาตรวจรายการก่อนยืนยันใช้เลขบิลซ้ำ",
                  );
              }
              const { payee, ...rest } = changes;
              changes = {
                ...rest,
                buyer: payee,
                sale_date: input.date,
                invoice_number: input.invoiceNumber,
                net_minor: total,
                gross_minor: total + Number(before.deductions_minor),
              };
            } else if (source === "expenses")
              changes = {
                ...changes,
                expense_date: input.date,
                kind: input.kind,
                unit:
                  input.kind === "daily_labor"
                    ? "day"
                    : input.kind === "weight_labor"
                      ? "kg"
                      : input.kind === "fertilizer"
                        ? "sack"
                        : "item",
                amount_minor: total,
              };
            else
              changes = {
                ...changes,
                labor_date: input.date,
                mode: input.mode,
                amount_minor: total,
              };
          } else if (source === "sales") {
            if (
              !input.confirmDuplicate &&
              (before.garden_id !== input.gardenId ||
                before.invoice_number.toLowerCase() !==
                  input.invoiceNumber.toLowerCase())
            ) {
              const duplicate = await db.query(
                "select id from public.sales where owner_id=$1 and garden_id=$2 and lower(invoice_number)=lower($3) and id<>$4 and voided_at is null",
                [owner.id, input.gardenId, input.invoiceNumber, id],
              );
              if (duplicate.rowCount)
                fail(
                  "DUPLICATE_BILL",
                  "อาจมีบิลเลขนี้ในสวนที่เลือกแล้ว กรุณาตรวจรายการก่อนยืนยันใช้เลขบิลซ้ำ",
                );
            }
            const grams = scaled(input.weightKg, 3),
              rate = scaled(input.priceBahtPerKg, 2);
            const gross = (grams * rate + 500n) / 1000n;
            const deductions = input.deductions.map((d: Row) =>
              minor(d.amountBaht),
            );
            const deduction = deductions.reduce(
              (s: bigint, n: number) => s + BigInt(n),
              0n,
            );
            if (
              grams < 1n ||
              grams > 1_000_000_000n ||
              rate < 1n ||
              rate > 100_000_000n ||
              gross > 9_000_000_000_000n ||
              gross <= deduction
            )
              fail("SALE_AMOUNT", "กรุณาตรวจน้ำหนัก ราคา และรายการหัก", 422);
            changes = {
              garden_id: input.gardenId,
              sale_date: input.date,
              buyer: input.payee,
              note: input.note,
              invoice_number: input.invoiceNumber,
              net_weight_grams: Number(grams),
              price_minor_per_kg: Number(rate),
              gross_minor: Number(gross),
              deductions_minor: Number(deduction),
              net_minor: Number(gross - deduction),
            };
            await db.query(
              "delete from public.sale_deductions where sale_id=$1 and owner_id=$2",
              [id, owner.id],
            );
            for (let i = 0; i < input.deductions.length; i++)
              await db.query(
                "insert into public.sale_deductions(sale_id,owner_id,description,amount_minor) values($1,$2,$3,$4)",
                [id, owner.id, input.deductions[i].description, deductions[i]],
              );
          } else if (source === "expenses") {
            const calc = calculateExpense(
              expenseRequest.parse({
                gardenId: input.gardenId,
                kind: input.kind,
                payee: input.payee,
                note: input.note,
                unit: input.unit,
                quantity: input.quantity,
                rateBaht: input.rateBaht,
                expenseDate: input.date,
                paymentStatus: "unpaid",
                paidBaht: "0",
                rememberRate: false,
              }),
            );
            changes = {
              ...changes,
              expense_date: input.date,
              kind: input.kind,
              unit: input.unit,
              quantity_milli: calc.quantityMilli,
              rate_minor: calc.rateMinor,
              amount_minor: calc.amountMinor,
            };
          } else if (source === "sale-labor") {
            const calc = calculateLabor({
              mode: input.mode,
              payee: input.payee,
              quantity: input.quantity,
              rateBaht: input.rateBaht,
            });
            changes = {
              ...changes,
              labor_date: input.date,
              mode: input.mode,
              basis_units: calc.basisUnits,
              rate_minor: calc.rateMinor,
              amount_minor: calc.amountMinor,
            };
          } else
            changes = {
              ...changes,
              debt_date: input.date,
              amount_minor: minor(input.amountBaht),
            };
        } catch (error) {
          if (error instanceof AppError) throw error;
          fail(
            "INVALID_AMOUNT",
            error instanceof Error ? error.message : "กรุณาตรวจจำนวน",
            422,
          );
        }
        if (source !== "sales" && changes.amount_minor < paid)
          fail(
            "AMOUNT_BELOW_PAID",
            "ยอดใหม่ต่ำกว่ายอดจ่ายที่มีผล กรุณาแก้ประวัติการจ่ายก่อน",
            422,
          );
        if (source === "expenses") {
          const attributionChanged =
            before.garden_id !== input.gardenId ||
            Number(before.amount_minor) !== changes.amount_minor;
          if (
            oldAllocations.length &&
            attributionChanged &&
            input.allocations === undefined
          )
            fail(
              "ALLOCATION_REVIEW_REQUIRED",
              "ยอดหรือสวนเปลี่ยน กรุณายืนยันชุดแบ่งใหม่ทั้งชุด",
              422,
            );
          if (input.allocations !== undefined) {
            const parts: Row[] = input.allocations.map((a: Row) => ({
              gardenId: a.gardenId,
              amountMinor: minor(a.amountBaht),
            }));
            if (
              (input.gardenId !== null && parts.length) ||
              (parts.length &&
                parts.reduce((s, p) => s + BigInt(p.amountMinor), 0n) !==
                  BigInt(changes.amount_minor))
            )
              fail(
                "ALLOCATION_TOTAL",
                "ชุดแบ่งต้องครบยอดรายจ่ายส่วนกลาง หรือยกเลิกการแบ่งทั้งชุด",
                422,
              );
            for (const a of [...parts].sort((a, b) =>
              a.gardenId.localeCompare(b.gardenId),
            ))
              await garden(
                db,
                owner,
                a.gardenId,
                oldAllocations.map((a) => a.garden_id),
              );
            await db.query(
              "delete from public.expense_allocations where expense_id=$1 and owner_id=$2",
              [id, owner.id],
            );
            changes.allocation_version = before.allocation_version + 1;
          }
        }
      }
      const keys = Object.keys(changes);
      const after = (
        await db.query(
          `update public.${sources[source]} set ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")} where id=$1 and owner_id=$2 returning *`,
          [id, owner.id, ...Object.values(changes)],
        )
      ).rows[0];
      if (!isVoid && source === "expenses" && input.allocations !== undefined)
        for (const a of [...input.allocations].sort((a, b) =>
          a.gardenId.localeCompare(b.gardenId),
        ))
          await db.query(
            "insert into public.expense_allocations(expense_id,owner_id,garden_id,amount_minor) values($1,$2,$3,$4)",
            [id, owner.id, a.gardenId, minor(a.amountBaht)],
          );
      await audit(
        db,
        owner.id,
        `entry.${isVoid ? "voided" : "edited"}`,
        id,
        { ...before, allocations: oldAllocations, deductions: oldDeductions },
        {
          ...after,
          reason: input.reason,
          allocations: input.allocations ?? oldAllocations,
          deductions: input.deductions ?? oldDeductions,
          acknowledgedLabor: input.laborVersions,
          voidedPaymentIds: isVoid ? active.map((p) => p.id) : [],
        },
      );
      return { id, version: after.version, voided: !!after.voided_at };
    },
  );
}

const filterSchema = z
  .object({
    gardenId: z.union([z.uuid(), z.literal("shared")]).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    source: z
      .enum(["sales", "expenses", "sale-labor", "opening-debts"])
      .optional(),
    kind: z
      .enum([
        "sale",
        "daily",
        "weight",
        "daily_labor",
        "weight_labor",
        "fertilizer",
        "material",
        "maintenance",
        "other",
        "opening_debt",
      ])
      .optional(),
    q: z.string().trim().max(120).optional(),
    paymentStatus: z.enum(["pending", "settled"]).optional(),
    status: z.enum(["active", "all", "voided"]).default("active"),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (f) => !f.from || !f.to || f.from <= f.to,
    "วันเริ่มต้องไม่เกินวันสิ้นสุด",
  );
async function listing(req: NextRequest, owner: Owner, csv: boolean) {
  const f = filterSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const params: unknown[] = [owner.id];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const conditions = ["r.owner_id=$1"];
  if (f.from) conditions.push(`r.business_date>=${add(f.from)}::date`);
  if (f.to) conditions.push(`r.business_date<=${add(f.to)}::date`);
  if (f.source) conditions.push(`r.source=${add(f.source)}`);
  if (f.kind) conditions.push(`r.kind=${add(f.kind)}`);
  if (f.q)
    conditions.push(
      `strpos(lower(concat_ws(' ',r.payee,r.note,r.invoice_number)),lower(${add(f.q)}))>0`,
    );
  if (f.status !== "all")
    conditions.push(
      `r.voided_at is ${f.status === "active" ? "null" : "not null"}`,
    );
  if (f.paymentStatus)
    conditions.push(
      f.paymentStatus === "pending"
        ? "r.pending_minor>0"
        : "r.source<>'sales' and r.voided_at is null and r.pending_minor=0",
    );
  const scoped =
    f.gardenId === "shared"
      ? "a.garden_id is null"
      : f.gardenId
        ? `a.garden_id=${add(f.gardenId)}::uuid`
        : "true";
  const openingScope =
    f.gardenId === "shared"
      ? "false"
      : f.gardenId
        ? `g.id=${add(f.gardenId)}::uuid`
        : "true";
  const includeOpening =
    !f.from &&
    !f.to &&
    !f.q &&
    !f.source &&
    !f.kind &&
    !f.paymentStatus &&
    f.status !== "voided";
  const limit = add(csv ? 25001 : f.pageSize),
    offset = add(csv ? 0 : (f.page - 1) * f.pageSize);
  const result = (
    await pool().query(
      `with matched as (
    select r.*,s.amount_minor selected_amount_minor,s.paid_minor selected_paid_minor,s.pending_minor selected_pending_minor,s.garden_names selected_garden_names,
      coalesce(g.name,'ส่วนกลาง') garden_name
    from private.ledger_records r join lateral (select sum(a.amount_minor)::bigint amount_minor,sum(a.paid_minor)::bigint paid_minor,sum(a.pending_minor)::bigint pending_minor,string_agg(coalesce(ag.name,'ส่วนกลาง'),' / ' order by ag.name,a.garden_id) garden_names from private.ledger_attributions a left join public.gardens ag on ag.id=a.garden_id and ag.owner_id=a.owner_id where a.source=r.source and a.id=r.id and a.owner_id=r.owner_id and ${scoped} having count(*)>0) s on true
    left join public.gardens g on g.id=r.garden_id and g.owner_id=r.owner_id where ${conditions.join(" and ")}
  ), attributed as (
    select r.voided_at,a.* from matched r join private.ledger_attributions a on a.id=r.id and a.source=r.source and a.owner_id=r.owner_id where ${scoped}
  ), groups as (
    select a.garden_id,coalesce(g.name,'ส่วนกลาง') garden_name,
      coalesce(sum(a.amount_minor) filter(where a.source='sales' and a.voided_at is null),0)::float8 income_minor,
      coalesce(sum(a.amount_minor) filter(where a.source in ('expenses','sale-labor') and a.voided_at is null),0)::float8 expense_minor,
      coalesce(sum(a.pending_minor) filter(where a.voided_at is null),0)::float8 pending_minor
    from attributed a left join public.gardens g on g.id=a.garden_id and g.owner_id=a.owner_id group by a.garden_id,g.name
  ), garden_groups as (
    select g.id garden_id,g.name garden_name,coalesce(s.income_minor,0)::float8 income_minor,coalesce(s.expense_minor,0)::float8 expense_minor,coalesce(s.pending_minor,0)::float8 pending_minor,g.opening_minor::float8 opening_minor from public.gardens g left join groups s on s.garden_id=g.id where g.owner_id=$1 and ${openingScope} and (${includeOpening ? "true" : "false"} or s.garden_id is not null)
    union all select garden_id,garden_name,income_minor,expense_minor,pending_minor,0::float8 from groups where garden_id is null
  ), totals as (
    select count(*)::int count,
      coalesce(sum(selected_amount_minor) filter(where source='sales' and voided_at is null),0)::float8 income_minor,
      coalesce(sum(selected_amount_minor) filter(where source in ('expenses','sale-labor') and voided_at is null),0)::float8 expense_minor,
      coalesce(sum(selected_pending_minor) filter(where voided_at is null),0)::float8 pending_minor
    from matched
  ) select to_jsonb(t) totals,
    coalesce((select sum(opening_minor) from public.gardens g where g.owner_id=$1 and ${openingScope}),0)::float8 opening_minor,
    coalesce((select jsonb_agg(to_jsonb(g) order by garden_name,garden_id) from garden_groups g),'[]'::jsonb) groups,
    coalesce((select jsonb_agg(to_jsonb(p) order by business_date desc,created_at desc,id,source) from (select *,to_char(business_date,'YYYY-MM-DD') date from matched order by business_date desc,created_at desc,id,source limit ${limit} offset ${offset}) p),'[]'::jsonb) entries from totals t`,
      params,
    )
  ).rows[0];
  if (csv) {
    if (result.totals.count > 25000)
      fail(
        "EXPORT_TOO_LARGE",
        "กรุณากรองให้เหลือไม่เกิน 25,000 รายการก่อนส่งออก",
        422,
      );
    return new NextResponse(csvDocument(result.entries), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="palm-ledger.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const movementMinor =
    result.totals.income_minor - result.totals.expense_minor;
  return json({
    entries: result.entries,
    total: result.totals.count,
    page: f.page,
    pageSize: f.pageSize,
    report: {
      incomeMinor: result.totals.income_minor,
      expenseMinor: result.totals.expense_minor,
      movementMinor,
      pendingMinor: result.totals.pending_minor,
      openingMinor: result.opening_minor,
      includesOpening: includeOpening,
      netMinor: movementMinor + (includeOpening ? result.opening_minor : 0),
      pendingAsOf: "current",
      gardens: result.groups.map((g: Row) => ({
        ...g,
        movement_minor: g.income_minor - g.expense_minor,
        net_minor:
          g.income_minor -
          g.expense_minor +
          (includeOpening ? g.opening_minor : 0),
      })),
    },
  });
}
export async function entryRoutes(
  req: NextRequest,
  owner: Owner,
  path: string[],
  deps: Dependencies,
): Promise<NextResponse | undefined> {
  if (path[0] !== "entries") return;
  if (
    req.method === "GET" &&
    (path.length === 1 || (path.length === 2 && path[1] === "export"))
  )
    return listing(req, owner, path[1] === "export");
  if (
    (path.length === 3 || (path.length === 4 && path[3] === "void")) &&
    Object.hasOwn(sources, path[1])
  ) {
    const source = path[1] as Source,
      id = z.uuid().parse(path[2]);
    if (req.method === "GET" && path.length === 3)
      return json(
        await transaction(async (db) => {
          await db.query(
            "set transaction isolation level repeatable read read only",
          );
          return detail(db, owner, source, id);
        }),
      );
    if (
      (req.method === "PATCH" && path.length === 3) ||
      (req.method === "POST" && path[3] === "void")
    )
      return mutate(req, owner, source, id, path.length === 4, deps);
  }
}
