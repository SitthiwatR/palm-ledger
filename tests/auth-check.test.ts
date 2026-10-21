import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authConfigSummary, authEnvFileMatches } from "../scripts/check-auth";

test("auth configuration reports only key type and unverified role/project/expiry flags", () => {
  const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role", ref: "chosen", exp: 1, private_claim: randomBytes(18).toString("hex") })).toString("base64url")}.fake-signature`;
  const summary = authConfigSummary({
    SUPABASE_URL: "https://chosen.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: key,
  });
  assert.equal(summary.claimedRole, "service_role");
  assert.equal(summary.claimedProjectMatches, true);
  assert.equal(summary.claimedExpired, true);
  assert.ok(!JSON.stringify(summary).includes(key));
  assert.equal(
    authConfigSummary({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_example" })
      .keyType,
    "publishable (not admin)",
  );
});

test("auth configuration detects an inherited key overriding the selected dotenv file without displaying either key", () => {
  const expected = randomBytes(18).toString("hex");
  const actual = randomBytes(18).toString("hex");
  const flags = authEnvFileMatches(
    `SUPABASE_URL=https://chosen.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${expected}`,
    {
      SUPABASE_URL: "https://chosen.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: actual,
    },
  );
  assert.equal(flags.SUPABASE_URL, true);
  assert.equal(flags.SUPABASE_SERVICE_ROLE_KEY, false);
  assert.ok(!JSON.stringify(flags).includes(expected));
  assert.ok(!JSON.stringify(flags).includes(actual));
});

test("auth check sends only an admin read, detects real dotenv precedence and redacts a rejected key from the provider message", async () => {
  const key = `sb_secret_${randomBytes(18).toString("hex")}`;
  const fileKey = `sb_secret_${randomBytes(18).toString("hex")}`;
  const requests: string[] = [];
  let authenticatedWithRuntimeKey = false;
  const server = createServer((req, res) => {
    requests.push(req.method + " " + req.url);
    authenticatedWithRuntimeKey = req.headers.apikey === key;
    res.writeHead(403, {
      "Content-Type": "application/json",
      "X-Supabase-Api-Version": "2024-01-01",
    });
    res.end(
      JSON.stringify({
        code: "not_admin",
        message: "User not allowed: " + key,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const folder = await mkdtemp(join(tmpdir(), "palm-auth-check-"));
  const file = join(folder, ".env.hosted.local");
  const origin = `http://127.0.0.1:${address.port}`;
  await writeFile(
    file,
    `SUPABASE_URL=${origin}\nSUPABASE_SERVICE_ROLE_KEY=${fileKey}`,
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [`--env-file=${file}`, "--import", "tsx", "scripts/check-auth.ts"],
    {
      env: {
        ...process.env,
        SUPABASE_URL: origin,
        SUPABASE_SERVICE_ROLE_KEY: key,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    const status = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(status, 1);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^GET \/auth\/v1\/admin\/users\?/);
    assert.ok(authenticatedWithRuntimeKey);
    assert.match(output, /"SUPABASE_SERVICE_ROLE_KEY":false/);
    assert.match(output, /"status":"403"/);
    assert.match(output, /User not allowed/);
    assert.ok(!output.includes(key));
    assert.ok(!output.includes(fileKey));
  } finally {
    child.kill();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
