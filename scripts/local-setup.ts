import { randomBytes, createHmac } from "node:crypto";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { Pool } from "pg";

const test = process.argv.includes("--test");
const filename = test ? ".env.test.local" : ".env.local";
const apiPort = test ? 54421 : 54321,
  dbPort = test ? 54422 : 54322;
if (!existsSync(filename)) {
  const secret = randomBytes(32).toString("hex");
  const db = randomBytes(24).toString("hex"),
    auth = randomBytes(24).toString("hex"),
    rest = randomBytes(24).toString("hex");
  const jwt = (role: string) => {
    const data =
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ) +
      "." +
      Buffer.from(
        JSON.stringify({
          role,
          iss: "supabase",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 315360000,
        }),
      ).toString("base64url");
    return (
      data + "." + createHmac("sha256", secret).update(data).digest("base64url")
    );
  };
  writeFileSync(
    filename,
    [
      "PALM_LOCAL_DEVELOPMENT=true",
      `PALM_TEST_ENVIRONMENT=${test}`,
      `APP_URL=http://127.0.0.1:${test ? 3100 : 3000}`,
      `SUPABASE_URL=http://127.0.0.1:${apiPort}`,
      `SUPABASE_ANON_KEY=${jwt("anon")}`,
      `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`,
      `DATABASE_URL=postgres://postgres:${db}@127.0.0.1:${dbPort}/postgres`,
      `LOCAL_DB_PORT=${dbPort}`,
      `LOCAL_API_PORT=${apiPort}`,
      `LOCAL_JWT_EXP=${test ? 45 : 3600}`,
      `SESSION_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
      `LOCAL_DB_PASSWORD=${db}`,
      `LOCAL_AUTH_PASSWORD=${auth}`,
      `LOCAL_REST_PASSWORD=${rest}`,
      `LOCAL_JWT_SECRET=${secret}`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Generated private local-development configuration. No credentials printed.",
  );
}
const values = parseEnv(readFileSync(filename, "utf8"));
let database: URL;
try {
  database = new URL(values.DATABASE_URL || "");
} catch {
  throw new Error(
    "Invalid local database configuration. Existing values were preserved.",
  );
}
if (
  values.PALM_LOCAL_DEVELOPMENT !== "true" ||
  values.SUPABASE_URL !== `http://127.0.0.1:${apiPort}` ||
  database.hostname !== "127.0.0.1" ||
  database.port !== String(dbPort) ||
  database.pathname !== "/postgres"
)
  throw new Error(
    "Existing configuration is not the local stack. It was preserved.",
  );
execFileSync(
  "docker",
  [
    "compose",
    "--project-name",
    test ? "palm-ledger-test" : "palm-ledger-dev",
    "--env-file",
    filename,
    "-f",
    "compose.local.yml",
    "up",
    "-d",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...values,
      ...(test ? { LOCAL_JWT_EXP: "45" } : {}),
    },
  },
);
execFileSync(
  "docker",
  [
    "compose",
    "--project-name",
    test ? "palm-ledger-test" : "palm-ledger-dev",
    "--env-file",
    filename,
    "-f",
    "compose.local.yml",
    "exec",
    "-T",
    "gateway",
    "nginx",
    "-s",
    "reload",
  ],
  { stdio: "ignore" },
);
let storageSearchPathConfigured = false;
for (let attempt = 0; attempt < 60; attempt++) {
  const authOk = await fetch(values.SUPABASE_URL + "/auth/v1/health")
    .then((r) => r.ok)
    .catch(() => false);
  if (authOk && !storageSearchPathConfigured) {
    // Supabase's PostgreSQL image normally supplies this modern JWT helper.
    // GoTrue's standalone bootstrap ships its legacy implementation instead.
    const db = new Pool({ connectionString: values.DATABASE_URL });
    const storageSchema = await db.query(
      "select to_regnamespace('storage') is not null as ready",
    );
    if (!storageSchema.rows[0].ready) {
      await db.end();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    try {
      await db.query(`create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$`);
      await db.query("alter role postgres set search_path to storage, public");
      await db.query(
        "grant usage on schema storage to anon, authenticated, service_role",
      );
      await db.query(
        "grant all privileges on all tables in schema storage to service_role",
      );
      await db.query(
        "grant usage, select on all sequences in schema storage to service_role",
      );
    } finally {
      await db.end();
    }
    execFileSync(
      "docker",
      [
        "compose",
        "--project-name",
        test ? "palm-ledger-test" : "palm-ledger-dev",
        "--env-file",
        filename,
        "-f",
        "compose.local.yml",
        "restart",
        "storage",
      ],
      { stdio: "ignore" },
    );
    storageSearchPathConfigured = true;
  }
  const storageOk =
    authOk &&
    (await fetch(values.SUPABASE_URL + "/storage/v1/bucket", {
      headers: {
        apikey: values.SUPABASE_SERVICE_ROLE_KEY || "",
        Authorization: `Bearer ${values.SUPABASE_SERVICE_ROLE_KEY || ""}`,
      },
    })
      .then((r) => r.ok)
      .catch(() => false));
  if (authOk && storageOk) {
    console.log(
      "Local PostgreSQL, Supabase Auth, REST and Storage are available.",
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error(
  "Auth did not become ready. Inspect local Docker service logs.",
);
