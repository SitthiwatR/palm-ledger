import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { assertRecoveryTarget } from "../src/server/recovery/restore";
test("recovery target rejects mixed projects, production, and insecure TLS before a connection is opened", async () => {
  const target = "https://recoveryabc123.supabase.co";
  const cases: [string, string, Record<string, unknown>?][] = [
    [
      "postgres://postgres:fixture@db.recoveryabc123.supabase.co/postgres?sslmode=verify-full",
      "https://feotpdylvprtihgklndj.supabase.co",
    ],
    [
      "postgres://postgres.feotpdylvprtihgklndj:fixture@aws-1-ap-southeast-1.pooler.supabase.com/postgres?sslmode=verify-full",
      target,
    ],
    [
      "postgres://postgres:fixture@db.recoveryabc123.supabase.co/postgres?sslmode=disable",
      target,
    ],
    [
      "postgres://postgres:fixture@db.recoveryabc123.supabase.co/postgres?sslmode=verify-full",
      target,
      { rejectUnauthorized: false },
    ],
    [
      "postgres://postgres:fixture@127.0.0.1:54422/postgres",
      "http://127.0.0.1:55421",
    ],
  ];
  for (const [connectionString, url, ssl] of cases) {
    const db = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });
    try {
      assert.throws(() => assertRecoveryTarget(db, url));
      assert.equal(db.totalCount, 0);
    } finally {
      await db.end();
    }
  }
  const db = new Pool({
    connectionString:
      "postgres://postgres:fixture@db.recoveryabc123.supabase.co/postgres?sslmode=verify-full",
  });
  try {
    assert.doesNotThrow(() => assertRecoveryTarget(db, target));
    assert.equal(db.totalCount, 0);
  } finally {
    await db.end();
  }
});
