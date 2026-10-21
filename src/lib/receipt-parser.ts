import { calculateSale } from "./sale-math";
export type ReceiptDraft = {
  saleDate: string;
  buyer: string;
  invoiceNumber: string;
  weightKg: string;
  priceBahtPerKg: string;
  deductions: { description: string; amountBaht: string }[];
  printedNetBaht: string;
  uncertainFields: string[];
  text: string;
};
const numberPattern = /\d[\d,]*(?:\.\d+)?/g;
function decimal(text: string, places: number) {
  const value = text.match(numberPattern)?.at(-1)?.replaceAll(",", "") ?? "";
  if (!new RegExp(`^\\d{1,7}(?:\\.\\d{1,${places}})?$`).test(value)) return "";
  return value;
}
export function parseReceipt(text: string, confidence: number): ReceiptDraft {
  const normalized = text
    .normalize("NFC")
    .replace(/[๐-๙]/g, (v) => String(v.charCodeAt(0) - 0xe50));
  const lines = normalized
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  const draft: ReceiptDraft = {
    saleDate: "",
    buyer: "",
    invoiceNumber: "",
    weightKg: "",
    priceBahtPerKg: "",
    deductions: [],
    printedNetBaht: "",
    uncertainFields: [],
    text: normalized,
  };
  let totalDeduction = "";
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    if (/วันที่|date/i.test(line) && !draft.saleDate) {
      const date = line.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
      if (date) {
        const year =
          Number(date[3]) > 2400 ? Number(date[3]) - 543 : Number(date[3]);
        const iso = `${year}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
        if (
          year >= 2000 &&
          year <= 2100 &&
          !Number.isNaN(Date.parse(iso)) &&
          new Date(iso).toISOString().slice(0, 10) === iso
        )
          draft.saleDate = iso;
      }
    }
    if (!draft.invoiceNumber) {
      const invoice = line.match(
        /(?:เลข(?:ที่(?:บิล|ใบชั่ง)?|บิล)|(?:invoice|receipt|ticket)\s*(?:no\.?|number)?)[\s:#.]*([\p{L}\d][\p{L}\d/\-]{0,79})/iu,
      );
      if (invoice) draft.invoiceNumber = invoice[1];
    }
    if (!draft.buyer) {
      const buyer = line.match(
        /(?:ผู้รับซื้อ|ผู้ซื้อ|buyer|purchaser)\s*[:：]?\s*(.+)/i,
      );
      if (buyer) draft.buyer = buyer[1].slice(0, 120).trim();
      else if (/^(?:ลานปาล์ม|โรงงาน|บริษัท)/.test(line))
        draft.buyer = line.slice(0, 120);
    }
    if (
      /(?:น้ำหนักสุทธิ|น้ําหนักสุทธิ|นํ้าหนักสุทธิ|น้าหนักสุทธิ|นน\.?สุทธิ|netweight)/i.test(
        compact,
      )
    ) {
      const value = decimal(compact, 3);
      if (value && !draft.weightKg) draft.weightKg = value;
    }
    if (
      /(?:ราคา(?:ต่อ|\/)?(?:กิโลกรัม|กก\.?)?|บาท\/(?:กก\.?|kg)|price(?:perkg)?|rateperkg)/i.test(
        compact,
      ) &&
      !/รวม|total/i.test(compact)
    ) {
      const value = decimal(compact, 2);
      if (value && !draft.priceBahtPerKg) draft.priceBahtPerKg = value;
    }
    if (/รวม(?:ยอด)?หัก|ยอดหักรวม|totaldeductions/i.test(compact))
      totalDeduction = decimal(compact, 2);
    else if (
      /ค่าขนส่ง|ค่าชั่ง|ค่าบรรทุก|ค่าความชื้น|^หัก|deduction|transport/i.test(
        compact,
      ) &&
      !/น้ำหนัก|น้ําหนัก|กก\.?|weight|%/i.test(compact)
    ) {
      const amount = decimal(compact, 2);
      const description = line
        .replace(/[\d,]+(?:\.\d+)?\s*(?:บาท|baht)?\s*$/i, "")
        .replace(/[:：\-]\s*$/, "")
        .trim();
      if (amount && Number(amount) > 0 && description)
        draft.deductions.push({
          description: description.slice(0, 120),
          amountBaht: amount,
        });
    }
    if (
      /เงินสุทธิ|รับสุทธิ|ยอดสุทธิ|net(?:total|amount)|amountpaid/i.test(
        compact,
      ) &&
      !/น้ำหนัก|น้ําหนัก|weight/i.test(compact)
    )
      draft.printedNetBaht = decimal(compact, 2);
  }
  if (!draft.deductions.length && totalDeduction && Number(totalDeduction) > 0)
    draft.deductions.push({
      description: "ยอดหักตามบิล",
      amountBaht: totalDeduction,
    });
  if (
    totalDeduction &&
    draft.deductions.length &&
    Math.abs(
      draft.deductions.reduce((sum, v) => sum + Number(v.amountBaht), 0) -
        Number(totalDeduction),
    ) > 0.009
  )
    draft.uncertainFields.push("deductions");
  for (const field of [
    "saleDate",
    "buyer",
    "invoiceNumber",
    "weightKg",
    "priceBahtPerKg",
  ] as const) {
    if (!draft[field] || confidence < 75) draft.uncertainFields.push(field);
  }
  if (draft.weightKg && draft.priceBahtPerKg && draft.printedNetBaht) {
    const computed = calculateSale(
      draft.weightKg,
      draft.priceBahtPerKg,
      draft.deductions.map((v) => v.amountBaht),
    );
    if (
      Math.abs(
        computed.netMinor - Math.round(Number(draft.printedNetBaht) * 100),
      ) > 1
    )
      draft.uncertainFields.push("weightKg", "priceBahtPerKg", "deductions");
  }
  draft.uncertainFields = [...new Set(draft.uncertainFields)];
  return draft;
}
