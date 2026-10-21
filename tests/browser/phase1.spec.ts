import { test, expect } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { prepare, password, username, startApp, stopApp } from "../support";
import { manageOwner } from "../../scripts/owner";

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
  const errors: string[] = [];
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
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "เก็บสวนเป็นประวัติ" }).click();
  await expect(
    page.getByRole("button", { name: "นำสวนกลับมาใช้งาน" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "ภาพรวม", exact: true }).click();
  await expect(page.locator(".total")).toHaveText("42,800.50");
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const other = await second.newPage();
  await other.goto("http://127.0.0.1:3100/login");
  await other.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
  await other.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await other.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(other.locator(".total")).toHaveText("42,800.50");
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
