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
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
test("sales use server cents math, private Storage receipts, duplicate confirmation, and idempotent retries", async () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nV8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  async function uploadReceipt() {
    const key = randomUUID();
    const prepared = await request(
      "receipts/upload-url",
      "POST",
      { mimeType: "image/png", sizeBytes: png.length },
      { "Idempotency-Key": key },
    );
    assert.equal(prepared.response.status, 201);
    const storage = createClient(
      prepared.data.supabaseUrl,
      prepared.data.anonKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const uploaded = await storage.storage
      .from(prepared.data.bucket)
      .uploadToSignedUrl(
        prepared.data.path,
        prepared.data.token,
        new Blob([png], { type: "image/png" }),
        { contentType: "image/png", upsert: false },
      );
    assert.equal(uploaded.error, null);
    return prepared.data.id;
  }
  const receiptId = await uploadReceipt(),
    key = randomUUID();
  const payload = {
    gardenId,
    saleDate: "2026-10-20",
    buyer: "ลานปาล์ม",
    invoiceNumber: "BILL-001",
    weightKg: "3500",
    priceBahtPerKg: "5",
    deductions: [{ description: "ค่าขนส่ง", amountBaht: "500" }],
    pendingReceiptId: receiptId,
    receivedFull: true,
    confirmDuplicate: false,
  };
  const saved = await request("sales", "POST", payload, {
    "Idempotency-Key": key,
  });
  assert.equal(saved.response.status, 201);
  assert.equal(saved.data.netMinor, 1700000);
  const retry = await request("sales", "POST", payload, {
    "Idempotency-Key": key,
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.id, saved.data.id);
  const mismatch = await request(
    "sales",
    "POST",
    { ...payload, buyer: "ข้อมูลอื่น" },
    { "Idempotency-Key": key },
  );
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.data.error.code, "IDEMPOTENCY_CONFLICT");
  const receipt = await pool().query(
    "select * from public.receipt_files where sale_id=$1",
    [saved.data.id],
  );
  assert.equal(receipt.rows.length, 1);
  assert.equal(receipt.rows[0].size_bytes, png.length);
  assert.equal(
    receipt.rows[0].sha256,
    (await import("node:crypto"))
      .createHash("sha256")
      .update(png)
      .digest("hex"),
  );
  assert.equal(
    (
      await request("receipts/" + receipt.rows[0].id, "GET", undefined, {
        Cookie: "",
      })
    ).response.status,
    401,
  );
  const signed = await request("receipts/" + receipt.rows[0].id);
  assert.equal(signed.response.status, 200);
  const source = await fetch(signed.data.url);
  assert.equal(source.status, 200);
  assert.equal(
    Buffer.from(await source.arrayBuffer()).compare(Buffer.from(png)),
    0,
  );
  const saleList = await request("sales");
  assert.equal(saleList.data.sales[0].netMinor, 1700000);
  assert.equal((await request("summary")).data.netMinor, 5980000);
  const duplicateReceipt = await uploadReceipt();
  const duplicateKey = randomUUID();
  const duplicatePayload = {
    ...payload,
    pendingReceiptId: duplicateReceipt,
    receivedFull: true,
  };
  const warning = await request("sales", "POST", duplicatePayload, {
    "Idempotency-Key": duplicateKey,
  });
  assert.equal(warning.response.status, 409);
  assert.equal(warning.data.error.code, "DUPLICATE_BILL");
  const confirmed = await request(
    "sales",
    "POST",
    { ...duplicatePayload, confirmDuplicate: true },
    { "Idempotency-Key": duplicateKey },
  );
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.data.netMinor, 1700000);
  const invalidUpload = await request(
    "receipts/upload-url",
    "POST",
    { mimeType: "image/png", sizeBytes: 10485761 },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(invalidUpload.response.status, 422);
  const heic = readFileSync("tests/fixtures/sample.heic");
  const heicPrepared = await request(
    "receipts/upload-url",
    "POST",
    { mimeType: "image/heic", sizeBytes: heic.length },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(heicPrepared.response.status, 201);
  const heicStorage = createClient(
    heicPrepared.data.supabaseUrl,
    heicPrepared.data.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const heicUploaded = await heicStorage.storage
    .from(heicPrepared.data.bucket)
    .uploadToSignedUrl(
      heicPrepared.data.path,
      heicPrepared.data.token,
      new Blob([heic], { type: "image/heic" }),
      { contentType: "image/heic", upsert: false },
    );
  assert.equal(heicUploaded.error, null);
  const heicSale = await request(
    "sales",
    "POST",
    {
      ...payload,
      invoiceNumber: "BILL-HEIC",
      weightKg: "1",
      priceBahtPerKg: "1",
      deductions: [],
      pendingReceiptId: heicPrepared.data.id,
      receivedFull: true,
      confirmDuplicate: false,
    },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(heicSale.response.status, 201);
  assert.equal(heicSale.data.netMinor, 100);
  const heicRecord = await pool().query(
    "select * from public.receipt_files where sale_id=$1",
    [heicSale.data.id],
  );
  assert.equal(heicRecord.rows[0].size_bytes, heic.length);
  assert.equal(heicRecord.rows[0].mime_type, "image/heic");
  assert.equal(
    heicRecord.rows[0].sha256,
    (await import("node:crypto"))
      .createHash("sha256")
      .update(heic)
      .digest("hex"),
  );
  const heicSigned = await request("receipts/" + heicRecord.rows[0].id);
  const heicSource = await fetch(heicSigned.data.url);
  assert.equal(heicSource.status, 200);
  assert.equal(Buffer.from(await heicSource.arrayBuffer()).compare(heic), 0);
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
    netMinor: 4879600,
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
