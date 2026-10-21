export type ReceiptWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

// Sparse OCR often returns each table cell in a separate paragraph. Reconstruct
// physical rows before interpreting labels so a right-hand value stays with it.
export function receiptRowGroups(words: ReceiptWord[]) {
  const rows: { words: ReceiptWord[]; center: number; height: number }[] = [];
  for (const word of words
    .filter((w) => w.text.trim())
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows
      .filter(
        (r) => Math.abs(r.center - center) <= Math.max(r.height, height) * 0.55,
      )
      .sort(
        (a, b) => Math.abs(a.center - center) - Math.abs(b.center - center),
      )[0];
    if (row) {
      row.center =
        (row.center * row.words.length + center) / (row.words.length + 1);
      row.height = Math.max(row.height, height);
      row.words.push(word);
    } else rows.push({ words: [word], center, height });
  }
  return rows
    .sort((a, b) => a.center - b.center)
    .map((row) => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

export function receiptRows(words: ReceiptWord[]) {
  return receiptRowGroups(words)
    .map((row) => row.map((w) => w.text.trim()).join(" "))
    .join("\n");
}

// Only target a value to the right of an explicitly recognized net-weight label.
export function netWeightRegion(words: ReceiptWord[]) {
  for (const row of receiptRowGroups(words)) {
    const label: ReceiptWord[] = [];
    for (const word of row) {
      label.push(word);
      const key = label
        .map((w) => w.text)
        .join("")
        .normalize("NFKD")
        .replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\s]/g, "")
        .toLowerCase();
      if (/นาหนกสทธ|นน\.?สทธ|netweight/.test(key)) {
        const top = Math.min(...label.map((w) => w.bbox.y0)),
          bottom = Math.max(...label.map((w) => w.bbox.y1));
        return {
          x: Math.max(...label.map((w) => w.bbox.x1)) + 8,
          y: Math.max(0, Math.floor(top - (bottom - top) * 0.3)),
          height: Math.ceil((bottom - top) * 1.6),
        };
      }
    }
  }
  return null;
}
