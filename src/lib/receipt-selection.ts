export type ReceiptSelection = {
  turns: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export const fullReceipt: ReceiptSelection = {
  turns: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

// Percentages refer to the upright image, after rotation. Reject invalid crops
// rather than silently reading a different part of a financial document.
export function receiptSelection(
  width: number,
  height: number,
  selection: ReceiptSelection,
) {
  const { turns, top, right, bottom, left } = selection;
  if (
    !Number.isInteger(turns) ||
    turns < 0 ||
    turns > 3 ||
    ![width, height].every((value) => Number.isFinite(value) && value > 0) ||
    ![top, right, bottom, left].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 40,
    )
  )
    throw new Error("ช่วงรูปบิลไม่ถูกต้อง");
  const rotatedWidth = turns % 2 ? height : width;
  const rotatedHeight = turns % 2 ? width : height;
  const x = Math.floor((rotatedWidth * left) / 100);
  const y = Math.floor((rotatedHeight * top) / 100);
  return {
    rotatedWidth,
    rotatedHeight,
    x,
    y,
    width: Math.max(1, Math.floor(rotatedWidth * (1 - right / 100)) - x),
    height: Math.max(1, Math.floor(rotatedHeight * (1 - bottom / 100)) - y),
  };
}
