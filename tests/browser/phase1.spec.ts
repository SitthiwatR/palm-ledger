import { test, expect } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { prepare, password, username, startApp, stopApp } from "../support";
import { manageOwner } from "../../scripts/owner";
import { receiptFixture, tableReceiptFixture } from "./receipt-fixture";
import { readFileSync } from "node:fs";

let app: ChildProcess;
test.beforeAll(async () => {
  await prepare();
  app = await startApp();
});
test.afterAll(() => stopApp(app));
test("owner signs in, adds and edits gardens, preserves balances across devices, and signs out", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith("http") &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      externalRequests.push(url.origin);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "เพิ่มสวนแรก" })).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มสวนแรก" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("ชื่อสวน", { exact: true })).toBeFocused();
  await page.getByLabel("ชื่อสวน", { exact: true }).fill("สวนบ้าน");
  await page.getByLabel("ยอดสุทธิยกมา (บาท)").fill("28000");
  await page.getByRole("button", { name: "บันทึกสวน" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".total")).toHaveText("28,000.00");
  await page.getByRole("button", { name: "เพิ่มสวน", exact: true }).click();
  await page.getByLabel("ชื่อสวน", { exact: true }).fill("สวนคลอง");
  await page.getByLabel("ยอดสุทธิยกมา (บาท)").fill("14800");
  await page.getByRole("button", { name: "บันทึกสวน" }).click();
  await expect(page.locator(".total")).toHaveText("42,800.00");
  await page.reload();
  await expect(page.locator(".total")).toHaveText("42,800.00");
  await page
    .getByRole("link")
    .filter({ has: page.getByText("สวนบ้าน", { exact: true }) })
    .click();
  await page.getByRole("button", { name: "แก้ไขสวน" }).click();
  await page.getByLabel("ชื่อสวน", { exact: true }).fill("สวนบ้านใหม่");
  await page.getByLabel("ยอดสุทธิยกมา (บาท)").fill("28000.50");
  await page.getByRole("button", { name: "บันทึกสวน" }).click();
  await expect(
    page.getByRole("heading", { name: "สวนบ้านใหม่" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /รายการ/ }).click();
  await expect(page.getByLabel("ผู้รับซื้อ")).not.toBeVisible();
  const receipt = await receiptFixture(page);
  const attach = () =>
    page.getByLabel("เลือกรูปบิล", { exact: true }).setInputFiles(receipt);
  const started = Date.now();
  await attach();
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toBeVisible({
    timeout: 50000,
  });
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toHaveValue("3500.000");
  await expect(page.getByLabel("ราคาต่อกิโลกรัม (บาท)")).toHaveValue("5.00");
  await expect(page.getByLabel("เลขบิล")).toHaveValue("BROWSER-001");
  await expect(page.getByLabel("ยอดหัก (บาท)")).toHaveValue("500.00");
  await page.screenshot({
    path: "test-results/receipt-review-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ข้อมูลถูกต้อง · เลือกค่าแรง" })
    .click();
  await page.getByRole("radio", { name: "รายน้ำหนัก", exact: true }).check();
  await expect(page.getByLabel("น้ำหนักคิดค่าแรง (กก.)")).toHaveValue(
    "3500.000",
  );
  await page.getByLabel("ชื่อทีม").fill("ทีมตัดทดสอบ");
  await page.getByLabel("บาทต่อตัน").fill("1000");
  await expect(page.locator(".summary-net")).toContainText("13,500.00");
  await page.getByLabel("ตรวจข้อมูลแล้ว และได้รับเงินขายเต็มจำนวน").check();
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.getByText("บันทึกบิลขายแล้ว")).toBeVisible();
  const elapsed = Date.now() - started;
  console.log(
    `Receipt upload → real Thai OCR → review → weight labor → saved: ${elapsed}ms`,
  );
  expect(externalRequests).toEqual([]);
  expect(elapsed).toBeLessThan(60000);
  await expect(page.locator(".sale-row")).toHaveCount(1);
  await expect(page.locator(".sale-row")).not.toContainText("Invalid Date");
  await expect(page.locator(".sale-row")).toContainText("21/10/2569");
  await expect(page.locator(".sale-row b")).toHaveText("17,000.00บาท");
  await expect(page.locator(".labor-history")).toContainText(
    "3,500.00 บาท · ค้างจ่าย",
  );
  const receiptTab = page.waitForEvent("popup");
  await page.getByRole("button", { name: "เปิดรูปต้นฉบับ" }).click();
  const receiptPage = await receiptTab;
  await expect(receiptPage).toHaveURL(
    /storage\/v1\/object\/sign\/palm-receipts/,
  );
  await expect(receiptPage.locator("img")).toBeVisible();
  await receiptPage.close();
  await attach();
  await expect(page.getByLabel("เลขบิล")).toBeVisible({ timeout: 50000 });
  await page
    .getByRole("button", { name: "ข้อมูลถูกต้อง · เลือกค่าแรง" })
    .click();
  await page.getByRole("radio", { name: "ไม่มีค่าแรง", exact: true }).check();
  await page.getByLabel("ตรวจข้อมูลแล้ว และได้รับเงินขายเต็มจำนวน").check();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.locator(".receipt-workflow [role=alert]")).toContainText(
    "โปรดตรวจบิลที่อาจซ้ำ",
  );
  await page.getByRole("button", { name: "กลับไปแก้ข้อมูลบิล" }).click();
  await expect(page.getByLabel("เลขบิล")).toHaveValue("BROWSER-001");
  await page
    .getByRole("button", { name: "ข้อมูลถูกต้อง · เลือกค่าแรง" })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  // Saving refreshes session, gardens and sales in sequence; allow their network round trips.
  await expect(page.locator(".sale-row")).toHaveCount(2, { timeout: 15000 });
  await page.getByRole("link", { name: "ภาพรวม", exact: true }).click();
  await expect(page.locator(".total")).toHaveText("73,300.50");
  await page
    .getByRole("link")
    .filter({ has: page.getByText("สวนบ้านใหม่", { exact: true }) })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "เก็บสวนเป็นประวัติ" }).click();
  await expect(
    page.getByRole("button", { name: "นำสวนกลับมาใช้งาน" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "ภาพรวม", exact: true }).click();
  await expect(page.locator(".total")).toHaveText("73,300.50");
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const other = await second.newPage();
  await other.goto("http://127.0.0.1:3100/login");
  await other.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await other.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await other.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(other.locator(".total")).toHaveText("73,300.50");
  await second.close();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const animations = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => a.playState === "running").length,
  );
  expect(animations).toBe(0);
  await page.screenshot({
    path: "test-results/phase1-home.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/redesign-home-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByText("ลืมรหัสผ่าน?", { exact: true }).click();
  await expect(
    page.getByText("ติดต่อผู้ดูแลที่ช่วยตั้งระบบให้คุณ เพื่อตั้งรหัสผ่านใหม่", {
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("HEIC preview, manual fallback and daily wages retain values after a failed save and remember rates across reloads", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /รายการ/ }).click();
  const gardenResponse = await page.request.get("/api/v1/gardens");
  if (
    !(await gardenResponse.json()).gardens.some(
      (g: { archived: boolean }) => !g.archived,
    )
  ) {
    await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name: "สวนทดสอบ HEIC", openingMinor: 0 },
    });
    await page.reload();
  }
  await expect(page.getByLabel("เลือกรูปบิล", { exact: true })).toBeVisible();
  const existingSales = await page.locator(".sale-row").count();
  const heic = {
    name: "iphone-format.heic",
    mimeType: "image/heic",
    buffer: readFileSync("tests/fixtures/sample.heic"),
  };
  const attach = async (failUpload = false) => {
    if (failUpload)
      await page.route("**/api/v1/receipts/verify", (route) => route.abort());
    await page.getByLabel("เลือกรูปบิล", { exact: true }).setInputFiles(heic);
    await page.getByRole("button", { name: "ข้ามการอ่านและกรอกเอง" }).click();
    if (failUpload) {
      await expect(page.locator(".receipt-workflow [role=alert]")).toBeVisible({
        timeout: 30000,
      });
      await page.unroute("**/api/v1/receipts/verify");
      await page.getByRole("button", { name: "ลองอัปโหลดอีกครั้ง" }).click();
    }
    await expect(page.getByLabel("เลขบิล")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".receipt-preview img")).toBeVisible();
    expect(
      await page
        .locator(".receipt-preview img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await page.getByLabel("ผู้รับซื้อ").fill("ทดสอบรายวัน");
    await page.getByLabel("เลขบิล").fill("BROWSER-DAILY");
    await page.getByLabel("น้ำหนักสุทธิ (กก.)").fill("3500");
    await page.getByLabel("ราคาต่อกิโลกรัม (บาท)").fill("5");
    await page
      .getByRole("button", { name: "ข้อมูลถูกต้อง · เลือกค่าแรง" })
      .click();
    await page.getByRole("radio", { name: "รายวัน", exact: true }).check();
  };
  await attach(true);
  await page.getByLabel("ชื่อคนงาน 1").fill("สมชายทดสอบ");
  await page.getByLabel("จำนวนวัน 1").fill("0.5");
  await page.getByLabel("บาทต่อวัน 1").fill("400");
  await expect(page.locator(".summary-net")).toContainText("17,300.00");
  await page.getByLabel("ตรวจข้อมูลแล้ว และได้รับเงินขายเต็มจำนวน").check();
  await page.route("**/api/v1/sales", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.locator(".receipt-workflow [role=alert]")).toBeVisible();
  await expect(page.getByLabel("ชื่อคนงาน 1")).toHaveValue("สมชายทดสอบ");
  await expect(page.getByLabel("จำนวนวัน 1")).toHaveValue("0.5");
  await page.unroute("**/api/v1/sales");
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.getByText("บันทึกบิลขายแล้ว")).toBeVisible();
  await expect(page.locator(".sale-row")).toHaveCount(existingSales + 1);
  await page.reload();
  await attach();
  await expect(page.getByLabel("ชื่อคนงาน 1")).toHaveValue("สมชายทดสอบ");
  await expect(page.getByLabel("บาทต่อวัน 1")).toHaveValue("400.00");
  await expect(page.getByLabel("จำนวนวัน 1")).toHaveValue("1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/labor-daily-mobile.png",
    fullPage: true,
  });
});
test("blue table receipt separates net weight and same-row price/total", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const gardens = await page.request.get("/api/v1/gardens");
  if (
    !(await gardens.json()).gardens.some(
      (g: { archived: boolean }) => !g.archived,
    )
  )
    await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name: "สวนทดสอบอ่านภาพ", openingMinor: 0 },
    });
  await page.getByRole("link", { name: /รายการ/ }).click();
  let saleWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/sales"
    )
      saleWrites++;
  });
  const started = Date.now();
  const fixture = await tableReceiptFixture(page);
  await page.getByLabel("เลือกรูปบิล", { exact: true }).setInputFiles(fixture);
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toBeVisible({
    timeout: 55000,
  });
  console.log({
    tablePhotoOcrMs: Date.now() - started,
    weight: await page.getByLabel("น้ำหนักสุทธิ (กก.)").inputValue(),
    price: await page.getByLabel("ราคาต่อกิโลกรัม (บาท)").inputValue(),
    invoicePresent: Boolean(await page.getByLabel("เลขบิล").inputValue()),
  });
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toHaveValue("1480");
  await expect(page.getByLabel("ราคาต่อกิโลกรัม (บาท)")).toHaveValue("8.70");
  await expect(page.getByLabel("วันที่ขาย")).toHaveValue("2026-08-28");
  await expect(page.getByLabel("เลขบิล")).toHaveValue("123456789");
  await expect(page.locator(".sale-calculation")).toContainText("12,876.00");
  await expect(page.locator(".sale-calculation small")).toContainText(
    "12876.00",
  );
  expect(saleWrites).toBe(0);
});
test("private reference photo reads printed table values without saving a sale", async ({
  page,
}) => {
  test.skip(
    !process.env.OCR_REAL_RECEIPT_PATH,
    "The user-provided private photo is supplied locally and is never committed.",
  );
  test.setTimeout(90000);
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const gardens = await page.request.get("/api/v1/gardens");
  if (
    !(await gardens.json()).gardens.some(
      (g: { archived: boolean }) => !g.archived,
    )
  )
    await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name: "สวนทดสอบอ่านภาพ", openingMinor: 0 },
    });
  await page.getByRole("link", { name: /รายการ/ }).click();
  let saleWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/sales"
    )
      saleWrites++;
  });
  const started = Date.now();
  await page
    .getByLabel("เลือกรูปบิล", { exact: true })
    .setInputFiles(process.env.OCR_REAL_RECEIPT_PATH!);
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toBeVisible({
    timeout: 55000,
  });
  console.log({
    privatePhotoOcrMs: Date.now() - started,
    weight: await page.getByLabel("น้ำหนักสุทธิ (กก.)").inputValue(),
    price: await page.getByLabel("ราคาต่อกิโลกรัม (บาท)").inputValue(),
    invoicePresent: Boolean(await page.getByLabel("เลขบิล").inputValue()),
  });
  await expect(page.getByLabel("น้ำหนักสุทธิ (กก.)")).toHaveValue("1480");
  await expect(page.getByLabel("ราคาต่อกิโลกรัม (บาท)")).toHaveValue("8.70");
  await expect(page.getByLabel("วันที่ขาย")).toHaveValue("2026-08-28");
  if (process.env.OCR_REAL_EXPECTED_INVOICE)
    await expect(page.getByLabel("เลขบิล")).toHaveValue(
      process.env.OCR_REAL_EXPECTED_INVOICE,
    );
  else await expect(page.getByLabel("เลขบิล")).not.toHaveValue("");
  await expect(page.locator(".sale-calculation")).toContainText("12,876.00");
  await expect(page.locator(".sale-calculation small")).toContainText(
    "12876.00",
  );
  expect(saleWrites).toBe(0);
});
test("failed saves keep form input, and administrator reset forces a new login", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page.locator(".total")).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มสวน", exact: true }).click();
  await page.getByLabel("ชื่อสวน", { exact: true }).fill("เก็บค่าที่กรอก");
  await page.getByRole("button", { name: "เปลี่ยนเป็นยอดติดลบ" }).click();
  await expect(page.getByLabel("ยอดสุทธิยกมา (บาท)")).toHaveValue("-0");
  await page.getByRole("button", { name: "เปลี่ยนเป็นยอดบวก" }).click();
  await expect(page.getByLabel("ยอดสุทธิยกมา (บาท)")).toHaveValue("0");
  await page.route("**/api/v1/gardens", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "บันทึกสวน" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "ข้อมูลที่กรอกยังอยู่",
  );
  await expect(page.getByLabel("ชื่อสวน", { exact: true })).toHaveValue(
    "เก็บค่าที่กรอก",
  );
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await manageOwner("reset", username, password + "reset");
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
});

