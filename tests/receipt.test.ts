import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceipt } from "../src/lib/receipt-parser";
import { calculateLabor } from "../src/lib/sale-math";
import { mergeReceiptDrafts } from "../src/lib/receipt-parser";
import { receiptRows } from "../src/lib/receipt-layout";
import {
  paperBounds,
  receiptInk,
  receiptSkew,
  removeReceiptRules,
} from "../src/lib/receipt-pixels";

test("blue weigh-slip format pairs each amount with its label on a multi-column price row", () => {
  const result = parseReceipt(
    "บริษัท สวนตัวอย่าง ออยล์ จำกัด (ตัวอย่าง)\nนน. รวม 13,500 กก.\nเลขทะเบียนรถ 5093\nใบชั่งน้ำหนักเลขที่ TEST-12345\nวันที่เอกสาร 28/08/2569\n28/8/2569 ชั่งเข้า 10:33:10 3,465\n28/8/2569 ชั่งออก 10:37:36 1,985\nน้ำหนักสุทธิ 1,480\nราคา/กก. 8.70 บาท รวมราคาทั้งสิ้น 12,876.00 บาท",
    90,
  );
  assert.equal(result.weightKg, "1480");
  assert.equal(result.priceBahtPerKg, "8.70");
  assert.equal(result.printedNetBaht, "12876.00");
  assert.equal(result.saleDate, "2026-08-28");
  assert.equal(result.invoiceNumber, "TEST-12345");
  assert.match(result.buyer, /^บริษัท/);
  assert.equal(result.deductions.length, 0);
});
test("split OCR cells and detached Thai tone marks retain field relationships", () => {
  const result = parseReceipt(
    "ใบชั่งน้ําหนักเลขที่\nTEST-12345\nวันที่เอกสาร\n28/08/2569\nน้ํา หนัก สุทธิ\n1,480\nราคา/กก.\n8.70\nรวมราคาทั้งสิ้น\n12,876.00",
    85,
  );
  assert.equal(result.invoiceNumber, "TEST-12345");
  assert.equal(result.weightKg, "1480");
  assert.equal(result.priceBahtPerKg, "8.70");
  assert.equal(result.printedNetBaht, "12876.00");
});
test("OCR word positions rebuild table rows rather than reading columns top to bottom", () => {
  const word = (text: string, x: number, y: number) => ({
    text,
    confidence: 90,
    bbox: { x0: x, y0: y, x1: x + 60, y1: y + 20 },
  });
  const rows = receiptRows([
    word("1,480", 800, 102),
    word("น้ำหนักสุทธิ", 300, 100),
    word("8.70", 200, 200),
    word("ราคา/กก.", 20, 200),
    word("รวมราคาทั้งสิ้น", 400, 200),
    word("12,876.00", 800, 201),
  ]);
  const result = parseReceipt(rows, 90);
  assert.equal(result.weightKg, "1480");
  assert.equal(result.priceBahtPerKg, "8.70");
  assert.equal(result.printedNetBaht, "12876.00");
});
test("multiple OCR passes prefer a consistent printed amount and flag conflicting values", () => {
  const first = parseReceipt(
    "น้ำหนักสุทธิ 1480\nราคา 12876.00\nยอดสุทธิ 12876.00",
    90,
  );
  const second = parseReceipt(
    "น้ำหนักสุทธิ 1480\nราคา 8.70\nยอดสุทธิ 12876.00",
    90,
  );
  const result = mergeReceiptDrafts([first, second]);
  assert.equal(result.priceBahtPerKg, "8.70");
  assert.ok(result.uncertainFields.includes("priceBahtPerKg"));
});
test("paper detection excludes a blue keyboard and dark background", () => {
  const width = 200,
    height = 200,
    pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        paper = x >= 20 && x < 180 && y >= 40 && y < 140;
      pixels[i] = paper ? 230 : 60;
      pixels[i + 1] = paper ? 225 : 100;
      pixels[i + 2] = paper ? 200 : 180;
      pixels[i + 3] = 255;
    }
  const bounds = paperBounds(pixels, width, height);
  assert.ok(bounds.x <= 20 && bounds.x > 10);
  assert.ok(bounds.y <= 40 && bounds.y > 30);
  assert.ok(bounds.height < 120);
});
test("local contrast preserves blue ink and removes long table rules while retaining glyphs", () => {
  const width = 200,
    height = 160,
    pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const ink =
        (y >= 80 && y < 83 && x >= 10 && x < 190) ||
        (x >= 40 && x < 43 && y >= 20 && y < 40);
      const i = (y * width + x) * 4;
      pixels[i] = ink ? 90 : 230;
      pixels[i + 1] = ink ? 130 : 225;
      pixels[i + 2] = ink ? 180 : 210;
      pixels[i + 3] = 255;
    }
  const mask = receiptInk(pixels, width, height),
    clean = removeReceiptRules(mask, width, height);
  assert.equal(mask[81 * width + 100], 1);
  assert.equal(clean[81 * width + 100], 0);
  assert.equal(clean[25 * width + 41], 1);
});
test("deskew estimates a slight photographed table rotation", () => {
  const width = 300,
    height = 180,
    mask = new Uint8Array(width * height);
  for (const start of [40, 90, 140])
    for (let x = 10; x < 290; x++)
      for (let dy = 0; dy < 3; dy++)
        mask[(Math.round(start - x * 0.035) + dy) * width + x] = 1;
  assert.ok(Math.abs(receiptSkew(mask, width, height) + 2) < 0.8);
});

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

