// Quote every field, preserve Thai/newlines, and neutralize spreadsheet formulas
// in all text (including whitespace/control-prefixed payloads).
export function csvText(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
import { expenseKinds } from "./expense-math";
const kindNames: Record<string, string> = {
  ...expenseKinds,
  sale: "ขายผลผลิต",
  daily: "ค่าแรงรายวันผูกบิล",
  weight: "ค่าแรงทีมผูกบิล",
  opening_debt: "หนี้ก่อนเริ่มระบบ",
};
const names: Record<string, string> = {
  sales: "ขายผลผลิต",
  expenses: "รายจ่าย",
  "sale-labor": "ค่าแรงผูกบิล",
  "opening-debts": "หนี้ก่อนเริ่มระบบ",
};
export function csvDocument(rows: Record<string, any>[]) {
  const header = [
    "วันที่",
    "ประเภท",
    "ชนิด",
    "สวนต้นทาง",
    "สวนตามตัวกรอง",
    "ผู้ซื้อ/ผู้รับเงิน",
    "เลขบิล",
    "หมายเหตุ",
    "ยอดตามตัวกรอง (บาท)",
    "จ่ายแล้วตามตัวกรอง (บาท)",
    "ค้างปัจจุบันตามตัวกรอง (บาท)",
    "สถานะ",
    "เวอร์ชัน",
    "เหตุผลยกเลิก",
    "รหัสรายการ",
    "ยอดเต็มต้นทาง (บาท)",
  ];
  return (
    "\ufeff" +
    [
      header,
      ...rows.map((r) => [
        r.date,
        names[r.source],
        kindNames[r.kind],
        r.garden_name,
        r.selected_garden_names,
        r.payee,
        r.invoice_number,
        r.note,
        (Number(r.selected_amount_minor) / 100).toFixed(2),
        (Number(r.selected_paid_minor) / 100).toFixed(2),
        (Number(r.selected_pending_minor) / 100).toFixed(2),
        r.voided_at ? "ยกเลิก" : "ใช้งาน",
        r.version,
        r.void_reason,
        r.id,
        (Number(r.amount_minor) / 100).toFixed(2),
      ]),
    ]
      .map((row) => row.map(csvText).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
