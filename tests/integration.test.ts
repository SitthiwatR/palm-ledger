import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import {
  prepare,
  password,
  username,
  origin,
  startApp,
  stopApp,
} from "./support";
import { pool } from "../src/server/db";
import { hash, supabase } from "../src/server/auth";
import { manageOwner } from "../scripts/owner";

let app: ChildProcess,
  cookie = "",
  ownerId = "",
  gardenId = "",
  version = 1;
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  extra: Record<string, string> = {},
) {
  const response = await fetch(origin + "/api/v1/" + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { response, data: await response.json() };
}
before(async () => {
  ownerId = await prepare();
  app = await startApp();
});
after(() => stopApp(app));

test("owner-only API rejects anonymous and cross-origin requests; signup is disabled", async () => {
  assert.equal((await request("gardens")).response.status, 401);
  assert.equal(
    (
      await request(
        "session",
        "POST",
        { username, password },
        { Origin: "https://other.invalid" },
      )
    ).response.status,
    403,
  );
  const signup = await supabase().auth.signUp({
    email: "not-an-owner@example.invalid",
    password,
  });
  assert.ok(signup.error, "Public signup must be disabled");
});
test("username/password login sets a private 30-day cookie and resolves the owner", async () => {
  const wrong = await request("session", "POST", {
    username,
    password: "incorrect-password",
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.data.error.code, "INVALID_CREDENTIALS");
  const result = await request("session", "POST", { username, password });
  assert.equal(result.response.status, 200);
  const header = result.response.headers.get("set-cookie")!;
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Max-Age=2592000/i);
  cookie = header.split(";")[0];
  assert.equal((await request("session")).data.username, username);
  assert.ok(!JSON.stringify(result.data).includes("token"));
});
test("creates two gardens, persists opening balances, and rejects duplicate retries and key reuse", async () => {
  const key = randomUUID(),
    input = { name: "สวน A", openingMinor: 2800000 };
  const [first, retry] = await Promise.all([
    request("gardens", "POST", input, { "Idempotency-Key": key }),
    request("gardens", "POST", input, { "Idempotency-Key": key }),
  ]);
  assert.equal(first.response.status, 201);
  assert.equal(retry.data.id, first.data.id);
  gardenId = first.data.id;
  assert.equal(
    (
      await request(
        "gardens",
        "POST",
        { ...input, name: "อื่น" },
        { "Idempotency-Key": key },
      )
    ).response.status,
    409,
  );
  await request(
    "gardens",
    "POST",
    { name: "สวน B", openingMinor: 1480000 },
    { "Idempotency-Key": randomUUID() },
  );
  const list = await request("gardens");
  assert.equal(list.data.gardens.length, 2);
  assert.deepEqual((await request("summary")).data, {
    netMinor: 4280000,
    gardenCount: 2,
  });
  const audit = await pool().query(
    "select count(*)::int as n from public.audit_events where action='garden.created'",
  );
  assert.equal(audit.rows[0].n, 2);
});
test("validation failures and duplicate names leave data unchanged", async () => {
  assert.equal(
    (
      await request(
        "gardens",
        "POST",
        { name: "x".repeat(9000), openingMinor: 0 },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    413,
  );
  assert.equal(
    (
      await request(
        "gardens",
        "POST",
        { name: " ", openingMinor: 1 },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    422,
  );
  assert.equal(
    (
      await request(
        "gardens",
        "POST",
        { name: "เศษ", openingMinor: 1.1 },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    422,
  );
  assert.equal(
    (
      await request(
        "gardens",
        "POST",
        { name: "สวน A", openingMinor: 0 },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    409,
  );
  assert.equal((await request("gardens")).data.gardens.length, 2);
});
test("concurrent edits reject stale versions; archive retains balances, rows and audit", async () => {
  const results = await Promise.all(
    ["สวนใหม่", "สวนอีกชื่อ"].map((name) =>
      request(
        "gardens/" + gardenId,
        "PATCH",
        { name, expectedVersion: version },
        { "Idempotency-Key": randomUUID() },
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.response.status).sort(), [200, 409]);
  version++;
  const edited = await request(
    "gardens/" + gardenId,
    "PATCH",
    { openingMinor: -500, archived: true, expectedVersion: version },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(edited.response.status, 200);
  assert.equal(edited.data.version, 3);
  assert.equal(edited.data.archived, true);
  assert.deepEqual((await request("summary")).data, {
    netMinor: 1479500,
    gardenCount: 2,
  });
  assert.equal((await request("gardens/" + gardenId)).data.openingMinor, -500);
  const audit = await pool().query(
    "select * from public.audit_events where entity_id=$1 and action='garden.updated' order by id",
    [gardenId],
  );
  assert.equal(audit.rows.length, 2);
  assert.equal(audit.rows[1].before_data.archived, false);
  assert.equal(audit.rows[1].after_data.archived, true);
});
test("Supabase REST RLS denies non-owners and direct writes, but allows owner reads", async () => {
  const owner = await supabase(true).auth.admin.getUserById(ownerId);
  assert.ok(owner.data.user);
  const auth = await supabase().auth.signInWithPassword({
    email: owner.data.user.email!,
    password,
  });
  const url = process.env.SUPABASE_URL + "/rest/v1/gardens";
  const headers = {
    apikey: process.env.SUPABASE_ANON_KEY!,
    Authorization: "Bearer " + auth.data.session!.access_token,
  };
  const mine = await fetch(url, { headers });
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).length, 2);
  const write = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_id: ownerId,
      name: "bypass",
      opening_minor: 1,
    }),
  });
  assert.ok(write.status >= 400);
  const other = await supabase(true).auth.admin.createUser({
    email: "other@example.invalid",
    password,
    email_confirm: true,
  });
  const otherAuth = await supabase().auth.signInWithPassword({
    email: other.data.user!.email!,
    password,
  });
  const denied = await fetch(url, {
    headers: {
      ...headers,
      Authorization: "Bearer " + otherAuth.data.session!.access_token,
    },
  });
  assert.equal(denied.status, 200);
  assert.deepEqual(await denied.json(), []);
  const anon = await fetch(url, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY! },
  });
  assert.ok(anon.status >= 400);
});
test("expired sessions, logout, and administrator password reset invalidate app access", async () => {
  const oldCookie = cookie;
  await manageOwner("reset", username, password + "new");
  assert.equal((await request("gardens")).response.status, 401);
  assert.equal(
    (await request("session", "POST", { username, password })).response.status,
    401,
  );
  const updated = await request("session", "POST", {
    username,
    password: password + "new",
  });
  assert.equal(updated.response.status, 200);
  cookie = updated.response.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(cookie, oldCookie);
  await pool().query(
    "update private.owner_sessions set expires_at=now()-interval '1 second' where token_hash=$1",
    [hash(cookie.split("=")[1])],
  );
  assert.equal((await request("session")).response.status, 401);
  const again = await request("session", "POST", {
    username,
    password: password + "new",
  });
  cookie = again.response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("session", "DELETE")).response.status, 200);
  assert.equal((await request("session")).response.status, 401);
});
test("failed-login throttling is persistent and returns a generic error for unknown users", async () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request("session", "POST", {
          username: "unknown",
          password: "wrong",
        })
      ).response.status,
      401,
    );
  assert.equal(
    (
      await request("session", "POST", {
        username: "unknown",
        password: "wrong",
      })
    ).response.status,
    429,
  );
});
