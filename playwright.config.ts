import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  projects:
    process.env.TEST_WEBKIT === "1"
      ? [{ name: "webkit", use: { browserName: "webkit" } }]
      : [
          {
            name: "chromium",
            use: {
              browserName: "chromium",
              launchOptions: {
                executablePath:
                  process.env.CHROMIUM_EXECUTABLE ||
                  (existsSync("/usr/bin/chromium")
                    ? "/usr/bin/chromium"
                    : undefined),
                args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
              },
            },
          },
        ],
});
