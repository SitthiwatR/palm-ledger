import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { ownerErrorMessage } from "../scripts/owner";
import { databaseErrorDetails } from "../scripts/database-diagnostics";

function runOwner(
  password: string,
  overrides: Record<string, string> = {},
  args = ["create", "palm"],
) {
  const key = randomBytes(24).toString("base64url");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/owner.ts", ...args],
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

test("read-only owner check diagnoses connection failures without asking for a password", () => {
  const output = runOwner(
    randomBytes(18).toString("hex"),
    {
      DATABASE_URL: "postgresql://postgres:unused@127.0.0.1:1/postgres",
    },
    ["check"],
  );
  assert.match(output, /Database details:.*ECONNREFUSED/);
  assert.ok(!output.includes("New password"));
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

test("database details preserve nested errors while redacting passwords, keys and connection URLs", () => {
  const password = randomBytes(18).toString("hex") + "@/#%";
  const enteredPassword = randomBytes(18).toString("hex");
  const encoded = encodeURIComponent(password);
  const uri = `postgresql://postgres:${encoded}@127.0.0.1:1/postgres`;
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = uri;
  try {
    const underlying = Object.assign(
      new Error(`rejected ${password} ${encoded} ${uri} ${enteredPassword}`),
      { code: "28P01" },
    );
    const result = JSON.stringify(
      databaseErrorDetails(new AggregateError([underlying], "connect failed"), [
        enteredPassword,
      ]),
    );
    assert.match(result, /28P01/);
    assert.match(result, /connect failed/);
    for (const secret of [password, encoded, uri, enteredPassword])
      assert.ok(!result.includes(secret));
    assert.ok(!result.includes("stack"));
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test(
  "owner CLI explains a real database handshake timeout even when pg supplies no error code",
  { timeout: 20_000 },
  async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const password = randomBytes(18).toString("hex");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/owner.ts", "create", "palm"],
      {
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${address.port}/postgres`,
          POSTGRES_URL: "",
          SUPABASE_URL: "http://127.0.0.1:1",
          SUPABASE_SERVICE_ROLE_KEY: randomBytes(18).toString("hex"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.stdin.end(password + "\n");
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      assert.equal(code, 1);
      assert.match(output, /\[database\]: Connection timed out/);
      assert.match(output, /Database details:.*connection timeout/i);
      assert.ok(!output.includes(password));
    } finally {
      child.kill();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
