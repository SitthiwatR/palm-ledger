import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateExpense, type ExpenseInput } from "../src/lib/expense-math";
const base: ExpenseInput = {
  gardenId: "",
  expenseDate: "2026-10-21",
  kind: "other",
  payee: "ทดสอบ",
  note: "",
  unit: "item",
  quantity: "1",
  rateBaht: "1",
  paymentStatus: "unpaid",
  paidBaht: "0",
  rememberRate: true,
};
test("expense arithmetic rounds half cents up at the final result and retains safe integer JSON values", () => {
  assert.equal(
    calculateExpense({ ...base, quantity: "0.5", rateBaht: "0.01" })
      .amountMinor,
    1,
  );
  assert.equal(
    calculateExpense({ ...base, quantity: "0.333", rateBaht: "0.05" })
      .amountMinor,
    2,
  );
  assert.equal(
    calculateExpense({
      ...base,
      quantity: "4",
      rateBaht: "800",
      kind: "fertilizer",
      unit: "sack",
    }).amountMinor,
    320000,
  );
  assert.equal(
    calculateExpense({
      ...base,
      quantity: "0.500",
      rateBaht: "500",
      kind: "daily_labor",
      unit: "day",
    }).amountMinor,
    25000,
  );
  const large = calculateExpense({
    ...base,
    quantity: "90",
    rateBaht: "999999999.99",
    paymentStatus: "partial",
    paidBaht: "1000000000",
    paymentDate: "2026-10-21",
  });
  assert.equal(large.amountMinor, 8999999999910);
});
