import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { pool } from "../src/server/db";
import { migrate } from "../scripts/migrate";
import { manageOwner } from "../scripts/owner";
import { supabase } from "../src/server/auth";

export const testEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(
  parseEnv(readFileSync(".env.test.local", "utf8")),
))
  if (value !== undefined) testEnv[key] = value;
if (
  testEnv.PALM_TEST_ENVIRONMENT !== "true" ||
  testEnv.PALM_LOCAL_DEVELOPMENT !== "true" ||
  new URL(testEnv.DATABASE_URL).hostname !== "127.0.0.1" ||
  new URL(testEnv.DATABASE_URL).port !== "54422" ||
  new URL(testEnv.DATABASE_URL).pathname !== "/postgres" ||
  testEnv.SUPABASE_URL !== "http://127.0.0.1:54421" ||
  testEnv.APP_URL !== "http://127.0.0.1:3100"
) {
  throw new Error(
    "Refusing to run destructive fixtures outside the isolated local test stack.",
  );
}
Object.assign(process.env, testEnv);
export const password = randomBytes(18).toString("base64url");
export const username = "เจ้าของสวน";
export const origin = testEnv.APP_URL;
export async function prepare() {
  await Promise.all([migrate(), migrate()]); // Concurrent deploys serialize safely.
  await migrate(); // Repeatability must preserve the already applied schema.
  await pool().query(
    "truncate private.owner_sessions, private.login_attempts, private.idempotency_requests,public.audit_events,public.gardens,public.owner_accounts cascade",
  );
  const users = await supabase(true).auth.admin.listUsers();
  for (const user of users.data.users)
    await supabase(true).auth.admin.deleteUser(user.id);
  return manageOwner("create", username, password);
}
export async function startApp(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      process.env.TEST_APP_MODE === "production" ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
    {
      env: {
        ...process.env,
        ...testEnv,
        NEXT_TELEMETRY_DISABLED: "1",
        ...(process.env.TEST_USE_POSTGRES_URL === "1"
          ? { DATABASE_URL: "", POSTGRES_URL: testEnv.DATABASE_URL }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let output = "";
  child.stdout?.on("data", (d) => {
    output += d;
  });
  child.stderr?.on("data", (d) => {
    output += d;
  });
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null)
      throw new Error(
        "Test app exited before readiness. Inspect local Next.js configuration.",
      );
    if (
      await fetch(origin + "/login")
        .then((r) => r.ok)
        .catch(() => false)
    )
      return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.kill(-child.pid!, "SIGTERM");
  // Do not print server logs, which could include environment configuration.
  throw new Error(
    "Test app did not become ready. Captured " + output.length + " log bytes.",
  );
}
export async function stopApp(child: ChildProcess | undefined) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  await pool().end();
}