test("3D welcome respects reduced motion and keeps login usable after losing WebGL", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("http://127.0.0.1:3100/login");
    const canvas = page.locator(
      '.palm-landscape[data-scene-ready="true"] canvas',
    );
    await expect(canvas).toBeVisible();
    await page
      .getByLabel("รหัสผ่าน", { exact: true })
      .fill("typed-password-stays-here");
    await page
      .getByRole("button", { name: "แสดงรหัสผ่าน", exact: true })
      .click();
    await expect(page.getByLabel("รหัสผ่าน", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await page
      .getByRole("button", { name: "ซ่อนรหัสผ่าน", exact: true })
      .click();
    await expect(page.getByLabel("รหัสผ่าน", { exact: true })).toHaveValue(
      "typed-password-stays-here",
    );
    await page.getByLabel("รหัสผ่าน", { exact: true }).fill("");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    const still = await canvas.screenshot();
    await page.waitForTimeout(250);
    expect(await canvas.screenshot()).toEqual(still);
    await page.screenshot({
      path: "test-results/redesign-login-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/redesign-login-mobile.png",
      fullPage: true,
    });
    await canvas.evaluate((element) => {
      const gl = (element as HTMLCanvasElement).getContext("webgl2");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(page.locator(".palm-landscape")).toHaveAttribute(
      "data-scene-ready",
      "false",
    );
    await expect(page.locator(".landscape-fallback")).toBeVisible();
    await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("still-usable");
    await expect(
      page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("login remains usable when WebGL is unavailable from the start", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (args[0] === "webgl2") return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("garden-owner");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("unchanged-input");
  await page.getByRole("button", { name: "แสดงรหัสผ่าน", exact: true }).click();
  await expect(page.getByLabel("รหัสผ่าน", { exact: true })).toHaveValue(
    "unchanged-input",
  );
  await expect(
    page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(500);
  await expect(page.locator(".palm-landscape")).toHaveAttribute(
    "data-scene-ready",
    "false",
  );
  await expect(page.locator(".landscape-fallback")).toBeVisible();
  expect(errors).toEqual([]);
});
