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
const fields = [
  "saleDate",
  "buyer",
  "invoiceNumber",
  "weightKg",
  "priceBahtPerKg",
] as const;
// Thai OCR frequently separates vowels/tone marks and words. Use a canonical
// label only for matching; retain the original text for names and review.
const labelKey = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\s]/g, "")
    .toLowerCase();
const weightLabel = /นาหนกสทธ|นน\.?สทธ|netweight/;
const priceLabel =
  /ราคาตอกโลกรม|ราคาตอกก\.?|ราคา\/?กก\.?|บาท\/(?:กก\.?|kg)|price(?:perkg)?|rateperkg|ราคา/;
const totalLabel =
  /รวมราคาทงสน|รวมราคาทงหมด|รวมเงนสทธ|เงนสทธ|รบสทธ|ยอดสทธ|เปนเงน|net(?:total|amount)|amountpaid/;
const otherLabel = /ราคา|วนท|date|นาหนก|weight|ยอด|total|รวม/;
function originalTail(line: string, canonicalEnd: number) {
  let offset = 0,
    length = 0;
  for (const char of line) {
    offset += char.length;
    length += labelKey(char).length;
    if (length >= canonicalEnd) break;
  }
  return line.slice(offset);
}
function decimal(text: string, places: number) {
  const value = text.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "";
  if (
    !new RegExp(
      `^(?:\\d{1,7}|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,${places}})?$`,
    ).test(value)
  )
    return "";
  return value.replaceAll(",", "");
}
function afterNumber(
  lines: string[],
  index: number,
  label: RegExp,
  places: number,
) {
  const key = labelKey(lines[index]),
    match = label.exec(key);
  if (!match) return "";
  const tail = key.slice(match.index + match[0].length);
  const nextLabel = tail.search(otherLabel);
  const value = decimal(
    nextLabel >= 0 ? tail.slice(0, nextLabel) : tail,
    places,
  );
  if (value) return value;
  // Do not borrow a value from a different labeled field when OCR split cells.
  if (nextLabel >= 0) return "";
  for (const line of lines.slice(index + 1, index + 3)) {
    const next = labelKey(line);
    if (/^[:：|\-]*\d[\d,.]*(?:บาท|baht|กก\.?|kg)?$/.test(next))
      return decimal(next, places);
    if (otherLabel.test(next)) break;
  }
  return "";
}
function dateValue(text: string) {
  const date = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (!date) return "";
  const year = Number(date[3]) > 2400 ? Number(date[3]) - 543 : Number(date[3]);
  const iso = `${year}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
  return year >= 2000 &&
    year <= 2100 &&
    !Number.isNaN(Date.parse(iso)) &&
    new Date(iso).toISOString().slice(0, 10) === iso
    ? iso
    : "";
}
function companyName(line: string) {
  const key = labelKey(line),
    end = key.match(/จากด/);
  if (!/^(?:บรษท|บรสท|บรษต)/.test(key) || !end) return "";
  const length = end.index! + end[0].length;
  let originalEnd = 0,
    canonicalLength = 0;
  for (const char of line) {
    originalEnd += char.length;
    canonicalLength += labelKey(char).length;
    if (canonicalLength >= length) break;
  }
  const location =
    line.slice(originalEnd).match(/^\s*(\([^)]{1,40}\))/)?.[1] ?? "";
  return (
    line.slice(0, originalEnd).trim() + (location ? " " + location : "")
  ).slice(0, 120);
}
function checkAmounts(draft: ReceiptDraft) {
  if (!draft.weightKg || !draft.priceBahtPerKg || !draft.printedNetBaht)
    return false;
  try {
    const computed = calculateSale(
      draft.weightKg,
      draft.priceBahtPerKg,
      draft.deductions.map((v) => v.amountBaht),
    );
    return (
      Math.abs(
        computed.netMinor - Math.round(Number(draft.printedNetBaht) * 100),
      ) <= 1
    );
  } catch {
    return false;
  }
}
export function needsReceiptRetry(draft: ReceiptDraft) {
  return (
    !draft.weightKg ||
    !draft.priceBahtPerKg ||
    !draft.invoiceNumber ||
    !draft.saleDate ||
    !draft.printedNetBaht ||
    !checkAmounts(draft)
  );
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
  for (const [index, line] of lines.entries()) {
    const compact = line.replace(/\s+/g, ""),
      key = labelKey(line);
    if (/วนท|วนเอกสาร|date/.test(key) && !draft.saleDate) {
      draft.saleDate = dateValue(line) || dateValue(lines[index + 1] ?? "");
    }
    if (
      !draft.invoiceNumber &&
      !/ทะเบยน|registration|หม\d|ทอย|ตาบล|อาเภอ|จงหวด|ต\.|อ\.|จ\.|โทร/.test(key)
    ) {
      const label =
        /(?:ใบชง(?:นาหนก)?เลขท|เลขท(?:บล|ใบชง)?|เลขบล|(?:invoice|receipt|ticket)(?:no\.?|number)?)/.exec(
          key,
        );
      if (label) {
        const tail = originalTail(line, label.index! + label[0].length).trim();
        const candidate = labelKey(
          (labelKey(tail).replace(/^[:：#.|]+/, "")
            ? tail
            : lines[index + 1] || ""
          )
            // A table row can contain an unlabeled date beside the invoice.
            // Keep that boundary before canonicalization removes spaces.
            .replace(/\s+\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}.*$/, ""),
        ).replace(/^[:：#.|]+/, "");
        const invoice = candidate.match(/^([a-z\d][a-z\d/\-]{0,79})/i)?.[1];
        if (invoice) draft.invoiceNumber = invoice.toUpperCase();
      }
    }
    if (!draft.buyer) {
      const buyer = line.match(
        /(?:ผู้รับซื้อ|ผู้ซื้อ|buyer|purchaser)\s*[:：]?\s*(.+)/i,
      );
      if (buyer) draft.buyer = buyer[1].slice(0, 120).trim();
      else
        draft.buyer =
          companyName(line) ||
          (/^(?:ลานปาล์ม|โรงงาน)/.test(compact) ||
          (/ลาน(?:เท)?ปาลม/.test(key) && !/ผขาย|ลกคา|ทอย|โทร|ราคา/.test(key))
            ? line.slice(0, 120)
            : "");
    }
    if (!draft.weightKg)
      draft.weightKg = afterNumber(lines, index, weightLabel, 3);
    // The price and total can be on the SAME line. Read the first amount after
    // its own label, never the final number of the entire row.
    if (!draft.priceBahtPerKg && !/^รวมราคา|^total/.test(key))
      draft.priceBahtPerKg = afterNumber(lines, index, priceLabel, 2);
    if (/รวม(?:ยอด)?หก|ยอดหกรวม|totaldeductions/.test(key))
      totalDeduction = afterNumber(
        lines,
        index,
        /รวม(?:ยอด)?หก|ยอดหกรวม|totaldeductions/,
        2,
      );
    else if (
      /คาขนสง|คาชง|คาบรรทก|คาความชน|^หก|deduction|transport/.test(key) &&
      !/นาหนก|กก\.?|weight|%/.test(key)
    ) {
      const amount = decimal(key, 2);
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
    if (!draft.printedNetBaht)
      draft.printedNetBaht = afterNumber(lines, index, totalLabel, 2);
  }
  if (!draft.saleDate) {
    const dates = [...new Set(lines.map(dateValue).filter(Boolean))];
    if (dates.length === 1) {
      draft.saleDate = dates[0];
      draft.uncertainFields.push("saleDate");
    }
  }
  if (!draft.deductions.length && totalDeduction && Number(totalDeduction) > 0)
    draft.deductions.push({
      description: "ยอดหักตามบิล",
      amountBaht: totalDeduction,
    });
  if (
    totalDeduction &&
    Math.abs(
      draft.deductions.reduce((sum, v) => sum + Number(v.amountBaht), 0) -
        Number(totalDeduction),
    ) > 0.009
  )
    draft.uncertainFields.push("deductions");
  for (const field of fields)
    if (!draft[field] || confidence < 75) draft.uncertainFields.push(field);
  if (
    draft.weightKg &&
    draft.priceBahtPerKg &&
    draft.printedNetBaht &&
    !checkAmounts(draft)
  )
    draft.uncertainFields.push("weightKg", "priceBahtPerKg", "deductions");
  draft.uncertainFields = [...new Set(draft.uncertainFields)];
  return draft;
}
export function mergeReceiptDrafts(drafts: ReceiptDraft[]): ReceiptDraft {
  const score = (d: ReceiptDraft) =>
    fields.filter((f) => d[f]).length +
    (d.weightKg ? 3 : 0) +
    (d.priceBahtPerKg ? 3 : 0) +
    (checkAmounts(d) ? 10 : 0);
  const sorted = [...drafts].sort((a, b) => score(b) - score(a));
  const result = {
    ...sorted[0],
    uncertainFields: [...sorted[0].uncertainFields],
  };
  const uncertain = new Set(result.uncertainFields);
  for (const draft of sorted.slice(1))
    for (const field of fields) {
      if (!result[field] && draft[field]) {
        result[field] = draft[field];
        if (!draft.uncertainFields.includes(field)) uncertain.delete(field);
      } else if (
        result[field] &&
        draft[field] &&
        (field === "weightKg" || field === "priceBahtPerKg"
          ? Number(result[field]) !== Number(draft[field])
          : result[field] !== draft[field])
      )
        uncertain.add(field);
    }
  if (!result.printedNetBaht)
    result.printedNetBaht =
      sorted.find((d) => d.printedNetBaht)?.printedNetBaht ?? "";
  if (!result.deductions.length) {
    const withDeductions = sorted.find((d) => d.deductions.length);
    if (withDeductions) {
      result.deductions = withDeductions.deductions;
      uncertain.add("deductions");
    }
  }
  if (result.printedNetBaht && !checkAmounts(result)) {
    uncertain.add("weightKg");
    uncertain.add("priceBahtPerKg");
    uncertain.add("deductions");
  }
  result.uncertainFields = [...uncertain];
  return result;
}

// A faint thousands comma may be recognized as a dot. Reinterpret that separator
// only when the printed price and total independently agree; always flag review.
export function recoverReceiptWeight(
  draft: ReceiptDraft,
  text: string,
): ReceiptDraft | null {
  const numeric = text.trim().replace(/\s/g, "");
  if (!/^\d[\d,.]*$/.test(numeric)) return null;
  const values = [decimal(numeric, 3)];
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numeric))
    values.push(numeric.replaceAll(".", ""));
  for (const weightKg of values.filter(Boolean)) {
    const candidate = {
      ...draft,
      weightKg,
      uncertainFields: [...new Set([...draft.uncertainFields, "weightKg"])],
      text: draft.text + "\nน้ำหนักสุทธิ (อ่านช่องตารางซ้ำ): " + numeric,
    };
    if (checkAmounts(candidate)) return candidate;
  }
  return null;
}
