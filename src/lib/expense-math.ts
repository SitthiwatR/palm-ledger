import { z } from "zod";
import { calculateLabor, scaled } from "./sale-math";

export const expenseKinds = {
  daily_labor: "ค่าแรงรายวัน",
  fertilizer: "ปุ๋ยที่ใช้จริง",
  material: "วัตถุดิบ",
  maintenance: "บำรุงรักษา",
  other: "รายจ่ายอื่น",
} as const;
export const expenseRequest = z
  .object({
    gardenId: z.uuid(),
    expenseDate: z.iso.date(),
    kind: z.enum([
      "daily_labor",
      "fertilizer",
      "material",
      "maintenance",
      "other",
    ]),
    payee: z.string().trim().min(1).max(120),
    note: z.string().trim().max(2000).default(""),
    unit: z.enum(["day", "sack", "item"]),
    quantity: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/),
    rateBaht: z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/),
    paymentStatus: z.enum(["full", "partial", "unpaid"]),
    paidBaht: z
      .string()
      .regex(/^\d{1,11}(?:\.\d{1,2})?$/)
      .default("0"),
    paymentDate: z.iso.date().optional(),
    pendingReceiptId: z.uuid().optional(),
    rememberRate: z.boolean().default(true),
  })
  .strict();
export type ExpenseInput = z.infer<typeof expenseRequest>;
export function calculateExpense(input: ExpenseInput) {
  const expectedUnit =
    input.kind === "daily_labor"
      ? "day"
      : input.kind === "fertilizer"
        ? "sack"
        : "item";
  if (input.unit !== expectedUnit) throw new Error("หน่วยไม่ตรงกับชนิดรายจ่าย");
  const quantity = scaled(input.quantity, 3),
    rate = scaled(input.rateBaht, 2);
  if (
    quantity < 1n ||
    quantity > 1_000_000_000n ||
    rate < 1n ||
    rate > 100_000_000_000n
  )
    throw new Error("กรุณาตรวจจำนวนและอัตรารายจ่าย");
  const amount =
    input.kind === "daily_labor"
      ? BigInt(
          calculateLabor({
            mode: "daily",
            payee: input.payee,
            quantity: String(Number(quantity) / 1000),
            rateBaht: input.rateBaht,
          }).amountMinor,
        )
      : (quantity * rate + 500n) / 1000n;
  if (amount < 1n || amount > 9_000_000_000_000n)
    throw new Error("ยอดรายจ่ายเกินขอบเขตที่รองรับ");
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(input.paidBaht))
    throw new Error("รูปแบบยอดจ่ายไม่ถูกต้อง");
  const [whole, fraction = ""] = input.paidBaht.split(".");
  const specified = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (
    (input.paymentStatus !== "partial" && specified !== 0n) ||
    (input.paymentStatus === "partial" &&
      (specified < 1n || specified >= amount))
  )
    throw new Error("ยอดจ่ายบางส่วนต้องมากกว่าศูนย์และน้อยกว่ายอดเต็ม");
  const paid =
    input.paymentStatus === "full"
      ? amount
      : input.paymentStatus === "partial"
        ? specified
        : 0n;
  if (paid > 0n && !input.paymentDate)
    throw new Error("กรุณาระบุวันที่จ่ายครั้งแรก");
  if (paid === 0n && input.paymentDate)
    throw new Error("ยังไม่จ่ายต้องไม่มีวันที่จ่าย");
  return {
    quantityMilli: Number(quantity),
    rateMinor: Number(rate),
    amountMinor: Number(amount),
    paidMinor: Number(paid),
  };
}
