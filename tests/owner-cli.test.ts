import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ownerErrorMessage } from "../scripts/owner";

function runOwner(password: string, overrides: Record<string, string> = {}) {
  const key = randomBytes(24).toString("base64url");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/owner.ts", "create", "palm"],
    {
      input: password + "\n",
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        DATABASE_URL: "",
        POSTGRES_URL: "",
        SUPABASE_URL: "http://127.0.0.1:1",
        SUPABASE_SERVICE_ROLE_KEY: key,
        ...overrides,
      },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(password));
  assert.ok(!output.includes(key));
  assert.ok(
    !output.includes("\n    at "),
    "No raw stack should escape the CLI",
  );
  return output;
}

test("owner CLI explains invalid passwords and missing configuration without a shutdown error", () => {
  assert.match(
    runOwner("short-" + randomBytes(2).toString("hex")),
    /\[validation\].*12–128/,
  );
  assert.match(
    runOwner(randomBytes(18).toString("base64url")),
    /\[configuration\].*DATABASE_URL/,
  );
});

test("owner CLI identifies a refused database connection without disclosing URI credentials", () => {
  const dbPassword = randomBytes(18).toString("hex");
  const output = runOwner(randomBytes(18).toString("base64url"), {
    DATABASE_URL: `postgresql://postgres:${dbPassword}@127.0.0.1:1/postgres`,
  });
  assert.match(output, /\[database\].*Connection refused/);
  assert.ok(!output.includes(dbPassword));
  assert.ok(!output.includes("postgresql://"));
});

test("provider diagnostics explain rejected admin keys and discard arbitrary error payloads", () => {
  const secret = randomBytes(24).toString("base64url");
  const rejected = ownerErrorMessage({
    status: 403,
    message: secret,
    code: secret,
  });
  assert.match(rejected, /service_role\/secret key/);
  assert.ok(!rejected.includes(secret));
  const unknown = ownerErrorMessage({
    message: secret,
    details: secret,
    code: secret,
  });
  assert.ok(!unknown.includes(secret));
});
