import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceipt } from "../src/lib/receipt-parser";
import { calculateLabor } from "../src/lib/sale-math";

test("Thai receipt draft preserves decimal units, Buddhist date and printed net without creating data", () => {
  const result = parseReceipt(
    "ผู้รับซื้อ: ลานปาล์มทดสอบ\nเลขบิล: INV-001\nวันที่ 21/10/2569\nน้ำหนักสุทธิ 3,500.000 กก.\nราคาต่อกิโลกรัม 5.00 บาท\nค่าขนส่ง 500.00 บาท\nรวมยอดหัก 500.00 บาท\nยอดสุทธิ 17,000.00 บาท",
    90,
  );
  assert.equal(result.buyer, "ลานปาล์มทดสอบ");
  assert.equal(result.saleDate, "2026-10-21");
  assert.equal(result.invoiceNumber, "INV-001");
  assert.equal(result.weightKg, "3500.000");
  assert.equal(result.priceBahtPerKg, "5.00");
  assert.deepEqual(result.deductions, [
    { description: "ค่าขนส่ง", amountBaht: "500.00" },
  ]);
  assert.equal(result.printedNetBaht, "17000.00");
  assert.deepEqual(result.uncertainFields, []);
});
test("receipt parser does not use gross/tare weights or silently invent missing fields", () => {
  const result = parseReceipt(
    "วันที่ 31/02/2569\nGross weight 5000 kg\nTare weight 1500 kg\nTotal 17500.00",
    95,
  );
  assert.equal(result.saleDate, "");
  assert.equal(result.weightKg, "");
  assert.equal(result.priceBahtPerKg, "");
  assert.equal(result.buyer, "");
  assert.ok(result.uncertainFields.includes("weightKg"));
});
test("low confidence and totals that disagree require review; Thai numerals are normalized", () => {
  const result = parseReceipt(
    "ผู้ซื้อ ลานทดสอบ\nเลขที่ A-12\nวันที่ ๒๑/๑๐/๒๕๖๙\nNET WEIGHT 3500.000 KG\nPRICE 5.00\nNET AMOUNT 16000.00",
    40,
  );
  assert.equal(result.saleDate, "2026-10-21");
  assert.equal(result.weightKg, "3500.000");
  assert.ok(result.uncertainFields.includes("buyer"));
  assert.ok(result.uncertainFields.includes("deductions"));
});
test("total deductions are used only when individual deductions could not be read", () => {
  const result = parseReceipt("Total deductions 500.00", 90);
  assert.deepEqual(result.deductions, [
    { description: "ยอดหักตามบิล", amountBaht: "500.00" },
  ]);
});
test("weight labor uses kilograms and baht per ton with integer half-up rounding", () => {
  assert.deepEqual(
    calculateLabor({
      mode: "weight",
      payee: "ทีม",
      quantity: "3500",
      rateBaht: "1000",
    }),
    { basisUnits: 3500000, rateMinor: 100000, amountMinor: 350000 },
  );
  assert.equal(
    calculateLabor({
      mode: "weight",
      payee: "ทีม",
      quantity: "1.005",
      rateBaht: "1000",
    }).amountMinor,
    101,
  );
});
test("daily labor allows half days, rejects invalid intervals and cannot overflow", () => {
  assert.equal(
    calculateLabor({
      mode: "daily",
      payee: "คน",
      quantity: "0.5",
      rateBaht: "400",
    }).amountMinor,
    20000,
  );
  assert.equal(
    calculateLabor({
      mode: "daily",
      payee: "คน",
      quantity: "1.5",
      rateBaht: "350",
    }).amountMinor,
    52500,
  );
  for (const quantity of ["0.25", "-1", "0", "367"])
    assert.throws(() =>
      calculateLabor({ mode: "daily", payee: "คน", quantity, rateBaht: "400" }),
    );
  assert.throws(() =>
    calculateLabor({
      mode: "weight",
      payee: "ทีม",
      quantity: "9999999",
      rateBaht: "1000",
    }),
  );
});
