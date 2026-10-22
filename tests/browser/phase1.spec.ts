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
test("Phase 3 expenses preserve failed input, reuse daily rates, attach private evidence and retain balances after reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const gardens = await (await page.request.get("/api/v1/gardens")).json();
  if (!gardens.gardens.some((g: { archived: boolean }) => !g.archived)) {
    await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name: "สวนทดสอบรายจ่าย", openingMinor: 1000000 },
    });
  }
  const before = (await (await page.request.get("/api/v1/summary")).json())
    .netMinor;
  await page.goto("/records");
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("สวนที่มีรายจ่าย")).toBeFocused();
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("daily_labor");
  await dialog
    .getByLabel("ผู้รับเงิน", { exact: true })
    .fill("คนงานรายวันใหม่");
  await dialog.getByLabel("จำนวนวันทำงาน").fill("0.5");
  await dialog.getByLabel("ค่าแรงต่อวัน (บาท)").fill("500");
  await dialog.getByLabel("หมายเหตุ").fill("งานครึ่งวันบนมือถือ");
  await expect(dialog.locator(".sale-calculation")).toContainText("250.00");
  await page.route("**/api/v1/expenses", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "TEST", message: "ทดสอบบันทึกล้มเหลว" },
          }),
        })
      : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText("ทดสอบบันทึกล้มเหลว");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByLabel("ผู้รับเงิน", { exact: true })).toHaveValue(
    "คนงานรายวันใหม่",
  );
  await expect(dialog.getByLabel("จำนวนวันทำงาน")).toHaveValue("0.5");
  await page.unroute("**/api/v1/expenses");
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }),
  ).toBeFocused();
  await expect(
    page.locator(".expense-row").filter({ hasText: "คนงานรายวันใหม่" }),
  ).toContainText("ค้างจ่าย 250.00 บาท");
  await page.reload();
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("daily_labor");
  await dialog
    .getByLabel("ผู้รับเงิน", { exact: true })
    .fill("คนงานรายวันใหม่");
  await expect(dialog.getByLabel("ค่าแรงต่อวัน (บาท)")).toHaveValue("500.00");
  await dialog.getByLabel("ค่าแรงต่อวัน (บาท)").fill("600");
  await dialog.getByLabel(/จำอัตรานี้/).uncheck();
  await dialog.getByLabel("การจ่ายครั้งแรก").selectOption("full");
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const preferences = await (
    await page.request.get("/api/v1/sales/preferences")
  ).json();
  expect(
    preferences.profiles.find(
      (p: { payee: string }) => p.payee === "คนงานรายวันใหม่",
    ).rateBaht,
  ).toBe("500.00");
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("fertilizer");
  await dialog.getByLabel("ผู้รับเงิน", { exact: true }).fill("ร้านปุ๋ยทดสอบ");
  await dialog.getByLabel("กระสอบที่ใช้จริง").fill("4");
  await dialog.getByLabel("ราคาต่อกระสอบ (บาท)").fill("800");
  await dialog.getByLabel("การจ่ายครั้งแรก").selectOption("partial");
  await dialog.getByLabel("ยอดจ่ายครั้งแรก (บาท)").fill("1200");
  await dialog.getByLabel("วันที่จ่ายครั้งแรก").fill("2026-10-22");
  await dialog.getByLabel("รูปหลักฐานรายจ่าย (ไม่บังคับ)").setInputFiles({
    name: "expense.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nV8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(dialog.locator(".sale-calculation")).toContainText("3,200.00");
  await expect(dialog.locator(".sale-calculation")).toContainText("2,000.00");
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/phase3-expense-mobile.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const fertilizer = page
    .locator(".expense-row")
    .filter({ hasText: "ร้านปุ๋ยทดสอบ" });
  await expect(fertilizer).toContainText(
    "จ่ายแล้ว 1,200.00 บาท · ค้างจ่าย 2,000.00 บาท",
  );
  await expect(fertilizer).toContainText("22/10/2569");
  const popupEvent = page.waitForEvent("popup");
  await fertilizer.getByRole("button", { name: "เปิดรูปหลักฐาน" }).click();
  const popup = await popupEvent;
  await popup.waitForURL(/storage\/v1\/object\/sign/);
  await popup.close();
  await page.goto("/");
  await expect(page.locator(".total")).toHaveText(
    new Intl.NumberFormat("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format((before - 405000) / 100),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.locator('.palm-landscape[data-scene-ready="true"] canvas'),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase3-overview-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("Phase 4 team weight expense and linked sale reuse rates with per-record overrides", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const before = await (await page.request.get("/api/v1/summary")).json();
  await page.goto("/records");
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("weight_labor");
  await dialog.getByLabel("ผู้รับเงิน", { exact: true }).fill("ทีมทดสอบเฟสสี่");
  await dialog.getByLabel("น้ำหนักคิดค่าแรง (กก.)").fill("3500");
  await dialog.getByLabel("บาทต่อตัน").fill("1000");
  await expect(dialog.locator(".sale-calculation")).toContainText("3,500.00");
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page.locator(".expense-row").filter({ hasText: "ทีมทดสอบเฟสสี่" }),
  ).toContainText("3500 กก. × 1000.00 บาท/ตัน");
  await page.getByLabel("เลือกรูปบิล", { exact: true }).setInputFiles({
    name: "phase4.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nV8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "ข้ามการอ่านและกรอกเอง" }).click();
  await expect(page.getByLabel("เลขบิล")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("ผู้รับซื้อ").fill("ผู้รับซื้อเฟสสี่");
  await page.getByLabel("เลขบิล").fill("BROWSER-PHASE4");
  await page.getByLabel("น้ำหนักสุทธิ (กก.)").fill("3500");
  await page.getByLabel("ราคาต่อกิโลกรัม (บาท)").fill("5");
  await page
    .getByRole("button", { name: "ข้อมูลถูกต้อง · เลือกค่าแรง" })
    .click();
  await page.getByRole("radio", { name: "รายน้ำหนัก", exact: true }).check();
  await page.getByLabel("ชื่อทีม", { exact: true }).fill("ทีมทดสอบเฟสสี่");
  await expect(page.getByLabel("บาทต่อตัน", { exact: true })).toHaveValue(
    "1000.00",
  );
  await expect(page.getByLabel("น้ำหนักคิดค่าแรง (กก.)")).toHaveValue("3500");
  await page.getByLabel("น้ำหนักคิดค่าแรง (กก.)").fill("3250");
  await page.getByLabel("บาทต่อตัน", { exact: true }).fill("1200");
  await page.getByLabel(/จำอัตรานี้/).uncheck();
  await page.getByLabel("ตรวจข้อมูลแล้ว และได้รับเงินขายเต็มจำนวน").check();
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.getByText("บันทึกบิลขายแล้ว")).toBeVisible();
  const sale = page.locator(".sale-row").filter({ hasText: "BROWSER-PHASE4" });
  await expect(sale).toContainText("3250 กก. × 1200.00 บาท/ตัน = 3,900.00 บาท");
  await page.reload();
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("weight_labor");
  await dialog.getByLabel("ผู้รับเงิน", { exact: true }).fill("ทีมทดสอบเฟสสี่");
  await expect(dialog.getByLabel("บาทต่อตัน")).toHaveValue("1000.00");
  await dialog.getByLabel("น้ำหนักคิดค่าแรง (กก.)").fill("1000");
  await dialog.getByLabel("บาทต่อตัน").fill("1500");
  await dialog.getByLabel(/จำอัตรานี้/).uncheck();
  await dialog.getByLabel("การจ่ายครั้งแรก").selectOption("full");
  await dialog
    .getByRole("button", { name: "ยืนยันรายจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const after = await (await page.request.get("/api/v1/summary")).json();
  expect(after.netMinor).toBe(before.netMinor + 860000);
  expect(after.expensePendingMinor).toBe(before.expensePendingMinor + 350000);
  expect(after.laborPendingMinor).toBe(before.laborPendingMinor + 390000);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("Phase 5 opening debt, later payments and correction retain history and preserve net after reload", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const g = await page.request.post("/api/v1/gardens", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { name: "สวน Phase 5", openingMinor: 500000 },
  });
  expect(g.status()).toBe(201);
  const garden = await g.json();
  await page.goto("/records");
  const panel = page.getByRole("region", { name: "หนี้และประวัติการจ่าย" });
  await panel.getByRole("button", { name: "เพิ่มหนี้ก่อนเริ่มระบบ" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "สวน", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("combobox", { name: "สวน", exact: true })
    .selectOption(garden.id);
  await dialog.getByLabel("เจ้าหนี้ / คน / ทีม / ร้าน").fill("ร้านยกมา UI");
  await dialog.getByLabel("หนี้ค้างเดิม (บาท)").fill("1000");
  await dialog.getByRole("button", { name: "บันทึกหนี้เดิม" }).click();
  await expect(dialog).not.toBeVisible();
  await panel.getByLabel("คน / ทีม / ร้าน").selectOption("ร้านยกมา UI");
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 1,000.00 บาท");
  let summary = await (
    await page.request.get("/api/v1/gardens/" + garden.id)
  ).json();
  expect(summary.netMinor).toBe(500000);
  expect(summary.openingDebtPendingMinor).toBe(100000);
  await panel.getByRole("button", { name: "เพิ่มหนี้ก่อนเริ่มระบบ" }).click();
  await dialog
    .getByRole("combobox", { name: "สวน", exact: true })
    .selectOption(garden.id);
  await dialog.getByLabel("เจ้าหนี้ / คน / ทีม / ร้าน").fill("ทีมแก้จ่าย UI");
  await dialog.getByLabel("หนี้ค้างเดิม (บาท)").fill("10000");
  await dialog.getByRole("button", { name: "บันทึกหนี้เดิม" }).click();
  await expect(dialog).not.toBeVisible();
  await panel.getByLabel("คน / ทีม / ร้าน").selectOption("ทีมแก้จ่าย UI");
  await panel
    .getByRole("button", { name: "บันทึกจ่ายให้ ทีมแก้จ่าย UI" })
    .click();
  await dialog.getByLabel("ยอดจ่าย (บาท)").fill("5000");
  let fail = true;
  await page.route("**/api/v1/opening-debts/*/payments", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "UNAVAILABLE", message: "ทดสอบเชื่อมต่อขัดข้อง" },
        }),
      });
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "บันทึกการจ่าย", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByLabel("ยอดจ่าย (บาท)")).toHaveValue("5000");
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 10,000.00 บาท");
  await dialog
    .getByRole("button", { name: "บันทึกการจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 5,000.00 บาท");
  await panel.locator("summary").click();
  await panel
    .getByRole("button", { name: "ยกเลิกการจ่าย 5,000.00 บาท" })
    .click();
  await expect(dialog.getByLabel("เหตุผลที่ยกเลิก")).toBeFocused();
  await expect(dialog).toContainText("จะคืนยอดค้างเป็น 10,000.00 บาท");
  await dialog.getByLabel("เหตุผลที่ยกเลิก").fill("พิมพ์ศูนย์เกิน");
  await dialog.getByRole("button", { name: "ยืนยันยกเลิกการจ่าย" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 10,000.00 บาท");
  await panel
    .getByRole("button", { name: "บันทึกจ่ายให้ ทีมแก้จ่าย UI" })
    .click();
  await dialog.getByLabel("ยอดจ่าย (บาท)").fill("500");
  await dialog
    .getByRole("button", { name: "บันทึกการจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 9,500.00 บาท");
  await page.reload();
  await panel.getByLabel("คน / ทีม / ร้าน").selectOption("ทีมแก้จ่าย UI");
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 9,500.00 บาท");
  await panel.locator("summary").click();
  await expect(panel).toContainText("พิมพ์ศูนย์เกิน");
  await expect(panel).toContainText("5,000.00 บาท · ยกเลิกแล้ว");
  await expect(panel).toContainText("500.00 บาท · มีผล");
  summary = await (
    await page.request.get("/api/v1/gardens/" + garden.id)
  ).json();
  expect(summary.netMinor).toBe(500000);
  expect(summary.openingDebtPendingMinor).toBe(1050000);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase5-payables-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Phase 6 shared cost, allocation retries and stale editors preserve source payments and global totals", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const ids: string[] = [];
  for (const name of ["สวนแบ่ง UI A", "สวนแบ่ง UI B"]) {
    const r = await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name, openingMinor: 0 },
    });
    expect(r.status()).toBe(201);
    ids.push((await r.json()).id);
  }
  const before = await (await page.request.get("/api/v1/summary")).json();
  await page.goto("/records");
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("สวนที่มีรายจ่าย").selectOption("shared");
  await dialog.getByLabel("ชนิดรายจ่าย").selectOption("maintenance");
  await dialog.getByLabel("ผู้รับเงิน").fill("ร้านร่วม UI");
  await dialog.getByLabel("จำนวนรายการ").fill("1");
  await dialog.getByLabel("ราคาต่อรายการ (บาท)").fill("1000");
  await dialog.getByLabel("การจ่ายครั้งแรก").selectOption("partial");
  await dialog.getByLabel("ยอดจ่ายครั้งแรก (บาท)").fill("333.33");
  await dialog.getByRole("button", { name: "ยืนยันรายจ่าย" }).click();
  await expect(dialog).not.toBeVisible();
  const panel = page.getByRole("region", { name: "หนี้และประวัติการจ่าย" });
  await panel.getByLabel("คน / ทีม / ร้าน").selectOption("ร้านร่วม UI");
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 666.67 บาท");
  await expect(panel).toContainText("ส่วนกลางที่ยังไม่แบ่งเข้าสวน");
  const source = await (await page.request.get("/api/v1/payables")).json();
  const entry = source.payables.find((e: any) => e.payee === "ร้านร่วม UI");
  expect(entry.payments).toHaveLength(1);
  let summary = await (await page.request.get("/api/v1/summary")).json();
  expect(summary.netMinor).toBe(before.netMinor - 100000);
  expect(summary.sharedUnallocatedMinor).toBe(100000);
  await panel.getByRole("button", { name: "แบ่งเข้าสวน / แก้ชุดแบ่ง" }).click();
  const a = dialog.getByLabel("แบ่งให้ สวนแบ่ง UI A (บาท)", { exact: true }),
    b = dialog.getByLabel("แบ่งให้ สวนแบ่ง UI B (บาท)", { exact: true });
  await expect(dialog.locator("input").first()).toBeFocused();
  await a.fill("400");
  await b.fill("500");
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await b.fill("600");
  let fail = true;
  await page.route("**/api/v1/expenses/*/allocations", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "UNAVAILABLE", message: "ทดสอบบันทึกชุดแบ่งล้มเหลว" },
        }),
      });
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(a).toHaveValue("400");
  await expect(b).toHaveValue("600");
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText(
    "สวนแบ่ง UI A · ต้นทุน 400.00 · จ่ายตามสัดส่วน 133.33 · ค้าง 266.67 บาท",
  );
  await expect(panel).toContainText(
    "สวนแบ่ง UI B · ต้นทุน 600.00 · จ่ายตามสัดส่วน 200.00 · ค้าง 400.00 บาท",
  );
  summary = await (await page.request.get("/api/v1/summary")).json();
  expect(summary.netMinor).toBe(before.netMinor - 100000);
  expect(summary.sharedUnallocatedMinor).toBe(0);
  await panel.getByLabel("สวนของหนี้").selectOption(ids[0]);
  await expect(panel).toContainText("ค้างปัจจุบันตามที่เลือก 266.67 บาท");
  await panel.getByLabel("สวนของหนี้").selectOption("");
  await page.reload();
  await panel.getByLabel("คน / ทีม / ร้าน").selectOption("ร้านร่วม UI");
  await panel.getByRole("button", { name: "แบ่งเข้าสวน / แก้ชุดแบ่ง" }).click();
  const concurrent = await page.request.put(
    `/api/v1/expenses/${entry.id}/allocations`,
    {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        expectedVersion: 2,
        allocations: ids.map((gardenId) => ({ gardenId, amountBaht: "500" })),
      },
    },
  );
  expect(concurrent.status()).toBe(200);
  await a.fill("250");
  await b.fill("750");
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "ชุดแบ่งเปลี่ยนจากอีกหน้าจอ",
  );
  await expect(
    dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "โหลดชุดแบ่งล่าสุด" }).click();
  await expect(a).toHaveValue("500.00");
  await expect(b).toHaveValue("500.00");
  await a.fill("250");
  await b.fill("750");
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog).not.toBeVisible();
  await panel
    .getByRole("button", { name: "บันทึกจ่ายให้ ร้านร่วม UI" })
    .click();
  await dialog.getByLabel("ยอดจ่าย (บาท)").fill("100");
  await dialog
    .getByRole("button", { name: "บันทึกการจ่าย", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("จ่ายตามสัดส่วน 108.33");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "ยกเลิกการจ่าย 100.00 บาท" }).click();
  await dialog.getByLabel("เหตุผลที่ยกเลิก").fill("แก้จ่ายร่วม");
  await dialog.getByRole("button", { name: "ยืนยันยกเลิกการจ่าย" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("แก้จ่ายร่วม");
  await expect(panel).toContainText("จ่ายตามสัดส่วน 83.33");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase6-allocation-mobile.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "แบ่งเข้าสวน / แก้ชุดแบ่ง" }).click();
  await dialog.getByRole("button", { name: "เก็บทั้งหมดเป็นส่วนกลาง" }).click();
  await dialog.getByRole("button", { name: "ยืนยันชุดแบ่ง" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel).toContainText("ส่วนกลางที่ยังไม่แบ่งเข้าสวน");
  const final = await (await page.request.get("/api/v1/payables")).json();
  const original = final.payables.find((e: any) => e.id === entry.id);
  expect(original.payments).toHaveLength(2);
  expect(original.payments[0].id).toBe(entry.payments[0].id);
  expect(original.pendingMinor).toBe(66667);
  expect(original.allocations).toEqual([]);
  await page.goto("/");
  await expect(page.locator(".hero")).toContainText(
    "ส่วนกลางยังไม่แบ่ง 1,000.00 บาท",
  );
  await expect(page.locator(".hero")).toContainText(
    "ค้างจ่ายส่วนกลาง 666.67 บาท",
  );
  summary = await (await page.request.get("/api/v1/summary")).json();
  expect(summary.netMinor).toBe(before.netMinor - 100000);
  expect(errors).toEqual([]);
});

