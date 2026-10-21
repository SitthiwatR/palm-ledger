import type { Page } from "@playwright/test";
export async function receiptFixture(page: Page, invoice = "BROWSER-001") {
  const image = await page.evaluate(async (invoice) => {
    await document.fonts.load('400 40px "Noto Sans Thai"');
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "black";
    ctx.font = '400 40px "Noto Sans Thai"';
    [
      "ผู้รับซื้อ: ลานปาล์มทดสอบ",
      `เลขบิล: ${invoice}`,
      "วันที่: 21/10/2569",
      "น้ำหนักสุทธิ: 3,500.000 กก.",
      "ราคาต่อกิโลกรัม: 5.00 บาท",
      "ค่าขนส่ง: 500.00 บาท",
      "ยอดสุทธิ: 17,000.00 บาท",
    ].forEach((line, index) => ctx.fillText(line, 60, 90 + index * 95));
    return canvas.toDataURL("image/png").split(",")[1];
  }, invoice);
  return {
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  };
}
