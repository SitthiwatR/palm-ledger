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
  assert.ok([200, 201].includes(first.response.status));
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
    laborPendingMinor: 0,
    expensePendingMinor: 0,
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
        { name: "x".repeat(33000), openingMinor: 0 },
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
  assert.equal(saleList.data.sales[0].saleDate, "2026-10-20");
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
test("sale and daily/weight labor commit atomically, affect balances once, preserve calculation bases and remember rates", async () => {
  const before = (await request("summary")).data.netMinor;
  const base = {
    gardenId,
    saleDate: "2026-10-21",
    buyer: "ทดสอบค่าแรง",
    weightKg: "3500",
    priceBahtPerKg: "5",
    deductions: [{ description: "ค่าขนส่ง", amountBaht: "500" }],
    receivedFull: true,
  };
  const weighted = {
    ...base,
    invoiceNumber: "LABOR-WEIGHT",
    pendingReceiptId: await uploadReceipt(),
    labor: [
      { mode: "weight", payee: "ทีมตัด", quantity: "3500", rateBaht: "1000" },
    ],
  };
  const key = randomUUID();
  const saved = await request("sales", "POST", weighted, {
    "Idempotency-Key": key,
  });
  assert.equal(saved.response.status, 201);
  assert.equal(saved.data.netMinor, 1700000);
  assert.equal(saved.data.laborMinor, 350000);
  const retry = await request("sales", "POST", weighted, {
    "Idempotency-Key": key,
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.id, saved.data.id);
  assert.equal((await request("summary")).data.netMinor, before + 1350000);
  assert.equal((await request("summary")).data.laborPendingMinor, 350000);
  const details = (await request("sales")).data.sales.find(
    (s: { id: string }) => s.id === saved.data.id,
  );
  assert.equal(details.labor[0].quantity, "3500");
  assert.equal(details.labor[0].rateBaht, "1000.00");
  const preferences = (await request("sales/preferences")).data;
  assert.equal(preferences.gardenId, gardenId);
  assert.equal(preferences.profiles[0].payee, "ทีมตัด");
  assert.equal(preferences.profiles[0].rateBaht, "1000.00");
  const daily = {
    ...base,
    invoiceNumber: "LABOR-DAILY",
    pendingReceiptId: await uploadReceipt(),
    labor: [
      { mode: "daily", payee: "สมชาย", quantity: "0.5", rateBaht: "400" },
      { mode: "daily", payee: "สมศรี", quantity: "1.5", rateBaht: "350" },
    ],
  };
  const invalid = await request(
    "sales",
    "POST",
    { ...daily, labor: [{ ...daily.labor[0], quantity: "0.25" }] },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.data.error.code, "INVALID_LABOR");
  const paid = await request("sales", "POST", daily, {
    "Idempotency-Key": randomUUID(),
  });
  assert.equal(paid.response.status, 201);
  assert.equal(paid.data.laborMinor, 72500);
  assert.equal((await request("summary")).data.netMinor, before + 2977500);
  const pending = await uploadReceipt();
  assert.equal(
    (
      await request(
        "receipts/verify",
        "POST",
        { pendingReceiptId: pending },
        { Cookie: "" },
      )
    ).response.status,
    401,
  );
  const atomic = {
    ...base,
    invoiceNumber: "LABOR-ROLLBACK",
    weightKg: "1",
    priceBahtPerKg: "1",
    deductions: [],
    pendingReceiptId: pending,
    labor: [
      {
        mode: "daily",
        payee: "rollback-fixture",
        quantity: "1",
        rateBaht: "1",
      },
    ],
  };
  const atomicKey = randomUUID();
  const snapshot = (
    await pool().query(
      "select (select count(*) from public.sales)::int sales,(select count(*) from public.sale_labor)::int labor,(select count(*) from public.receipt_files)::int receipts",
    )
  ).rows[0];
  await pool().query(
    "create function private.test_reject_profile() returns trigger language plpgsql set search_path='' as $$ begin if NEW.payee='rollback-fixture' then raise exception 'fixture failure'; end if; return NEW; end $$; create trigger test_reject_profile before insert on public.labor_profiles for each row execute function private.test_reject_profile()",
  );
  try {
    assert.equal(
      (await request("sales", "POST", atomic, { "Idempotency-Key": atomicKey }))
        .response.status,
      500,
    );
    assert.deepEqual(
      (
        await pool().query(
          "select (select count(*) from public.sales)::int sales,(select count(*) from public.sale_labor)::int labor,(select count(*) from public.receipt_files)::int receipts",
        )
      ).rows[0],
      snapshot,
    );
    assert.equal(
      (await request("receipts/verify", "POST", { pendingReceiptId: pending }))
        .response.status,
      200,
    );
  } finally {
    await pool().query(
      "drop trigger test_reject_profile on public.labor_profiles; drop function private.test_reject_profile()",
    );
  }
  const recovered = await request("sales", "POST", atomic, {
    "Idempotency-Key": atomicKey,
  });
  assert.equal(recovered.response.status, 201);
  assert.equal(recovered.data.laborMinor, 100);
  assert.equal((await request("summary")).data.netMinor, before + 2977500);
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
    netMinor: 7857100,
    gardenCount: 2,
    laborPendingMinor: 422600,
    expensePendingMinor: 0,
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
test("standalone daily wages reuse profiles, override one record, and count incurred expenses once for every initial payment state", async () => {
  const gardens = (await request("gardens")).data.gardens;
  const activeId = gardens.find((g: { archived: boolean }) => !g.archived).id;
  const before = (await request("summary")).data;
  const wage = {
    gardenId: activeId,
    expenseDate: "2026-10-21",
    kind: "daily_labor",
    payee: "คนงานเฟสสาม",
    unit: "day",
    quantity: "0.5",
    rateBaht: "500",
    paymentStatus: "unpaid",
    note: "ครึ่งวัน",
  };
  const create = (input: unknown, key = randomUUID()) =>
    request("expenses", "POST", input, { "Idempotency-Key": key });
  const key = randomUUID();
  const [first, retry] = await Promise.all([
    create(wage, key),
    create(wage, key),
  ]);
  assert.ok([200, 201].includes(first.response.status));
  assert.ok([200, 201].includes(retry.response.status));
  assert.equal(first.data.id, retry.data.id);
  assert.equal(first.data.amountMinor, 25000);
  assert.equal(first.data.pendingMinor, 25000);
  assert.equal(
    (await create({ ...wage, rateBaht: "600" }, key)).response.status,
    409,
  );
  let profile = (await request("sales/preferences")).data.profiles.find(
    (p: { payee: string }) => p.payee === wage.payee,
  );
  assert.equal(profile.rateBaht, "500.00");
  const override = await create({
    ...wage,
    rateBaht: "600",
    rememberRate: false,
    paymentStatus: "full",
    paymentDate: "2026-10-22",
  });
  assert.equal(override.data.amountMinor, 30000);
  assert.equal(override.data.pendingMinor, 0);
  profile = (await request("sales/preferences")).data.profiles.find(
    (p: { payee: string }) => p.payee === wage.payee,
  );
  assert.equal(profile.rateBaht, "500.00");
  const pendingReceiptId = await uploadReceipt();
  const fertilizer = {
    ...wage,
    kind: "fertilizer",
    unit: "sack",
    quantity: "4",
    rateBaht: "800",
    paymentStatus: "partial",
    paidBaht: "1200",
    paymentDate: "2026-10-23",
    pendingReceiptId,
  };
  const fertilizerKey = randomUUID();
  const [used, repeated] = await Promise.all([
    create(fertilizer, fertilizerKey),
    create(fertilizer, fertilizerKey),
  ]);
  assert.ok([200, 201].includes(used.response.status));
  assert.ok([200, 201].includes(repeated.response.status));
  assert.equal(used.data.id, repeated.data.id);
  assert.equal(used.data.amountMinor, 320000);
  assert.equal(used.data.paidMinor, 120000);
  assert.equal(used.data.pendingMinor, 200000);
  assert.equal((await create(fertilizer, fertilizerKey)).data.id, used.data.id);
  assert.equal(
    (await request("summary")).data.netMinor,
    before.netMinor - 375000,
  );
  assert.equal((await request("summary")).data.expensePendingMinor, 225000);
  assert.equal(
    (await request("summary")).data.laborPendingMinor,
    before.laborPendingMinor,
  );
  const garden = (await request("gardens/" + activeId)).data;
  assert.equal(garden.expensePendingMinor, 225000);
  const all = (await request("expenses")).data.expenses;
  assert.equal(all.length, 3);
  const item = all.find((e: { id: string }) => e.id === used.data.id);
  assert.equal(item.expenseDate, "2026-10-21");
  assert.equal(item.payments[0].paymentDate, "2026-10-23");
  assert.equal(item.payments[0].amountMinor, 120000);
  const signed = await request("receipts/" + item.receiptId);
  assert.equal(signed.response.status, 200);
  assert.equal((await fetch(signed.data.url)).status, 200);
  assert.equal(
    (
      await request("receipts/" + item.receiptId, "GET", undefined, {
        Cookie: "",
      })
    ).response.status,
    401,
  );
  assert.equal(
    (await request("expenses", "GET", undefined, { Cookie: "" })).response
      .status,
    401,
  );
  assert.equal(
    (
      await request("expenses", "POST", wage, {
        Cookie: "",
        "Idempotency-Key": randomUUID(),
      })
    ).response.status,
    401,
  );
  for (const patch of [
    { kind: "purchase" },
    { unit: "kg" },
    { unit: "sack" },
    { quantity: "-1" },
    { quantity: "0" },
    { quantity: "0.25" },
    { rateBaht: "-1" },
    { rateBaht: "0" },
    { paymentStatus: "partial", paidBaht: "251", paymentDate: "2026-10-21" },
    { paymentStatus: "partial", paidBaht: "250", paymentDate: "2026-10-21" },
    { paymentStatus: "partial", paidBaht: "0", paymentDate: "2026-10-21" },
    { paymentStatus: "full" },
    { paymentStatus: "unpaid", paidBaht: "1" },
    { paymentStatus: "unpaid", paymentDate: "2026-10-21" },
    { expenseDate: "2026-02-30" },
  ])
    assert.equal(
      (await create({ ...wage, ...patch })).response.status,
      422,
      JSON.stringify(patch),
    );
  assert.equal(
    (await create({ ...wage, gardenId })).response.status,
    404,
    "archived garden",
  );
  assert.equal(
    (await create({ ...wage, gardenId: randomUUID() })).response.status,
    404,
  );
  assert.equal(
    (await create({ ...wage, pendingReceiptId })).response.status,
    422,
    "consumed receipt",
  );
  assert.equal(
    (await request("summary")).data.netMinor,
    before.netMinor - 375000,
  );
  assert.equal(
    (await pool().query("select count(*)::int n from public.expense_payments"))
      .rows[0].n,
    2,
  );
  assert.equal(
    (
      await pool().query(
        "select count(*)::int n from public.audit_events where action='expense.created'",
      )
    ).rows[0].n,
    3,
  );
  // DB-level guards defend unit/calculation and overpayment, in addition to API checks.
  await assert.rejects(
    pool().query(
      "insert into public.expense_payments(owner_id,expense_id,payment_date,amount_minor) values($1,$2,'2026-10-21',200001)",
      [ownerId, used.data.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool().query("update public.expenses set unit='sack' where id=$1", [
      first.data.id,
    ]),
    { code: "23514" },
  );
  await assert.rejects(
    pool().query("update public.expenses set amount_minor=1 where id=$1", [
      first.data.id,
    ]),
    { code: "23514" },
  );
  for (const kind of ["material", "maintenance", "other"]) {
    const general = await create({
      ...wage,
      kind,
      unit: "item",
      quantity: "0.333",
      rateBaht: "0.05",
      note: "รายจ่ายทั่วไป",
    });
    assert.equal(general.response.status, 201);
    assert.equal(general.data.amountMinor, 2);
    assert.equal(general.data.pendingMinor, 2);
  }
});
test("expense, initial payment, profile, receipt, audit and retry roll back together", async () => {
  const activeId = (await request("gardens")).data.gardens.find(
    (g: { archived: boolean }) => !g.archived,
  ).id;
  const pendingReceiptId = await uploadReceipt();
  const input = {
    gardenId: activeId,
    expenseDate: "2026-10-21",
    kind: "daily_labor",
    payee: "expense-rollback",
    unit: "day",
    quantity: "0.5",
    rateBaht: "500",
    paymentStatus: "full",
    paymentDate: "2026-10-21",
    pendingReceiptId,
  };
  const snapshot = async () =>
    (
      await pool().query(
        "select (select count(*) from public.expenses)::int expenses,(select count(*) from public.expense_payments)::int payments,(select count(*) from public.receipt_files)::int receipts,(select count(*) from public.audit_events)::int audit,(select count(*) from private.idempotency_requests)::int retries",
      )
    ).rows[0];
  const before = await snapshot();
  const key = randomUUID();
  await pool().query(
    "create function private.test_reject_expense_audit() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='expense.created' then raise exception 'fixture failure'; end if; return NEW; end $$; create trigger test_reject_expense_audit before insert on public.audit_events for each row execute function private.test_reject_expense_audit()",
  );
  try {
    assert.equal(
      (await request("expenses", "POST", input, { "Idempotency-Key": key }))
        .response.status,
      500,
    );
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      (
        await pool().query(
          "select count(*)::int n from public.labor_profiles where payee='expense-rollback'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await request("receipts/verify", "POST", { pendingReceiptId })).response
        .status,
      200,
    );
  } finally {
    await pool().query(
      "drop trigger test_reject_expense_audit on public.audit_events;drop function private.test_reject_expense_audit()",
    );
  }
  const recovered = await request("expenses", "POST", input, {
    "Idempotency-Key": key,
  });
  assert.equal(recovered.response.status, 201);
  assert.equal(recovered.data.pendingMinor, 0);
  const retried = await request("expenses", "POST", input, {
    "Idempotency-Key": key,
  });
  assert.equal(retried.data.id, recovered.data.id);
  const after = await snapshot();
  assert.equal(after.expenses, before.expenses + 1);
  assert.equal(after.payments, before.payments + 1);
  assert.equal(after.receipts, before.receipts + 1);
  assert.equal(after.audit, before.audit + 2);
  assert.equal(after.retries, before.retries + 1);
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
  await pool().query("notify pgrst,'reload schema'");
  const saleId = (await pool().query("select id from public.sales limit 1"))
    .rows[0].id;
  for (const table of [
    "sale_labor",
    "labor_profiles",
    "expenses",
    "expense_payments",
    "receipt_files",
  ]) {
    const endpoint = process.env.SUPABASE_URL + "/rest/v1/" + table;
    let read = await fetch(endpoint, { headers });
    for (let attempt = 0; attempt < 10 && read.status === 404; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      read = await fetch(endpoint, { headers });
    }
    assert.equal(read.status, 200);
    assert.ok((await read.json()).length > 0);
    const outsider = await fetch(endpoint, {
      headers: {
        ...headers,
        Authorization: "Bearer " + otherAuth.data.session!.access_token,
      },
    });
    assert.equal(outsider.status, 200);
    assert.deepEqual(await outsider.json(), []);
    const expenseId = (
      await pool().query("select id from public.expenses limit 1")
    ).rows[0].id;
    const payloads: Record<string, unknown> = {
      sale_labor: {
        owner_id: ownerId,
        mode: "daily",
        payee: "forbidden",
        rate_minor: 100,
        sale_id: saleId,
        basis_units: 2,
        amount_minor: 100,
      },
      labor_profiles: {
        owner_id: ownerId,
        mode: "daily",
        payee: "forbidden",
        rate_minor: 100,
      },
      expenses: {
        owner_id: ownerId,
        garden_id: gardenId,
        expense_date: "2026-10-21",
        kind: "other",
        payee: "forbidden",
        unit: "item",
        quantity_milli: 1000,
        rate_minor: 100,
        amount_minor: 100,
      },
      expense_payments: {
        owner_id: ownerId,
        expense_id: expenseId,
        payment_date: "2026-10-21",
        amount_minor: 1,
      },
      receipt_files: {
        owner_id: ownerId,
        expense_id: expenseId,
        storage_key: "forbidden",
        mime_type: "image/png",
        size_bytes: 1,
        sha256: "a".repeat(64),
      },
    };
    const insert = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payloads[table]),
    });
    assert.equal(insert.status, 403);
    const anonymous = await fetch(endpoint, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY! },
    });
    assert.ok(anonymous.status === 401 || anonymous.status === 403);
  }
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
