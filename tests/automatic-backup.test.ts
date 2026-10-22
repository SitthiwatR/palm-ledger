import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  archiveName,
  offsiteHealth,
  proofName,
  validateAutomaticSource,
  type Artifact,
} from "../src/server/recovery/automatic";
test("offsite watchdog rejects absent, incomplete, expired, future and stale points independently of Supabase", () => {
  const now = Date.parse("2026-10-22T12:00:00Z"),
    id = "c07c5ebd-f147-4a5a-afd7-e458e01ac67d";
  const point = (hours: number): Artifact[] => [
    {
      id: "1",
      name: archiveName(id, 1),
      size: 1000,
      expired: false,
      runId: "12",
    },
    {
      id: "2",
      name: proofName(new Date(now - hours * 3600000).toISOString(), id, 1),
      size: 100,
      expired: false,
      runId: "12",
    },
  ];
  assert.equal(offsiteHealth([], now).status, "missing");
  assert.equal(offsiteHealth(point(1), now).status, "fresh");
  assert.equal(offsiteHealth(point(24), now).status, "fresh");
  assert.equal(offsiteHealth(point(25), now).status, "stale");
  assert.equal(offsiteHealth(point(-1), now).status, "missing");
  assert.equal(offsiteHealth(point(1).slice(1), now).status, "missing");
  const expired = point(1);
  expired[0].expired = true;
  assert.equal(offsiteHealth(expired, now).status, "missing");
  const wrong = point(1);
  wrong[0].runId = "13";
  assert.equal(offsiteHealth(wrong, now).status, "missing");
});
test("automatic source requires explicit enablement, the correct project and verified TLS before connecting", async () => {
  const source = "https://feotpdylvprtihgklndj.supabase.co";
  const cases: [string, Record<string, string>, Record<string, unknown>?][] = [
    [
      "postgres://postgres:fixture@db.feotpdylvprtihgklndj.supabase.co/postgres?sslmode=verify-full",
      { SUPABASE_URL: source },
    ],
    [
      "postgres://postgres.other:fixture@aws-1-ap-southeast-1.pooler.supabase.com/postgres?sslmode=verify-full",
      { SUPABASE_URL: source, PALM_AUTOMATED_BACKUP: "true" },
    ],
    [
      "postgres://postgres:fixture@db.feotpdylvprtihgklndj.supabase.co/postgres?sslmode=disable",
      { SUPABASE_URL: source, PALM_AUTOMATED_BACKUP: "true" },
    ],
    [
      "postgres://postgres:fixture@db.feotpdylvprtihgklndj.supabase.co/postgres?sslmode=verify-full",
      { SUPABASE_URL: source, PALM_AUTOMATED_BACKUP: "true" },
      { rejectUnauthorized: false },
    ],
  ];
  for (const [connectionString, env, ssl] of cases) {
    const db = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });
    try {
      assert.throws(() => validateAutomaticSource(db, env));
      assert.equal(db.totalCount, 0);
    } finally {
      await db.end();
    }
  }
  const db = new Pool({
    connectionString:
      "postgres://postgres:fixture@db.feotpdylvprtihgklndj.supabase.co/postgres?sslmode=verify-full",
  });
  try {
    assert.doesNotThrow(() =>
      validateAutomaticSource(db, {
        SUPABASE_URL: source,
        PALM_AUTOMATED_BACKUP: "true",
      }),
    );
    assert.equal(db.totalCount, 0);
  } finally {
    await db.end();
  }
});
