import { expect, type Page } from "@playwright/test";
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

export async function tableReceiptFixture(page: Page) {
  const image = await page.evaluate(async () => {
    await document.fonts.load('400 30px "Noto Sans Thai"');
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 1400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#202a3b";
    ctx.fillRect(0, 0, 1500, 1400);
    ctx.translate(60, 130);
    ctx.rotate(-Math.PI / 180);
    ctx.fillStyle = "#ece9d7";
    ctx.fillRect(0, 0, 1380, 1030);
    ctx.fillStyle = "#456eac";
    ctx.strokeStyle = "#456eac";
    ctx.lineWidth = 2;
    ctx.font = '400 30px "Noto Sans Thai"';
    const text = (value: string, x: number, y: number) =>
      ctx.fillText(value, x, y);
    text("บริษัท ปาล์มตัวอย่าง จำกัด", 360, 80);
    text("ใบชั่งน้ำหนัก", 530, 140);
    text("ใบชั่งน้ำหนักเลขที่ 123456789", 720, 220);
    text("วันที่เอกสาร 28/08/2569", 810, 280);
    text("เลขทะเบียนรถ 5093", 50, 280);
    text("นน. รวม 13,500", 1050, 60);
    for (const y of [340, 410, 480, 550, 640]) {
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(1320, y);
      ctx.stroke();
    }
    for (const x of [40, 400, 800, 1100, 1320]) {
      ctx.beginPath();
      ctx.moveTo(x, 340);
      ctx.lineTo(x, x === 400 || x === 800 ? 550 : 640);
      ctx.stroke();
    }
    text("วันที่", 80, 385);
    text("รายการ", 450, 385);
    text("เวลา", 850, 385);
    text("น้ำหนัก", 1150, 385);
    text("28/8/2569", 70, 455);
    text("ชั่งเข้า", 450, 455);
    text("10:33:10", 850, 455);
    text("3,465", 1180, 455);
    text("28/8/2569", 70, 525);
    text("ชั่งออก", 450, 525);
    text("10:37:36", 850, 525);
    text("1,985", 1180, 525);
    text("น้ำหนักสุทธิ", 600, 605);
    text("1,480", 1180, 605);
    text("ราคา/กก. 8.70 บาท", 60, 760);
    text("รวมราคาทั้งสิ้น 12,876.00 บาท", 620, 760);
    text("หมายเหตุ", 60, 850);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "table-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  };
}

export async function readOptionalReceipt(page: Page) {
  await expect(page.getByLabel("เลขบิล")).toBeVisible({ timeout: 65000 });
  await page
    .getByText("ตัวช่วยอ่านบิล (OCR) · เลือกใช้ได้", { exact: true })
    .click();
  await expect(page.locator(".receipt-selection img")).toBeVisible();
  await page
    .getByRole("button", { name: "อ่านช่วงที่เลือก", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ใช้ผลอ่านใหม่แทนข้อมูลบิล" }),
  ).toBeVisible({ timeout: 55000 });
  await page.getByRole("button", { name: "ใช้ผลอ่านใหม่แทนข้อมูลบิล" }).click();
  await page
    .getByText("ตัวช่วยอ่านบิล (OCR) · เลือกใช้ได้", { exact: true })
    .click();
}