test("Phase 7 search, source edits, stale review, payment-impact void and Thai CSV survive reload at mobile widths", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const headers = {
    Origin: "http://127.0.0.1:3100",
    "Idempotency-Key": crypto.randomUUID(),
  };
  const garden = await (
    await page.request.post("/api/v1/gardens", {
      headers,
      data: { name: "สวนแก้รายงาน UI", openingMinor: 500000 },
    })
  ).json();
  const created = await page.request.post("/api/v1/expenses", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      gardenId: garden.id,
      expenseDate: "2026-09-01",
      kind: "other",
      payee: "ร้านแก้รายการ UI",
      note: "ภาษาไทย",
      unit: "item",
      quantity: "1",
      rateBaht: "10000",
      paymentStatus: "partial",
      paidBaht: "5000",
      paymentDate: "2026-09-02",
      rememberRate: false,
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  await page.goto("/records");
  await page
    .getByRole("button", { name: "ค้นหา / แก้รายการ / รายงาน" })
    .click();
  const panel = page.getByRole("region", { name: "ค้นหารายการและรายงาน" });
  await panel.getByLabel("สวนที่รับต้นทุน").selectOption(garden.id);
  await panel.getByLabel("ตั้งแต่วันที่").fill("2026-09-01");
  await panel.getByLabel("ถึงวันที่").fill("2026-09-30");
  await panel.getByRole("button", { name: "ใช้ตัวกรอง" }).click();
  await expect(panel.locator(".entry-row")).toHaveCount(1);
  await expect(
    panel.getByRole("region", { name: "รายงานตามตัวกรอง" }),
  ).toContainText("ค้างปัจจุบันของรายการที่ตรงตัวกรอง 5,000.00");
  await expect(panel).toContainText("ไม่บวกยอดยกมา");
  await panel
    .getByRole("button", { name: "รายละเอียด ร้านแก้รายการ UI", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("จ่ายแล้ว 5,000.00");
  await dialog
    .getByRole("button", { name: "แก้ไขรายการ", exact: true })
    .click();
  await dialog.getByLabel("อัตราต่อหน่วย (บาท)").fill("4000");
  await dialog.getByLabel("เหตุผลที่แก้ไข").fill("ลองตรวจยอด");
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("ต่ำกว่ายอดจ่าย");
  await expect(dialog.getByLabel("อัตราต่อหน่วย (บาท)")).toHaveValue("4000");
  await dialog.getByLabel("อัตราต่อหน่วย (บาท)").fill("11000");
  await page.route(`**/api/v1/entries/expenses/${id}`, (route) =>
    route.request().method() === "PATCH" ? route.abort() : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("ข้อมูลที่กรอกยังอยู่");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByLabel("อัตราต่อหน่วย (บาท)")).toHaveValue("11000");
  await page.unroute(`**/api/v1/entries/expenses/${id}`);
  const external = await page.request.patch(`/api/v1/entries/expenses/${id}`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      gardenId: garden.id,
      date: "2026-09-01",
      kind: "other",
      payee: "ร้านแก้รายการ UI",
      note: "อีกแท็บ",
      unit: "item",
      quantity: "1",
      rateBaht: "12000",
      expectedVersion: 1,
      reason: "แก้อีกแท็บ",
    },
  });
  expect(external.status()).toBe(200);
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("เปลี่ยนจากอีกหน้าจอ");
  await expect(dialog.getByLabel("อัตราต่อหน่วย (บาท)")).toHaveValue("11000");
  await dialog
    .getByRole("button", { name: "โหลดข้อมูลล่าสุด (แทนค่าที่กำลังแก้)" })
    .click();
  await expect(dialog.getByLabel("อัตราต่อหน่วย (บาท)")).toHaveValue(
    "12000.00",
  );
  await dialog.getByLabel("อัตราต่อหน่วย (บาท)").fill("11000");
  await dialog.getByLabel("เหตุผลที่แก้ไข").fill("ตรวจใหม่แล้ว");
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.locator(".entry-row")).toContainText("11,000.00");
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "ส่งออก CSV ตามตัวกรอง" }).click();
  const saved = await download;
  const csv = readFileSync((await saved.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("ร้านแก้รายการ UI");
  expect(csv).toContain('"11000.00"');
  await panel
    .getByRole("button", { name: "รายละเอียด ร้านแก้รายการ UI", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "ยกเลิกรายการ", exact: true })
    .click();
  await expect(dialog).toContainText("รวม 5,000.00 บาทจะถูกยกเลิก");
  await dialog.getByLabel("เหตุผลที่ยกเลิก").fill("ลงต้นทางผิด");
  await dialog
    .getByLabel("ตรวจประวัติและยืนยันยกเลิกการจ่ายที่มีผลพร้อมต้นทาง")
    .check();
  await dialog
    .getByRole("button", { name: "ยืนยันยกเลิกรายการ", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.locator(".entry-row")).toHaveCount(0);
  await panel.getByLabel("สถานะรายการ").selectOption("voided");
  await panel.getByRole("button", { name: "ใช้ตัวกรอง" }).click();
  await expect(panel.locator(".entry-row")).toHaveCount(1);
  await panel
    .getByRole("button", { name: "รายละเอียด ร้านแก้รายการ UI", exact: true })
    .click();
  await expect(dialog).toContainText("ลงต้นทางผิด");
  await expect(dialog).toContainText("ค้างปัจจุบัน 0.00");
  await expect(
    dialog.getByRole("button", { name: "แก้ไขรายการ", exact: true }),
  ).toHaveCount(0);
  await dialog.getByText(/ประวัติการเปลี่ยนแปลง \(/).click();
  await expect(dialog).toContainText("ตรวจใหม่แล้ว");
  await dialog.getByRole("button", { name: "ปิดรายละเอียด" }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/palm-phase7-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "ค้นหา / แก้รายการ / รายงาน" })
    .click();
  await panel.getByLabel("สวนที่รับต้นทุน").selectOption(garden.id);
  await panel.getByLabel("สถานะรายการ").selectOption("voided");
  await panel.getByRole("button", { name: "ใช้ตัวกรอง" }).click();
  await expect(panel.locator(".entry-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Phase 7 linked sale review opens labor separately and preserves its garden/date through parent edits and void", async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  await page.goto("/login");
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const ids: string[] = [];
  for (const name of ["สวนบิล UI A", "สวนบิล UI B"]) {
    const g = await page.request.post("/api/v1/gardens", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { name, openingMinor: 0 },
    });
    expect(g.status()).toBe(201);
    ids.push((await g.json()).id);
  }
  const { pool } = await import("../../src/server/db");
  const owner = (
    await pool().query("select owner_id from public.gardens where id=$1", [
      ids[0],
    ])
  ).rows[0].owner_id;
  const sale = (
    await pool().query(
      "insert into public.sales(owner_id,garden_id,sale_date,buyer,invoice_number,net_weight_grams,price_minor_per_kg,gross_minor,deductions_minor,net_minor) values($1,$2,'2026-09-01','บิลตรวจค่าแรง UI','UI-phase7-linked',1000000,1000,1000000,0,1000000) returning id",
      [owner, ids[0]],
    )
  ).rows[0].id;
  const labor = (
    await pool().query(
      "insert into public.sale_labor(owner_id,sale_id,mode,payee,basis_units,rate_minor,amount_minor) values($1,$2,'weight','ทีมแยกตรวจ UI',1000000,80000,80000) returning id",
      [owner, sale],
    )
  ).rows[0].id;
  await page.goto("/records");
  await page
    .getByRole("button", { name: "ค้นหา / แก้รายการ / รายงาน" })
    .click();
  const panel = page.getByRole("region", { name: "ค้นหารายการและรายงาน" });
  await panel
    .getByLabel("ค้นหาผู้ซื้อ ผู้รับเงิน เลขบิล หรือหมายเหตุ")
    .fill("UI-phase7-linked");
  await panel.getByLabel("ประเภทรายการ").selectOption("sales");
  await panel.getByRole("button", { name: "ใช้ตัวกรอง" }).click();
  await expect(panel.locator(".entry-row")).toHaveCount(1);
  await panel
    .getByRole("button", { name: "รายละเอียด บิลตรวจค่าแรง UI", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("ค่าแรงที่เกี่ยวข้อง");
  await dialog
    .getByRole("button", { name: "แก้ไขรายการ", exact: true })
    .click();
  await dialog.getByLabel("สวน").selectOption(ids[1]);
  await dialog.getByLabel("วันที่รายการ", { exact: true }).fill("2026-09-05");
  await dialog.getByLabel("เหตุผลที่แก้ไข").fill("บิลอยู่สวน B แต่ทีมสวน A");
  await dialog
    .getByLabel("ตรวจค่าแรงทั้งหมดแล้ว เข้าใจว่าค่าแรงไม่เปลี่ยนตามบิล")
    .check();
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const d = await (
    await page.request.get(`/api/v1/entries/sale-labor/${labor}`)
  ).json();
  expect(d.record.garden_id).toBe(ids[0]);
  expect(d.record.date).toBe("2026-09-01");
  expect(Number(d.record.amount_minor)).toBe(80000);
  await panel
    .getByRole("button", { name: "รายละเอียด บิลตรวจค่าแรง UI", exact: true })
    .click();
  await dialog.getByText(/ประวัติการเปลี่ยนแปลง \(/).click();
  await expect(dialog).toContainText("สวน: สวนบิล UI A → สวนบิล UI B");
  await expect(dialog).toContainText("วันที่: 2026-09-01 → 2026-09-05");
  await dialog
    .getByRole("button", { name: "เปิดค่าแรง ทีมแยกตรวจ UI", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "รายละเอียดค่าแรงผูกบิล" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "แก้ไขรายการ", exact: true })
    .click();
  await dialog
    .getByLabel("น้ำหนักคิดค่าแรง (กก.)", { exact: true })
    .fill("900");
  await dialog.getByLabel("เหตุผลที่แก้ไข").fill("แก้ทีมแยก");
  await dialog
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await panel
    .getByRole("button", { name: "รายละเอียด บิลตรวจค่าแรง UI", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "ยกเลิกรายการ", exact: true })
    .click();
  await dialog.getByLabel("เหตุผลที่ยกเลิก").fill("ยกเลิกเฉพาะบิล");
  await dialog
    .getByLabel("ตรวจค่าแรงทั้งหมดแล้ว เข้าใจว่าค่าแรงไม่เปลี่ยนตามบิล")
    .check();
  await dialog
    .getByRole("button", { name: "ยืนยันยกเลิกรายการ", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const after = await (
    await page.request.get(`/api/v1/entries/sale-labor/${labor}`)
  ).json();
  expect(after.record.voided_at).toBeNull();
  expect(after.pendingMinor).toBe(72000);
  expect(after.record.garden_id).toBe(ids[0]);
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