test("focused net cell resolves a faint thousands separator only against printed amounts", async () => {
  const { recoverReceiptWeight } = await import("../src/lib/receipt-parser");
  const base = parseReceipt(
    "ราคา/กก. 8.70 บาท รวมราคาทั้งสิ้น 12,876.00 บาท",
    85,
  );
  const result = recoverReceiptWeight(base, "1.480");
  assert.equal(result?.weightKg, "1480");
  assert.ok(result?.uncertainFields.includes("weightKg"));
  const wrong = parseReceipt(
    "น้ำหนักสุทธิ 1.480\nราคา/กก. 8.70 บาท รวมราคาทั้งสิ้น 12,876.00 บาท",
    85,
  );
  assert.equal(
    mergeReceiptDrafts([wrong, recoverReceiptWeight(wrong, "1.480")!]).weightKg,
    "1480",
  );
  assert.equal(recoverReceiptWeight(base, "3,465"), null);
  assert.equal(
    recoverReceiptWeight(parseReceipt("ราคา/กก. 8.70", 85), "1.480"),
    null,
  );
  assert.equal(recoverReceiptWeight(base, "1,480 1,985"), null);
});
test("targeted table reading requires an explicit net label and uses its row", async () => {
  const { netWeightRegion } = await import("../src/lib/receipt-layout");
  const word = (text: string, x: number, y: number) => ({
    text,
    confidence: 90,
    bbox: { x0: x, y0: y, x1: x + 100, y1: y + 20 },
  });
  assert.equal(
    netWeightRegion([word("ชั่งเข้า", 20, 30), word("3465", 500, 30)]),
    null,
  );
  const region = netWeightRegion([
    word("น้ำหนักสุทธิ", 200, 100),
    word("1480", 800, 101),
  ]);
  assert.ok(
    region &&
      region.x > 300 &&
      region.y < 100 &&
      region.y + region.height > 120,
  );
});

test("slanted table rules and dotted separators are removed without deleting short glyphs", () => {
  const width = 400,
    height = 200,
    mask = new Uint8Array(width * height);
  for (let x = 20; x < 380; x++)
    for (let dy = 0; dy < 3; dy++)
      if (x % 8 < 5)
        mask[(80 + Math.round(x * Math.tan(Math.PI / 180)) + dy) * width + x] =
          1;
  for (let y = 120; y < 140; y++)
    for (let x = 200; x < 203; x++) mask[y * width + x] = 1;
  const clean = removeReceiptRules(mask, width, height);
  assert.equal(clean[83 * width + 200], 0);
  assert.equal(clean[125 * width + 201], 1);
});
