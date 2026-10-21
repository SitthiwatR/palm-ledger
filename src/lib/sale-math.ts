export type LaborInput = {
  mode: "daily" | "weight";
  payee: string;
  quantity: string;
  rateBaht: string;
  rememberRate?: boolean;
};

export function scaled(value: string, places: number): bigint {
  if (!new RegExp(`^\\d{1,9}(?:\\.\\d{1,${places}})?$`).test(value))
    throw new Error("รูปแบบจำนวนไม่ถูกต้อง");
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"))
  );
}

export function calculateLabor(item: LaborInput) {
  const rate = scaled(item.rateBaht, 2);
  const quantity = scaled(item.quantity, item.mode === "daily" ? 1 : 3);
  if (rate < 1n || rate > 100_000_000n || quantity < 1n)
    throw new Error("กรุณาตรวจจำนวนและอัตราค่าแรง");
  if (item.mode === "daily" && (quantity % 5n !== 0n || quantity > 3660n))
    throw new Error("จำนวนวันต้องเป็นขั้นครึ่งวัน ไม่เกิน 366 วัน");
  if (item.mode === "weight" && quantity > 1_000_000_000n)
    throw new Error("น้ำหนักคิดค่าแรงเกินขอบเขตที่รองรับ");
  const divisor = item.mode === "daily" ? 10n : 1_000_000n;
  const amount = (quantity * rate + divisor / 2n) / divisor;
  if (amount < 1n || amount > 9_000_000_000_000n)
    throw new Error("ยอดค่าแรงเกินขอบเขตที่รองรับ");
  return {
    basisUnits: Number(item.mode === "daily" ? quantity / 5n : quantity),
    rateMinor: Number(rate),
    amountMinor: Number(amount),
  };
}

export function calculateSale(
  weight: string,
  price: string,
  deductions: string[],
) {
  const grams = scaled(weight, 3),
    rate = scaled(price, 2);
  const gross = (grams * rate + 500n) / 1000n;
  const deduction = deductions.reduce(
    (sum, value) => sum + scaled(value, 2),
    0n,
  );
  return { grossMinor: Number(gross), netMinor: Number(gross - deduction) };
}
