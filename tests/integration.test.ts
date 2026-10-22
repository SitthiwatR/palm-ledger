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
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { TestOffsite } from "./automatic-store";
import {
  runAutomaticBackup,
  automaticStatus,
  offsiteHealth,
  MAX_OFFSITE_BYTES,
} from "../src/server/recovery/automatic";
import { parseEnv } from "node:util";
import { databasePool } from "../src/server/db";
import { migrate } from "../scripts/migrate";
import {
  decryptArchive,
  encryptArchive,
  sha,
} from "../src/server/recovery/format";
import { restoreToEmptyEnvironment } from "../src/server/recovery/restore";
import { prototypeFixture } from "./prototype-fixture";
import { createArchive } from "../src/server/recovery/data";

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
    sharedUnallocatedMinor: 0,
    sharedUnallocatedPendingMinor: 0,
    openingDebtPendingMinor: 0,
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
        mode: "weight",
        payee: "rollback-fixture",
        quantity: "1000",
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
    sharedUnallocatedMinor: 0,
    sharedUnallocatedPendingMinor: 0,
    openingDebtPendingMinor: 0,
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
    kind: "weight_labor",
    payee: "expense-rollback",
    unit: "kg",
    quantity: "3500",
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
test("phase four team expenses share rates, preserve kg/tonne units, and never duplicate linked labor", async () => {
  const activeId = (await request("gardens")).data.gardens.find(
    (g: { archived: boolean }) => !g.archived,
  ).id;
  const before = (await request("summary")).data;
  const salesBefore = (
    await pool().query("select count(*)::int n from public.sales")
  ).rows[0].n;
  const input = {
    gardenId: activeId,
    expenseDate: "2026-10-21",
    kind: "weight_labor",
    unit: "kg",
    quantity: "3500",
    rateBaht: "1000",
    payee: "ทีมเฟสสี่",
    paymentStatus: "partial",
    paidBaht: "1000",
    paymentDate: "2026-10-21",
  };
  const create = (data: unknown, key = randomUUID()) =>
    request("expenses", "POST", data, { "Idempotency-Key": key });
  const key = randomUUID();
  const results = await Promise.all([create(input, key), create(input, key)]);
  assert.deepEqual(results.map((r) => r.response.status).sort(), [200, 201]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal(results[0].data.amountMinor, 350000);
  assert.equal(results[0].data.pendingMinor, 250000);
  assert.equal(
    (await create({ ...input, quantity: "3501" }, key)).response.status,
    409,
  );
  assert.equal((await create({ ...input, unit: "day" })).response.status, 422);
  const override = await create({
    ...input,
    quantity: "3250.125",
    rateBaht: "1200",
    rememberRate: false,
    paymentStatus: "unpaid",
    paidBaht: "0",
    paymentDate: undefined,
  });
  assert.equal(override.response.status, 201);
  assert.equal(override.data.amountMinor, 390015);
  const profile = (await request("sales/preferences")).data.profiles.find(
    (p: { payee: string }) => p.payee === input.payee,
  );
  assert.equal(profile.mode, "weight");
  assert.equal(profile.rateBaht, "1000.00");
  const after = (await request("summary")).data;
  assert.equal(after.netMinor, before.netMinor - 740015);
  assert.equal(after.expensePendingMinor, before.expensePendingMinor + 640015);
  assert.equal(after.laborPendingMinor, before.laborPendingMinor);
  assert.equal(
    (await pool().query("select count(*)::int n from public.sales")).rows[0].n,
    salesBefore,
  );
  const row = (await request("expenses")).data.expenses.find(
    (e: { id: string }) => e.id === override.data.id,
  );
  assert.equal(row.quantity, "3250.125");
  assert.equal(row.unit, "kg");
  assert.equal(row.rateBaht, "1200.00");
  await assert.rejects(
    pool().query(
      "update public.expenses set amount_minor=amount_minor*1000 where id=$1",
      [row.id],
    ),
    /check constraint/,
  );
  const pendingReceiptId = await uploadReceipt();
  const sale = {
    gardenId: activeId,
    saleDate: "2026-10-21",
    buyer: "phase4",
    invoiceNumber: "PHASE4-OVERRIDE",
    weightKg: "3500",
    priceBahtPerKg: "5",
    deductions: [],
    receivedFull: true,
    pendingReceiptId,
    labor: [
      {
        mode: "weight",
        payee: input.payee,
        quantity: "3250",
        rateBaht: "1200",
        rememberRate: false,
      },
    ],
  };
  const saleKey = randomUUID();
  const saved = await Promise.all([
    request("sales", "POST", sale, { "Idempotency-Key": saleKey }),
    request("sales", "POST", sale, { "Idempotency-Key": saleKey }),
  ]);
  assert.deepEqual(saved.map((r) => r.response.status).sort(), [200, 201]);
  assert.equal(saved[0].data.id, saved[1].data.id);
  assert.equal(saved[0].data.laborMinor, 390000);
  assert.equal(
    (await request("sales/preferences")).data.profiles.find(
      (p: { payee: string }) => p.payee === input.payee,
    ).rateBaht,
    "1000.00",
  );
  const detail = (await request("sales")).data.sales.find(
    (v: { id: string }) => v.id === saved[0].data.id,
  );
  assert.equal(detail.weightKg, "3500");
  assert.equal(detail.labor[0].quantity, "3250");
  assert.equal(detail.labor[0].amountMinor, 390000);
  const final = (await request("summary")).data;
  assert.equal(final.netMinor, after.netMinor + 1360000);
  assert.equal(final.laborPendingMinor, after.laborPendingMinor + 390000);
  assert.equal(final.expensePendingMinor, after.expensePendingMinor);
});
let debtGardenId = "";
const postOnce = (path: string, data: unknown, key = randomUUID()) =>
  request(path, "POST", data, { "Idempotency-Key": key });
const pay = (path: string, amountBaht: string, key = randomUUID()) =>
  postOnce(path + "/payments", { paymentDate: "2026-10-21", amountBaht }, key);
const payable = async (id: string) =>
  (await request("payables")).data.payables.find(
    (e: { id: string }) => e.id === id,
  );
async function newDebt(amountBaht = "10000") {
  const created = await postOnce("opening-debts", {
    gardenId: debtGardenId,
    debtDate: "2026-10-01",
    payee: "ร้านหนี้เดิม",
    amountBaht,
    note: "ก่อนเริ่มระบบ",
  });
  assert.equal(created.response.status, 200);
  return created.data.id as string;
}
test("phase five opening debts preserve a 5000 opening net and track 1000 outstanding independently", async () => {
  debtGardenId = (
    await postOnce("gardens", { name: "สวนหนี้ยกมา", openingMinor: 500000 })
  ).data.id;
  const before = (await request("summary")).data;
  const input = {
    gardenId: debtGardenId,
    debtDate: "2026-10-01",
    payee: "ร้านหนี้เดิม",
    amountBaht: "1000",
    note: "ก่อนใช้ระบบ",
  };
  const key = randomUUID();
  const pair = await Promise.all([
    postOnce("opening-debts", input, key),
    postOnce("opening-debts", input, key),
  ]);
  assert.equal(pair[0].data.id, pair[1].data.id);
  assert.equal(
    (await postOnce("opening-debts", { ...input, amountBaht: "1001" }, key))
      .response.status,
    409,
  );
  const garden = (await request("gardens/" + debtGardenId)).data;
  assert.equal(garden.netMinor, 500000);
  assert.equal(garden.openingDebtPendingMinor, 100000);
  const summary = (await request("summary")).data;
  assert.equal(summary.netMinor, before.netMinor);
  assert.equal(
    summary.openingDebtPendingMinor,
    before.openingDebtPendingMinor + 100000,
  );
  assert.equal((await payable(pair[0].data.id)).pendingMinor, 100000);
});
test("phase five later payments cover opening debts, daily/weight sale labor, and standalone team expenses without changing net", async () => {
  const debtId = await newDebt();
  const entries = (await request("payables")).data.payables;
  const chosen = [
    entries.find((e: any) => e.id === debtId),
    ...["daily", "weight"].map((mode) =>
      entries.find(
        (e: any) =>
          e.source === "sale-labor" && e.kind === mode && e.pendingMinor > 0,
      ),
    ),
    entries.find(
      (e: any) =>
        e.source === "expenses" &&
        e.kind === "weight_labor" &&
        e.pendingMinor > 0,
    ),
  ];
  const before = (await request("summary")).data;
  for (const e of chosen) {
    assert.ok(e);
    const path = e.source + "/" + e.id;
    const first =
      e.source === "opening-debts" ? 600000 : Math.floor(e.pendingMinor / 2);
    const key = randomUUID();
    const same = await Promise.all([
      pay(path, (first / 100).toFixed(2), key),
      pay(path, (first / 100).toFixed(2), key),
    ]);
    assert.equal(same[0].response.status, 200);
    assert.equal(same[0].data.id, same[1].data.id);
    assert.equal(same[0].data.pendingMinor, e.pendingMinor - first);
    assert.equal((await pay(path, "0.01", key)).response.status, 409);
    const second = await pay(path, ((e.pendingMinor - first) / 100).toFixed(2));
    assert.equal(second.data.pendingMinor, 0);
    const detail = await payable(e.id);
    assert.equal(detail.pendingMinor, 0);
    assert.equal(detail.paidMinor, e.amountMinor);
    assert.equal(detail.payments.length, e.payments.length + 2);
    assert.equal((await pay(path, "0.01")).response.status, 409);
    if (e.source === "sale-labor") {
      const sales = (await request("sales")).data.sales;
      const l = sales
        .flatMap((s: any) => s.labor)
        .find((l: any) => l.id === e.id);
      assert.equal(l.pendingMinor, 0);
    }
  }
  const after = (await request("summary")).data;
  assert.equal(after.netMinor, before.netMinor);
  assert.equal(
    after.laborPendingMinor,
    before.laborPendingMinor -
      chosen
        .filter((e: any) => e.source === "sale-labor")
        .reduce((sum: number, e: any) => sum + e.pendingMinor, 0),
  );
  assert.equal(
    after.expensePendingMinor,
    before.expensePendingMinor -
      chosen
        .filter((e: any) => e.source === "expenses")
        .reduce((sum: number, e: any) => sum + e.pendingMinor, 0),
  );
  assert.equal(
    after.openingDebtPendingMinor,
    before.openingDebtPendingMinor - 1000000,
  );
});
test("phase five void wrong 5000 then record 500 leaves 9500, retains history, and voids existing first payments", async () => {
  const id = await newDebt();
  const before = (await request("summary")).data.netMinor;
  const payment = await pay("opening-debts/" + id, "5000");
  assert.equal(payment.data.pendingMinor, 500000);
  const path = "payments/" + payment.data.id + "/void",
    input = { reason: "กรอกเกินหนึ่งหลัก" },
    key = randomUUID();
  const pair = await Promise.all([
    postOnce(path, input, key),
    postOnce(path, input, key),
  ]);
  assert.equal(pair[0].data.pendingMinor, 1000000);
  assert.deepEqual(pair[0].data, pair[1].data);
  assert.equal(
    (await postOnce(path, { reason: "อีกเหตุผล" }, key)).response.status,
    409,
  );
  const corrected = await pay("opening-debts/" + id, "500");
  assert.equal(corrected.data.pendingMinor, 950000);
  // Repeating a void with a different key cannot revive the original payment or add debt twice.
  assert.equal((await postOnce(path, input)).data.pendingMinor, 950000);
  const history = await payable(id);
  assert.equal(history.payments.length, 2);
  assert.equal(history.payments[0].amountMinor, 500000);
  assert.equal(history.payments[0].voidReason, input.reason);
  assert.ok(history.payments[0].voidedAt);
  assert.equal(history.payments[1].amountMinor, 50000);
  const auditRow = (
    await pool().query(
      "select count(*)::int n from public.audit_events where action='payment.voided' and entity_id=$1",
      [payment.data.id],
    )
  ).rows[0];
  assert.equal(auditRow.n, 1);
  // Existing Phase 3/4 first payment is the same original row, not a duplicate.
  const expense = (await request("payables")).data.payables.find(
    (e: any) =>
      e.source === "expenses" && e.payments.some((p: any) => !p.voidedAt),
  );
  const initial = expense.payments.find((p: any) => !p.voidedAt);
  assert.equal(
    (
      await postOnce("payments/" + initial.id + "/void", {
        reason: "ตรวจแก้การจ่ายครั้งแรก",
      })
    ).data.pendingMinor,
    expense.pendingMinor + initial.amountMinor,
  );
  const list = (await request("expenses")).data.expenses.find(
    (e: any) => e.id === expense.id,
  );
  assert.equal(list.pendingMinor, expense.pendingMinor + initial.amountMinor);
  assert.ok(list.payments.find((p: any) => p.id === initial.id).voidedAt);
  assert.equal((await request("summary")).data.netMinor, before);
});
test("phase five concurrent payments serialize for every source; competing payment and void keep correct totals", async () => {
  const entries = (await request("payables")).data.payables;
  const sources = [
    { source: "opening-debts", id: await newDebt(), pendingMinor: 1000000 },
    ...["sale-labor", "expenses"].map((source) =>
      entries.find((e: any) => e.source === source && e.pendingMinor > 100),
    ),
  ];
  for (const e of sources) {
    assert.ok(e);
    const path = e.source + "/" + e.id;
    const amount = Math.floor(e.pendingMinor * 0.6);
    const results = await Promise.all([
      pay(path, (amount / 100).toFixed(2)),
      pay(path, (amount / 100).toFixed(2)),
    ]);
    assert.deepEqual(results.map((r) => r.response.status).sort(), [200, 409]);
    const p = results.find((r) => r.response.status === 200)!;
    assert.equal((await payable(e.id)).pendingMinor, e.pendingMinor - amount);
    const concurrent = await Promise.all([
      postOnce("payments/" + p.data.id + "/void", { reason: "แก้บันทึก" }),
      pay(path, "0.01"),
    ]);
    assert.equal(concurrent[0].response.status, 200);
    assert.equal(concurrent[1].response.status, 200);
    assert.equal((await payable(e.id)).pendingMinor, e.pendingMinor - 1);
  }
  // SQL defense also rejects two direct writes racing outside the API service lock.
  const id = await newDebt();
  const insert = () =>
    pool().query(
      "insert into public.expense_payments(owner_id,opening_debt_id,payment_date,amount_minor) values($1,$2,'2026-10-21',600000)",
      [ownerId, id],
    );
  const direct = await Promise.allSettled([insert(), insert()]);
  assert.equal(direct.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await payable(id)).pendingMinor, 400000);
});
test("phase five opening, payment and void failures roll back audit and idempotency together and retry safely", async () => {
  const id = await newDebt();
  const original = await pay("opening-debts/" + id, "5000");
  for (const [path, input, action] of [
    [
      "opening-debts",
      {
        gardenId: debtGardenId,
        debtDate: "2026-10-01",
        payee: "rollback",
        amountBaht: "1000",
      },
      "opening_debt.created",
    ],
    [
      "opening-debts/" + id + "/payments",
      { paymentDate: "2026-10-21", amountBaht: "500" },
      "payment.created",
    ],
    [
      "payments/" + original.data.id + "/void",
      { reason: "rollback" },
      "payment.voided",
    ],
  ] as const) {
    const snapshot = async () =>
      (
        await pool().query(
          "select (select jsonb_agg(to_jsonb(p) order by id) from public.expense_payments p) payments,(select count(*) from public.opening_debts) debts,(select count(*) from private.idempotency_requests) retries,(select count(*) from public.audit_events) audit",
        )
      ).rows[0];
    const before = await snapshot(),
      key = randomUUID();
    await pool().query(
      `create function private.test_phase5_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='${action}' then raise exception 'fixture failure'; end if; return NEW; end $$; create trigger test_phase5_failure before insert on public.audit_events for each row execute function private.test_phase5_failure()`,
    );
    try {
      assert.equal((await postOnce(path, input, key)).response.status, 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await pool().query(
        "drop trigger test_phase5_failure on public.audit_events;drop function private.test_phase5_failure()",
      );
    }
    const retry = await postOnce(path, input, key);
    assert.equal(retry.response.status, 200);
    assert.deepEqual((await postOnce(path, input, key)).data, retry.data);
  }
});
test("phase five validates amounts, dates, void reasons and ownership without mutation; DB protects original history", async () => {
  const id = await newDebt();
  const before = await payable(id);
  for (const amount of ["0", "-1", "NaN", "1.001", "90000000000.01"])
    assert.equal(
      (await pay("opening-debts/" + id, amount)).response.status,
      422,
    );
  assert.equal(
    (
      await postOnce("opening-debts/" + id + "/payments", {
        paymentDate: "2026-02-30",
        amountBaht: "1",
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await postOnce("opening-debts", {
        gardenId: randomUUID(),
        debtDate: "2026-10-01",
        payee: "missing",
        amountBaht: "1",
      })
    ).response.status,
    404,
  );
  assert.equal(
    (await pay("sale-labor/" + randomUUID(), "1")).response.status,
    404,
  );
  assert.equal(
    (
      await postOnce("payments/" + randomUUID() + "/void", {
        reason: "missing",
      })
    ).response.status,
    404,
  );
  assert.equal(
    (await request("payables", "GET", undefined, { Cookie: "" })).response
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "opening-debts/" + id + "/payments",
        "POST",
        { paymentDate: "2026-10-21", amountBaht: "1" },
        { Cookie: "", "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    401,
  );
  assert.equal(
    (
      await request(
        "opening-debts/" + id + "/payments",
        "POST",
        { paymentDate: "2026-10-21", amountBaht: "1" },
        { Origin: "https://outsider.invalid", "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    403,
  );
  assert.deepEqual(await payable(id), before);
  const payment = await pay("opening-debts/" + id, "1");
  assert.equal(
    (await postOnce("payments/" + payment.data.id + "/void", { reason: " " }))
      .response.status,
    422,
  );
  await assert.rejects(
    pool().query(
      "update public.expense_payments set amount_minor=99 where id=$1",
      [payment.data.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool().query("delete from public.expense_payments where id=$1", [
      payment.data.id,
    ]),
    { code: "23514" },
  );
});

let sharedId = "",
  allocationGardens: string[] = [];
const allocate = (
  id: string,
  amounts: string[],
  version: number,
  key = randomUUID(),
) =>
  request(
    `expenses/${id}/allocations`,
    "PUT",
    {
      expectedVersion: version,
      allocations: amounts.map((amountBaht, i) => ({
        gardenId: allocationGardens[i],
        amountBaht,
      })),
    },
    { "Idempotency-Key": key },
  );
async function sharedExpense(
  rateBaht = "1000",
  paidBaht = "0",
  receipt = false,
) {
  const input = {
    gardenId: null,
    expenseDate: "2026-10-21",
    kind: "maintenance",
    payee: "ร้านส่วนกลาง",
    unit: "item",
    quantity: "1",
    rateBaht,
    paymentStatus: paidBaht === "0" ? "unpaid" : "partial",
    ...(paidBaht !== "0" ? { paidBaht, paymentDate: "2026-10-21" } : {}),
    ...(receipt ? { pendingReceiptId: await uploadReceipt() } : {}),
    note: "ร่วมหลายสวน",
  };
  const result = await postOnce("expenses", input);
  assert.equal(result.response.status, 201);
  return result.data.id as string;
}
test("phase six shared source costs count once before allocation and 400/600 shares conserve 333.33 paid, receipts and history", async () => {
  const third = await postOnce("gardens", {
    name: "สวนส่วนกลาง C",
    openingMinor: 0,
  });
  assert.equal(third.response.status, 201);
  allocationGardens = (await request("gardens")).data.gardens
    .filter((g: any) => !g.archived)
    .map((g: any) => g.id)
    .sort();
  assert.equal(allocationGardens.length, 3);
  const before = (await request("gardens")).data;
  sharedId = await sharedExpense("1000", "333.33", true);
  const source = await payable(sharedId),
    summary = (await request("summary")).data;
  assert.equal(source.gardenId, null);
  assert.equal(source.gardenName, "ส่วนกลาง");
  assert.equal(source.pendingMinor, 66667);
  assert.equal(source.payments.length, 1);
  assert.equal(summary.netMinor, before.summary.netMinor - 100000);
  assert.equal(
    summary.expensePendingMinor,
    before.summary.expensePendingMinor + 66667,
  );
  assert.equal(summary.sharedUnallocatedMinor, 100000);
  assert.equal(summary.sharedUnallocatedPendingMinor, 66667);
  assert.deepEqual((await request("gardens")).data.gardens, before.gardens);
  const detail = (await request("expenses")).data.expenses.find(
    (e: any) => e.id === sharedId,
  );
  assert.ok(detail.receiptId);
  assert.equal(
    (await request("receipts/" + detail.receiptId)).response.status,
    200,
  );
  const assigned = await allocate(sharedId, ["400", "600"], 1);
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.data.allocationVersion, 2);
  assert.deepEqual(
    assigned.data.allocations.map((a: any) => [
      a.amountMinor,
      a.paidMinor,
      a.pendingMinor,
    ]),
    [
      [40000, 13333, 26667],
      [60000, 20000, 40000],
    ],
  );
  const after = (await request("gardens")).data;
  assert.equal(after.summary.netMinor, summary.netMinor);
  assert.equal(after.summary.expensePendingMinor, summary.expensePendingMinor);
  assert.equal(after.summary.sharedUnallocatedMinor, 0);
  assert.equal(after.summary.sharedUnallocatedPendingMinor, 0);
  for (let i = 0; i < 2; i++) {
    const prev = before.gardens.find((g: any) => g.id === allocationGardens[i]);
    const current = after.gardens.find(
      (g: any) => g.id === allocationGardens[i],
    );
    assert.equal(current.netMinor, prev.netMinor - [40000, 60000][i]);
    assert.equal(
      current.expensePendingMinor,
      prev.expensePendingMinor + [26667, 40000][i],
    );
    assert.deepEqual((await request("gardens/" + current.id)).data, current);
  }
  assert.deepEqual((await payable(sharedId)).payments, source.payments);
  const listed = (await request("expenses")).data.expenses.find(
    (e: any) => e.id === sharedId,
  );
  assert.equal(listed.receiptId, detail.receiptId);
  assert.equal(listed.gardenId, null);
  assert.equal(listed.allocations.length, 2);
});
test("phase six later payments and voids derive garden shares; replacing or clearing allocations never changes global net or payment IDs", async () => {
  const initial = await payable(sharedId),
    before = (await request("summary")).data;
  const payment = await pay("expenses/" + sharedId, "100");
  assert.equal(payment.response.status, 200);
  assert.equal((await payable(sharedId)).paidMinor, 43333);
  const key = randomUUID();
  const pair = await Promise.all([
    allocate(sharedId, ["250", "750"], 2, key),
    allocate(sharedId, ["250", "750"], 2, key),
  ]);
  assert.deepEqual(pair[0].data, pair[1].data);
  assert.equal(pair[0].data.allocationVersion, 3);
  assert.deepEqual(
    pair[0].data.allocations.map((a: any) => a.paidMinor),
    [10833, 32500],
  );
  assert.equal(
    (await allocate(sharedId, ["300", "700"], 2)).response.status,
    409,
  );
  assert.equal(
    (await allocate(sharedId, ["300", "700"], 2, key)).response.status,
    409,
  );
  const source = await payable(sharedId);
  assert.equal(source.payments.length, 2);
  assert.equal(source.payments[0].id, initial.payments[0].id);
  await postOnce("payments/" + payment.data.id + "/void", {
    reason: "แก้จ่ายส่วนกลาง",
  });
  const voided = await payable(sharedId);
  assert.deepEqual(
    voided.allocations.map((a: any) => a.paidMinor),
    [8333, 25000],
  );
  assert.equal(voided.pendingMinor, 66667);
  assert.equal(voided.payments.length, 2);
  assert.ok(voided.payments[1].voidedAt);
  const clear = await allocate(sharedId, [], 3);
  assert.equal(clear.response.status, 200);
  assert.equal(clear.data.allocationVersion, 4);
  assert.deepEqual(clear.data.allocations, []);
  const after = (await request("summary")).data;
  assert.equal(after.netMinor, before.netMinor);
  assert.equal(after.expensePendingMinor, before.expensePendingMinor);
  assert.equal(after.sharedUnallocatedMinor, 100000);
  assert.deepEqual((await payable(sharedId)).payments, voided.payments);
  const patchGarden = await request("gardens/" + allocationGardens[0]);
  const patched = await request(
    "gardens/" + allocationGardens[0],
    "PATCH",
    { name: patchGarden.data.name, expectedVersion: patchGarden.data.version },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(patched.data.netMinor, patchGarden.data.netMinor);
  assert.equal(
    patched.data.expensePendingMinor,
    patchGarden.data.expensePendingMinor,
  );
});
test("phase six three one-cent shares keep every derived payment nonnegative, bounded and summing to source after later payments and void", async () => {
  const id = await sharedExpense("0.03", "0.01");
  assert.equal(
    (await allocate(id, ["0.01", "0.01", "0.01"], 1)).response.status,
    200,
  );
  const check = async (paid: number, expected: number[]) => {
    const e = await payable(id);
    assert.equal(e.paidMinor, paid);
    assert.deepEqual(
      e.allocations.map((a: any) => a.paidMinor),
      expected,
    );
    assert.equal(
      e.allocations.reduce((s: number, a: any) => s + a.paidMinor, 0),
      paid,
    );
    assert.equal(
      e.allocations.reduce((s: number, a: any) => s + a.pendingMinor, 0),
      3 - paid,
    );
    for (const a of e.allocations) {
      assert.ok(a.paidMinor >= 0 && a.paidMinor <= a.amountMinor);
      assert.ok(a.pendingMinor >= 0);
    }
  };
  await check(1, [0, 1, 0]);
  const second = await pay("expenses/" + id, "0.01");
  await check(2, [1, 0, 1]);
  await pay("expenses/" + id, "0.01");
  await check(3, [1, 1, 1]);
  await postOnce("payments/" + second.data.id + "/void", {
    reason: "แก้หนึ่งสตางค์",
  });
  await check(2, [1, 0, 1]);
  const after = await payable(id);
  assert.equal(after.payments.length, 3);
  assert.equal(after.allocations.length, 3);
});
test("phase six rejects incomplete, excess, duplicate, non-shared or unauthorized allocation sets; deferred DB constraints prevent partial commits", async () => {
  const id = await sharedExpense(),
    before = await payable(id);
  for (const parts of [
    ["400", "500"],
    ["400", "601"],
    ["0", "1000"],
    ["NaN", "1000"],
  ])
    assert.equal((await allocate(id, parts, 1)).response.status, 422);
  const payload = {
    expectedVersion: 1,
    allocations: [
      { gardenId: allocationGardens[0], amountBaht: "400" },
      { gardenId: allocationGardens[0], amountBaht: "600" },
    ],
  };
  assert.equal(
    (
      await request(`expenses/${id}/allocations`, "PUT", payload, {
        "Idempotency-Key": randomUUID(),
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await request(
        `expenses/${id}/allocations`,
        "PUT",
        {
          expectedVersion: 1,
          allocations: [{ gardenId: randomUUID(), amountBaht: "1000" }],
        },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    404,
  );
  const direct = (await request("payables")).data.payables.find(
    (e: any) => e.source === "expenses" && e.gardenId,
  );
  assert.equal(
    (await allocate(direct.id, [String(direct.amountMinor / 100)], 1)).response
      .status,
    422,
  );
  assert.equal(
    (await allocate(randomUUID(), ["1000"], 1)).response.status,
    404,
  );
  assert.equal(
    (
      await request(`expenses/${id}/allocations`, "PUT", payload, {
        Cookie: "",
        "Idempotency-Key": randomUUID(),
      })
    ).response.status,
    401,
  );
  assert.equal(
    (
      await request(`expenses/${id}/allocations`, "PUT", payload, {
        Origin: "https://other.invalid",
        "Idempotency-Key": randomUUID(),
      })
    ).response.status,
    403,
  );
  assert.deepEqual(await payable(id), before);
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into public.expense_allocations(expense_id,owner_id,garden_id,amount_minor) values($1,$2,$3,40000)",
      [id, ownerId, allocationGardens[0]],
    );
    await assert.rejects(client.query("commit"), { code: "23514" });
    await client.query("rollback");
    assert.deepEqual((await payable(id)).allocations, []);
    await assert.rejects(
      client.query(
        "insert into public.expense_allocations(expense_id,owner_id,garden_id,amount_minor) values($1,$2,$3,100001)",
        [id, ownerId, allocationGardens[0]],
      ),
      { code: "23514" },
    );
    await allocate(id, ["400", "600"], 1);
    await assert.rejects(
      client.query(
        "delete from public.expense_allocations where expense_id=$1 and garden_id=$2",
        [id, allocationGardens[0]],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      client.query("update public.expenses set garden_id=$2 where id=$1", [
        id,
        allocationGardens[0],
      ]),
      { code: "23514" },
    );
    assert.equal((await payable(id)).allocations.length, 2);
  } finally {
    await client.query("rollback");
    client.release();
  }
});
test("phase six allocation audit failure rolls back replaced rows, version and idempotency, then retries exactly once", async () => {
  const id = await sharedExpense();
  await allocate(id, ["400", "600"], 1);
  const snapshot = async () =>
    (
      await pool().query(
        "select (select jsonb_agg(to_jsonb(a) order by expense_id,garden_id) from public.expense_allocations a) allocations,(select jsonb_agg(to_jsonb(e) order by id) from public.expenses e) expenses,(select count(*) from public.audit_events) audit,(select count(*) from private.idempotency_requests) retries,(select count(*) from public.expense_payments) payments",
      )
    ).rows[0];
  const before = await snapshot(),
    key = randomUUID();
  await pool().query(
    "create function private.test_allocation_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='expense.allocations.replaced' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_allocation_failure before insert on public.audit_events for each row execute function private.test_allocation_failure()",
  );
  try {
    assert.equal(
      (await allocate(id, ["100", "900"], 2, key)).response.status,
      500,
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await pool().query(
      "drop trigger test_allocation_failure on public.audit_events;drop function private.test_allocation_failure()",
    );
  }
  const retry = await allocate(id, ["100", "900"], 2, key);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.allocationVersion, 3);
  assert.deepEqual(
    (await allocate(id, ["100", "900"], 2, key)).data,
    retry.data,
  );
  const after = await snapshot();
  assert.equal(Number(after.audit), Number(before.audit) + 1);
  assert.equal(Number(after.retries), Number(before.retries) + 1);
  assert.equal(after.payments, before.payments);
});
test("phase six concurrent replacement and payment preserve total; two stale editors allow one replacement only", async () => {
  const id = await sharedExpense(),
    net = (await request("summary")).data.netMinor;
  const together = await Promise.all([
    allocate(id, ["400", "600"], 1),
    pay("expenses/" + id, "333.33"),
  ]);
  assert.deepEqual(
    together.map((r) => r.response.status),
    [200, 200],
  );
  const source = await payable(id);
  assert.equal(source.payments.length, 1);
  assert.equal(source.pendingMinor, 66667);
  assert.deepEqual(
    source.allocations.map((a: any) => a.paidMinor),
    [13333, 20000],
  );
  const competing = await Promise.all([
    allocate(id, ["300", "700"], 2),
    allocate(id, ["200", "800"], 2),
  ]);
  assert.deepEqual(competing.map((r) => r.response.status).sort(), [200, 409]);
  const after = await payable(id);
  assert.equal(after.allocationVersion, 3);
  assert.equal(after.payments.length, 1);
  assert.equal(after.paidMinor, 33333);
  assert.equal(
    after.allocations.reduce((s: number, a: any) => s + a.paidMinor, 0),
    33333,
  );
  assert.equal((await request("summary")).data.netMinor, net);
});

// Phase 7 fixtures are inserted only after support.ts verifies the local test DB.
async function phase7Garden(name: string, openingMinor = 0) {
  const r = await request(
    "gardens",
    "POST",
    { name, openingMinor },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(r.response.status, 201);
  return r.data.id as string;
}
async function phase7Expense(
  garden: string | null,
  amountBaht = "10000",
  payee = "phase7-party",
  receipt = false,
) {
  const r = await request(
    "expenses",
    "POST",
    {
      gardenId: garden,
      expenseDate: "2026-09-10",
      kind: "other",
      payee,
      note: "phase7",
      unit: "item",
      quantity: "1",
      rateBaht: amountBaht,
      paymentStatus: "unpaid",
      rememberRate: false,
      ...(receipt ? { pendingReceiptId: await uploadReceipt() } : {}),
    },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(r.response.status, 201, JSON.stringify(r.data));
  return r.data.id as string;
}
const phase7Edit = (garden: string | null, version = 1, rate = "10000") => ({
  gardenId: garden,
  date: "2026-09-10",
  kind: "other",
  payee: "แก้ชื่อ",
  note: "เก็บประวัติ",
  unit: "item",
  quantity: "1",
  rateBaht: rate,
  expectedVersion: version,
  reason: "ตรวจบิลใหม่",
});
const write7 = (
  path: string,
  data: unknown,
  method = "PATCH",
  key = randomUUID(),
) => request("entries/" + path, method, data, { "Idempotency-Key": key });

test("phase seven report garden totals, current pending, dates, filters, pagination and safe Thai CSV agree", async () => {
  const a = await phase7Garden("phase7-report-A", 500000),
    b = await phase7Garden("phase7-report-B");
  const ids: string[] = [];
  for (const [g, income, cost] of [
    [a, 4800000, 2000000],
    [b, 3000000, 1520000],
  ] as const) {
    const sale = (
      await pool().query(
        "insert into public.sales(owner_id,garden_id,sale_date,buyer,invoice_number,net_weight_grams,price_minor_per_kg,gross_minor,deductions_minor,net_minor) values($1,$2,'2026-08-10','รายงานไทย','=SUM(1,2)',1000,$3::integer,($3::integer)::bigint,0,($3::integer)::bigint) returning id",
        [ownerId, g, income],
      )
    ).rows[0];
    ids.push(sale.id);
    const e = await phase7Expense(
      g,
      String(cost / 100),
      g === a ? ' =1+2,"ไทย"\nใหม่' : "report-B",
    );
    ids.push(e);
    await request(
      `expenses/${e}/payments`,
      "POST",
      { paymentDate: "2026-10-01", amountBaht: "100" },
      { "Idempotency-Key": randomUUID() },
    );
  }
  const ar = (
    await request(`entries?gardenId=${a}&from=2026-08-01&to=2026-09-30`)
  ).data;
  assert.equal(ar.report.movementMinor, 2800000);
  assert.equal(ar.report.netMinor, 2800000);
  assert.equal(ar.report.openingMinor, 500000);
  assert.equal(ar.report.includesOpening, false);
  assert.equal(ar.report.pendingAsOf, "current");
  assert.equal(ar.report.pendingMinor, 1990000);
  const br = (
    await request(`entries?gardenId=${b}&from=2026-08-01&to=2026-09-30`)
  ).data;
  assert.equal(br.report.movementMinor, 1480000);
  assert.equal(ar.report.movementMinor + br.report.movementMinor, 4280000);
  const all = (await request(`entries?gardenId=${a}&pageSize=1&page=2`)).data;
  assert.equal(all.total, 2);
  assert.equal(all.entries.length, 1);
  assert.equal(all.report.netMinor, 3300000);
  assert.equal(all.report.gardens[0].net_minor, 3300000);
  const pending = (await request(`entries?gardenId=${a}&paymentStatus=pending`))
    .data;
  assert.equal(pending.total, 1);
  assert.equal(pending.report.pendingMinor, 1990000);
  assert.equal(pending.report.includesOpening, false);
  const fullCsv = await fetch(
    origin + `/api/v1/entries/export?gardenId=${a}&pageSize=1&page=2`,
    { headers: { Cookie: cookie } },
  );
  const fullText = await fullCsv.text();
  assert.ok(fullText.includes(ids[0]));
  assert.ok(fullText.includes(ids[1]));

  const filter = `gardenId=${a}&from=2026-09-01&to=2026-09-30&source=expenses&kind=other&q=${encodeURIComponent("ไทย")}`;
  const listed = await request("entries?" + filter);
  assert.equal(listed.response.status, 200, JSON.stringify(listed.data));
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.report.expenseMinor, 2000000);
  const csv = await fetch(origin + "/api/v1/entries/export?" + filter, {
    headers: { Cookie: cookie },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type")!, /text\/csv/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  const text = bytes.toString("utf8");
  assert.ok(text.includes('"\'=1+2,""ไทย""\nใหม่"'));
  assert.ok(text.includes('"20000.00"'));
  assert.ok(text.includes(listed.data.entries[0].id));
  assert.ok(!text.includes("report-B"));
  assert.equal(
    (await request("entries?from=2026-10-22&to=2026-10-01")).response.status,
    422,
  );
  assert.equal((await request("entries?gardenId=bad")).response.status, 422);
  const unauth = await fetch(origin + "/api/v1/entries/export");
  assert.equal(unauth.status, 401);
});

test("phase seven source edit is versioned, idempotent, paid-floor protected and preserves receipt/rate/payment IDs", async () => {
  const g = await phase7Garden("phase7-edit"),
    id = await phase7Expense(g, "10000", "original", true);
  const original = (await request(`entries/expenses/${id}`)).data;
  const payment = await request(
    `expenses/${id}/payments`,
    "POST",
    { paymentDate: "2026-09-11", amountBaht: "6000" },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(payment.response.status, 200);
  const low = await write7(`expenses/${id}`, phase7Edit(g, 1, "5000"));
  assert.equal(low.response.status, 422);
  assert.equal(low.data.error.code, "AMOUNT_BELOW_PAID");
  await assert.rejects(
    pool().query(
      "update public.expenses set amount_minor=500000,rate_minor=500000 where id=$1",
      [id],
    ),
    /below effective payments/,
  );
  const key = randomUUID(),
    body = phase7Edit(g, 1, "11000");
  const both = await Promise.all([
    write7(`expenses/${id}`, body, "PATCH", key),
    write7(`expenses/${id}`, body, "PATCH", key),
  ]);
  assert.ok(both.every((r) => r.response.status === 200));
  assert.equal(both[0].data.version, 2);
  assert.equal(
    (await write7(`expenses/${id}`, body)).data.error.code,
    "STALE_VERSION",
  );
  assert.equal(
    (await write7(`expenses/${id}`, { ...body, reason: "other" }, "PATCH", key))
      .response.status,
    409,
  );
  const fresh = (await request(`entries/expenses/${id}`)).data;
  assert.equal(fresh.paidMinor, 600000);
  assert.equal(fresh.pendingMinor, 500000);
  assert.equal(fresh.payments[0].id, payment.data.id);
  assert.deepEqual(fresh.receipts, original.receipts);
  assert.equal(
    fresh.audit.filter((r: any) => r.action === "entry.edited").length,
    1,
  );
  const race = await Promise.all([
    write7(`expenses/${id}`, phase7Edit(g, 2, "12000")),
    write7(`expenses/${id}`, phase7Edit(g, 2, "13000")),
  ]);
  assert.deepEqual(race.map((r) => r.response.status).sort(), [200, 409]);
  const forbidden = await write7(`expenses/${id}`, phase7Edit(g, 3), "PATCH");
  assert.equal(forbidden.response.status, 200);
  const badOrigin = await request(
    `entries/expenses/${id}`,
    "PATCH",
    phase7Edit(g, 4),
    { Origin: "https://evil.invalid", "Idempotency-Key": randomUUID() },
  );
  assert.equal(badOrigin.response.status, 403);
  assert.equal(
    (await request(`entries/expenses/${randomUUID()}`)).response.status,
    404,
  );
  const duplicateGarden = await phase7Garden("phase7-duplicate-edit");
  const saleIds: string[] = [];
  for (const invoice of ["first", "second"])
    saleIds.push(
      (
        await pool().query(
          "insert into public.sales(owner_id,garden_id,sale_date,buyer,invoice_number,net_weight_grams,price_minor_per_kg,gross_minor,deductions_minor,net_minor) values($1,$2,'2026-09-01','ผู้ซื้อ',$3,1000,100,100,0,100) returning id",
          [ownerId, duplicateGarden, invoice],
        )
      ).rows[0].id,
    );
  const saleEdit = {
    gardenId: duplicateGarden,
    date: "2026-09-01",
    payee: "ผู้ซื้อ",
    invoiceNumber: "second",
    weightKg: "1",
    priceBahtPerKg: "1",
    deductions: [],
    receivedFull: true,
    expectedVersion: 1,
    reason: "ตรวจเลขซ้ำ",
  };
  assert.equal(
    (await write7(`sales/${saleIds[0]}`, saleEdit)).data.error.code,
    "DUPLICATE_BILL",
  );
  assert.equal(
    (
      await write7(`sales/${saleIds[0]}`, {
        ...saleEdit,
        confirmDuplicate: true,
      })
    ).response.status,
    200,
  );
});

test("phase seven sales require linked labor review, keep independent labor attribution and support separate labor corrections", async () => {
  const a = await phase7Garden("phase7-sale-A"),
    b = await phase7Garden("phase7-sale-B");
  const sale = (
    await request(
      "sales",
      "POST",
      {
        gardenId: a,
        saleDate: "2026-09-01",
        buyer: "linked-sale",
        invoiceNumber: randomUUID(),
        weightKg: "1000",
        priceBahtPerKg: "10",
        deductions: [],
        labor: [
          {
            mode: "weight",
            payee: "ทีมเก็บ",
            quantity: "900",
            rateBaht: "800",
            rememberRate: true,
          },
        ],
        pendingReceiptId: await uploadReceipt(),
        receivedFull: true,
      },
      { "Idempotency-Key": randomUUID() },
    )
  ).data;
  const detail = (await request(`entries/sales/${sale.id}`)).data;
  assert.equal(detail.labor.length, 1);
  const l = detail.labor[0],
    profile = (
      await pool().query(
        "select * from public.labor_profiles where owner_id=$1 and payee='ทีมเก็บ'",
        [ownerId],
      )
    ).rows;
  await request(
    `sale-labor/${l.id}/payments`,
    "POST",
    { paymentDate: "2026-09-02", amountBaht: "100" },
    { "Idempotency-Key": randomUUID() },
  );
  const edit = {
    gardenId: b,
    date: "2026-09-03",
    payee: "linked-edited",
    note: "ไม่ย้ายค่าแรง",
    invoiceNumber: detail.record.invoice_number,
    weightKg: "1100",
    priceBahtPerKg: "10",
    deductions: [{ description: "หัก", amountBaht: "10" }],
    receivedFull: true,
    expectedVersion: 1,
    reason: "แก้บิล",
  };
  assert.equal(
    (await write7(`sales/${sale.id}`, edit)).data.error.code,
    "LABOR_REVIEW_REQUIRED",
  );
  const reviewed = {
    ...edit,
    acknowledgeLabor: true,
    laborVersions: [{ id: l.id, version: 1 }],
  };
  assert.equal(
    (await write7(`sales/${sale.id}`, reviewed)).response.status,
    200,
  );
  let labor = (await request(`entries/sale-labor/${l.id}`)).data;
  assert.equal(labor.record.garden_id, a);
  assert.equal(labor.record.date, "2026-09-01");
  assert.equal(Number(labor.record.amount_minor), 72000);
  assert.equal(labor.paidMinor, 10000);
  const summary = (await request("gardens")).data.gardens;
  assert.equal(summary.find((g: any) => g.id === a).netMinor, -72000);
  assert.equal(summary.find((g: any) => g.id === b).netMinor, 1099000);
  const laborEdit = {
    gardenId: a,
    date: "2026-09-04",
    mode: "weight",
    payee: "ทีมเก็บ",
    quantity: "950",
    rateBaht: "800",
    note: "ฐานค่าแรงแยก",
    expectedVersion: 1,
    reason: "แก้ฐานทีม",
  };
  assert.equal(
    (await write7(`sale-labor/${l.id}`, laborEdit)).response.status,
    200,
  );
  assert.deepEqual(
    (
      await pool().query(
        "select * from public.labor_profiles where owner_id=$1 and payee='ทีมเก็บ'",
        [ownerId],
      )
    ).rows,
    profile,
  );
  const voidBody = {
    expectedVersion: 2,
    reason: "บิลยกเลิก",
    acknowledgeLabor: true,
    laborVersions: [{ id: l.id, version: 1 }],
  };
  assert.equal(
    (await write7(`sales/${sale.id}/void`, voidBody, "POST")).data.error.code,
    "LABOR_REVIEW_REQUIRED",
  );
  assert.equal(
    (
      await write7(
        `sales/${sale.id}/void`,
        { ...voidBody, laborVersions: [{ id: l.id, version: 2 }] },
        "POST",
      )
    ).response.status,
    200,
  );
  labor = (await request(`entries/sale-labor/${l.id}`)).data;
  assert.equal(labor.record.voided_at, null);
  assert.equal(labor.paidMinor, 10000);
  assert.equal(labor.pendingMinor, 66000);
  const after = (await request("gardens")).data.gardens;
  assert.equal(after.find((g: any) => g.id === a).netMinor, -76000);
  assert.equal(after.find((g: any) => g.id === b).netMinor, 0);
  assert.equal(
    (
      await write7(
        `sale-labor/${l.id}/void`,
        {
          expectedVersion: 2,
          reason: "ยกเลิกทีมแยก",
          acknowledgePayments: true,
          activePaymentIds: labor.payments
            .filter((p: any) => !p.voided_at)
            .map((p: any) => p.id),
        },
        "POST",
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await request("gardens")).data.gardens.find((g: any) => g.id === a)
      .netMinor,
    0,
  );
});

test("phase seven allocated source edits require complete replacement and invalidate stale allocation editors", async () => {
  const a = await phase7Garden("phase7-alloc-A"),
    b = await phase7Garden("phase7-alloc-B"),
    id = await phase7Expense(null, "1000");
  await request(
    `expenses/${id}/allocations`,
    "PUT",
    {
      expectedVersion: 1,
      allocations: [
        { gardenId: a, amountBaht: "400" },
        { gardenId: b, amountBaht: "600" },
      ],
    },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(
    (await write7(`expenses/${id}`, phase7Edit(null, 1, "1200"))).data.error
      .code,
    "STALE_VERSION",
  );
  assert.equal(
    (await write7(`expenses/${id}`, phase7Edit(null, 2, "1200"))).data.error
      .code,
    "ALLOCATION_REVIEW_REQUIRED",
  );
  const input = {
    ...phase7Edit(null, 2, "1200"),
    allocations: [
      { gardenId: a, amountBaht: "500" },
      { gardenId: b, amountBaht: "700" },
    ],
  };
  assert.equal((await write7(`expenses/${id}`, input)).response.status, 200);
  assert.equal(
    (
      await request(
        `expenses/${id}/allocations`,
        "PUT",
        { expectedVersion: 2, allocations: [] },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    409,
  );
  const aa = (
    await request(
      `entries?gardenId=${a}&source=expenses&q=${encodeURIComponent("แก้ชื่อ")}`,
    )
  ).data;
  assert.equal(aa.report.expenseMinor, 50000);
  assert.equal(Number(aa.entries[0].amount_minor), 120000);
  assert.equal(Number(aa.entries[0].selected_amount_minor), 50000);
  const d = (await request(`entries/expenses/${id}`)).data;
  assert.equal(
    (
      await write7(`expenses/${id}`, {
        ...phase7Edit(a, d.record.version, "1200"),
        allocations: [],
      })
    ).response.status,
    200,
  );
  const next = (await request(`entries/expenses/${id}`)).data;
  assert.equal(next.allocations.length, 0);
  assert.equal(next.record.garden_id, a);
});

test("phase seven edit audit failure restores source and complete allocations before an identical retry", async () => {
  const a = await phase7Garden("phase7-edit-rollback-A"),
    b = await phase7Garden("phase7-edit-rollback-B"),
    id = await phase7Expense(null, "1000");
  await request(
    `expenses/${id}/allocations`,
    "PUT",
    {
      expectedVersion: 1,
      allocations: [
        { gardenId: a, amountBaht: "400" },
        { gardenId: b, amountBaht: "600" },
      ],
    },
    { "Idempotency-Key": randomUUID() },
  );
  const before = (await request(`entries/expenses/${id}`)).data,
    key = randomUUID(),
    input = {
      ...phase7Edit(null, 2, "1200"),
      allocations: [
        { gardenId: a, amountBaht: "500" },
        { gardenId: b, amountBaht: "700" },
      ],
    };
  await pool().query(
    "create function private.test_edit7_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='entry.edited' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_edit7_failure before insert on public.audit_events for each row execute function private.test_edit7_failure()",
  );
  try {
    assert.equal(
      (await write7(`expenses/${id}`, input, "PATCH", key)).response.status,
      500,
    );
  } finally {
    await pool().query(
      "drop trigger test_edit7_failure on public.audit_events;drop function private.test_edit7_failure()",
    );
  }
  const rolled = (await request(`entries/expenses/${id}`)).data;
  assert.deepEqual(rolled.record, before.record);
  assert.deepEqual(rolled.allocations, before.allocations);
  assert.equal(rolled.audit.length, before.audit.length);
  assert.equal(
    (
      await pool().query(
        "select count(*) n from private.idempotency_requests where key=$1",
        [key],
      )
    ).rows[0].n,
    "0",
  );
  assert.equal(
    (await write7(`expenses/${id}`, input, "PATCH", key)).response.status,
    200,
  );
  assert.equal(
    (await write7(`expenses/${id}`, input, "PATCH", key)).response.status,
    200,
  );
  assert.equal(
    (await request(`entries/expenses/${id}`)).data.audit.filter(
      (a: any) => a.action === "entry.edited",
    ).length,
    1,
  );
});

test("phase seven void rolls back source, all payments, allocation history, audit and key together then retries safely", async () => {
  const g = await phase7Garden("phase7-void"),
    id = await phase7Expense(null, "10000", "void-with-history", true);
  await request(
    `expenses/${id}/allocations`,
    "PUT",
    { expectedVersion: 1, allocations: [{ gardenId: g, amountBaht: "10000" }] },
    { "Idempotency-Key": randomUUID() },
  );
  const p1 = await request(
    `expenses/${id}/payments`,
    "POST",
    { paymentDate: "2026-09-11", amountBaht: "5000" },
    { "Idempotency-Key": randomUUID() },
  );
  const d = (await request(`entries/expenses/${id}`)).data;
  const input = {
      expectedVersion: d.record.version,
      reason: "ต้นทางผิด",
      acknowledgePayments: true,
      activePaymentIds: [p1.data.id],
    },
    key = randomUUID();
  assert.equal(
    (
      await write7(
        `expenses/${id}/void`,
        { ...input, acknowledgePayments: false },
        "POST",
      )
    ).data.error.code,
    "PAYMENT_REVIEW_REQUIRED",
  );
  await pool().query(
    "create function private.test_phase7_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='entry.voided' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_phase7_failure before insert on public.audit_events for each row execute function private.test_phase7_failure()",
  );
  try {
    assert.equal(
      (await write7(`expenses/${id}/void`, input, "POST", key)).response.status,
      500,
    );
  } finally {
    await pool().query(
      "drop trigger test_phase7_failure on public.audit_events;drop function private.test_phase7_failure()",
    );
  }
  let after = (await request(`entries/expenses/${id}`)).data;
  assert.equal(after.record.voided_at, null);
  assert.equal(after.paidMinor, 500000);
  assert.equal(after.record.version, d.record.version);
  assert.deepEqual(after.allocations, d.allocations);
  assert.equal(after.audit.length, d.audit.length);
  assert.equal(
    (
      await pool().query(
        "select count(*) n from private.idempotency_requests where key=$1",
        [key],
      )
    ).rows[0].n,
    "0",
  );
  assert.equal(
    (await write7(`expenses/${id}/void`, input, "POST", key)).response.status,
    200,
  );
  assert.equal(
    (await write7(`expenses/${id}/void`, input, "POST", key)).response.status,
    200,
  );
  assert.equal(
    (await write7(`expenses/${id}/void`, input, "POST")).response.status,
    200,
  );
  after = (await request(`entries/expenses/${id}`)).data;
  assert.ok(after.record.voided_at);
  assert.equal(after.pendingMinor, 0);
  assert.ok(after.payments[0].voided_at);
  const voidAgain = await request(
    `payments/${after.payments[0].id}/void`,
    "POST",
    { reason: "ซ้ำหลังยกเลิกต้นทาง" },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(voidAgain.response.status, 200);
  assert.equal(voidAgain.data.pendingMinor, 0);

  assert.deepEqual(after.receipts, d.receipts);
  assert.deepEqual(after.allocations, d.allocations);
  assert.equal(
    after.audit.filter((a: any) => a.action === "entry.voided").length,
    1,
  );
  assert.equal(
    (
      await request(
        `expenses/${id}/payments`,
        "POST",
        { paymentDate: "2026-10-01", amountBaht: "1" },
        { "Idempotency-Key": randomUUID() },
      )
    ).data.error.code,
    "SOURCE_VOIDED",
  );
  assert.equal(
    (await write7(`expenses/${id}`, phase7Edit(null, after.record.version)))
      .data.error.code,
    "SOURCE_VOIDED",
  );
  await assert.rejects(
    pool().query(
      "insert into public.expense_payments(owner_id,expense_id,payment_date,amount_minor) values($1,$2,'2026-10-01',1)",
      [ownerId, id],
    ),
    /source not found/,
  );
  assert.ok(
    !(await request("payables")).data.payables.some((p: any) => p.id === id),
  );
  assert.ok(
    !(await request("expenses")).data.expenses.some((p: any) => p.id === id),
  );
  assert.equal(
    (await request(`entries?status=voided&q=void-with-history`)).data.total,
    1,
  );
});

test("phase seven payment races with source reduction and source void serialize without half records or overpayment", async () => {
  const g = await phase7Garden("phase7-race"),
    id = await phase7Expense(g, "10000");
  const [edit, pay] = await Promise.all([
    write7(`expenses/${id}`, phase7Edit(g, 1, "5000")),
    request(
      `expenses/${id}/payments`,
      "POST",
      { paymentDate: "2026-09-12", amountBaht: "6000" },
      { "Idempotency-Key": randomUUID() },
    ),
  ]);
  assert.ok([200, 422].includes(edit.response.status));
  assert.ok([200, 409].includes(pay.response.status));
  assert.ok(edit.response.status !== 200 || pay.response.status !== 200);
  const d = (await request(`entries/expenses/${id}`)).data;
  assert.ok(d.paidMinor <= Number(d.record.amount_minor));
  const [v, p] = await Promise.all([
    write7(
      `expenses/${id}/void`,
      {
        expectedVersion: d.record.version,
        reason: "แข่งกับจ่าย",
        acknowledgePayments: true,
        activePaymentIds: d.payments
          .filter((p: any) => !p.voided_at)
          .map((p: any) => p.id),
      },
      "POST",
    ),
    request(
      `expenses/${id}/payments`,
      "POST",
      { paymentDate: "2026-09-13", amountBaht: "100" },
      { "Idempotency-Key": randomUUID() },
    ),
  ]);
  assert.ok([200, 409].includes(v.response.status));
  assert.ok([200, 409].includes(p.response.status));
  const end = (await request(`entries/expenses/${id}`)).data;
  if (end.record.voided_at) {
    assert.equal(end.paidMinor, 0);
    assert.equal(end.pendingMinor, 0);
  } else assert.ok(end.paidMinor <= Number(end.record.amount_minor));
});

test("phase seven opening debt edits and void never change net and private views/functions stay inaccessible", async () => {
  const g = await phase7Garden("phase7-debt", 500000);
  const d = (
    await request(
      "opening-debts",
      "POST",
      {
        gardenId: g,
        debtDate: "2026-01-01",
        payee: "หนี้ยกมา",
        amountBaht: "1000",
        note: "",
      },
      { "Idempotency-Key": randomUUID() },
    )
  ).data;
  const edit = {
    gardenId: g,
    date: "2026-01-02",
    payee: "หนี้ยกมา",
    note: "แก้",
    amountBaht: "1200",
    expectedVersion: 1,
    reason: "ตรวจเอกสาร",
  };
  assert.equal(
    (await write7(`opening-debts/${d.id}`, edit)).response.status,
    200,
  );
  let garden = (await request("gardens")).data.gardens.find(
    (r: any) => r.id === g,
  );
  assert.equal(garden.netMinor, 500000);
  assert.equal(garden.openingDebtPendingMinor, 120000);
  assert.equal(
    (
      await write7(
        `opening-debts/${d.id}/void`,
        { expectedVersion: 2, reason: "ยกเลิกหนี้" },
        "POST",
      )
    ).response.status,
    200,
  );
  garden = (await request("gardens")).data.gardens.find((r: any) => r.id === g);
  assert.equal(garden.netMinor, 500000);
  assert.equal(garden.openingDebtPendingMinor, 0);
  const views = (
    await pool().query(
      "select relname,reloptions,has_table_privilege('authenticated',c.oid,'select') client,has_table_privilege('anon',c.oid,'select') anon from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname in ('ledger_records','ledger_attributions','expense_attributions_all')",
    )
  ).rows;
  assert.equal(views.length, 3);
  assert.ok(
    views.every(
      (r) =>
        !r.client && !r.anon && r.reloptions.includes("security_invoker=true"),
    ),
  );
  const f = (
    await pool().query(
      "select p.proname,p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') client from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('guard_ledger_source','snapshot_sale_labor','check_sale_deductions')",
    )
  ).rows;
  assert.equal(f.length, 3);
  assert.ok(
    f.every(
      (r) =>
        !r.prosecdef && !r.client && r.proconfig.includes('search_path=""'),
    ),
  );
});

const backupPassword = "phase8-fixture-passphrase-2026";
let phase8Archive: Buffer;
async function transferUpload(
  value: unknown,
  kind: "prototype" | "restore" = "prototype",
  uploadKey = randomUUID(),
) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value));
  const r = await request(
    "recoveries/upload-url",
    "POST",
    { kind, sizeBytes: bytes.length },
    { "Idempotency-Key": uploadKey },
  );
  assert.equal(r.response.status, 200);
  const client = createClient(r.data.supabaseUrl, r.data.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.storage
    .from(r.data.bucket)
    .uploadToSignedUrl(r.data.path, r.data.token, bytes, {
      contentType:
        kind === "prototype" ? "application/json" : "application/octet-stream",
    });
  assert.ok(!result.error);
  return r.data.id as string;
}
const preview8 = (id: string, extra: Record<string, unknown> = {}) =>
  request(`recoveries/${id}/preview`, "POST", extra);
const confirm8 = (
  id: string,
  previewHash: string,
  extra: Record<string, unknown> = {},
  key = randomUUID(),
) =>
  request(
    `recoveries/${id}/confirm`,
    "POST",
    { previewHash, acknowledge: true, ...extra },
    { "Idempotency-Key": key },
  );

test("phase eight prototype preview preserves totals, converts missing paid history once and imports original photos and linked labor", async () => {
  const fixture = prototypeFixture(
    "phase8-main",
    "data:image/png;base64," + Buffer.from(png).toString("base64"),
  );
  const before = (await request("summary")).data,
    id = await transferUpload(fixture),
    preview = await preview8(id);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.summary.demo, false);
  assert.equal(preview.data.summary.netMinor, 4780000);
  assert.equal(preview.data.summary.pendingMinor, 840000);
  assert.equal(preview.data.summary.photos, 4);
  assert.equal((await request("summary")).data.netMinor, before.netMinor);
  const key = randomUUID(),
    results = await Promise.all([
      confirm8(id, preview.data.previewHash, {}, key),
      confirm8(id, preview.data.previewHash, {}, key),
    ]);
  assert.ok(
    results.every((r) => r.response.status === 200),
    JSON.stringify(results.map((r) => r.data.error?.code)),
  );
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal(
    (await confirm8(id, preview.data.previewHash, { allowDemo: true }, key))
      .response.status,
    409,
  );
  const again = await confirm8(id, preview.data.previewHash);
  assert.equal(again.response.status, 200);
  assert.equal(
    (await request("summary")).data.netMinor,
    before.netMinor + 4780000,
  );
  const after = (await request("summary")).data;
  assert.equal(
    after.laborPendingMinor +
      after.expensePendingMinor +
      after.openingDebtPendingMinor,
    before.laborPendingMinor +
      before.expensePendingMinor +
      before.openingDebtPendingMinor +
      840000,
  );
  const maps = (
    await pool().query(
      "select entity_type,legacy_id,target_id from private.legacy_imports where transfer_id=$1",
      [id],
    )
  ).rows;
  assert.equal(maps.length, 10);
  const teamId = maps.find(
    (m) => m.legacy_id === "phase8-mainteam-a",
  ).target_id;
  const team = (await request(`entries/sale-labor/${teamId}`)).data;
  assert.equal(team.record.basis_units, null);
  assert.equal(team.record.rate_minor, null);
  assert.equal(team.pendingMinor, 420000);
  assert.equal(team.payments.length, 1);
  assert.equal(team.payments[0].legacy_date_unknown, true);
  assert.equal(team.receipts.length, 1);
  for (const r of (
    await pool().query(
      "select id,storage_key,sha256 from public.receipt_files where id=any($1::uuid[])",
      [
        (
          await pool().query(
            "select id from public.receipt_files where owner_id=$1 and storage_key like '%/imports/%'",
            [ownerId],
          )
        ).rows.map((r) => r.id),
      ],
    )
  ).rows) {
    const signed = await request("receipts/" + r.id);
    assert.equal(signed.response.status, 200);
    assert.equal(
      hash(
        Buffer.from(
          await (await fetch(signed.data.url)).arrayBuffer(),
        ).toString("hex"),
      ),
      hash(Buffer.from(png).toString("hex")),
    );
  }
  const saleId = maps.find(
      (m) => m.legacy_id === "phase8-mainsale-b",
    ).target_id,
    unknown = (await request(`entries/sales/${saleId}`)).data;
  assert.equal(unknown.record.net_weight_grams, null);
  const edit = await write7(`sales/${saleId}`, {
    gardenId: unknown.record.garden_id,
    date: unknown.record.date,
    payee: "ขาย B แก้",
    note: "แก้ยอดเดิม",
    invoiceNumber: unknown.record.invoice_number,
    amountBaht: "31000",
    receivedFull: true,
    expectedVersion: 1,
    reason: "ตรวจยอดต้นแบบ",
  });
  assert.equal(edit.response.status, 200, JSON.stringify(edit.data));
  const teamEdit = await write7(`sale-labor/${teamId}`, {
    gardenId: team.record.garden_id,
    date: team.record.date,
    payee: team.record.payee,
    note: team.record.note,
    mode: "weight",
    amountBaht: "17000",
    expectedVersion: 1,
    reason: "แก้ยอดทีมเดิม",
  });
  assert.equal(teamEdit.response.status, 200);
  assert.equal(
    (
      await pool().query(
        "select count(*) n from public.expenses where legacy_details->>'id'='phase8-mainteam-a'",
      )
    ).rows[0].n,
    "0",
  );
  const shared = {
    version: 1,
    demo: false,
    gardens: [
      {
        id: "phase8-shared-garden",
        name: "phase8-shared-debt",
        opening: 500000,
      },
    ],
    records: [
      {
        id: "phase8-shared-debt-record",
        garden: "shared",
        kind: "expense",
        title: "หนี้เดิมส่วนกลาง",
        date: "2026-01-01",
        category: "other",
        amount: 100000,
        paid: 10000,
        opening: true,
        payments: [],
      },
    ],
  };
  const sharedBefore = (await request("summary")).data,
    sharedId = await transferUpload(shared),
    sharedPreview = await preview8(sharedId);
  assert.equal(sharedPreview.response.status, 200);
  assert.equal(
    (await confirm8(sharedId, sharedPreview.data.previewHash)).response.status,
    200,
  );
  const sharedAfter = (await request("summary")).data;
  assert.equal(sharedAfter.netMinor, sharedBefore.netMinor + 500000);
  assert.equal(
    sharedAfter.openingDebtPendingMinor,
    sharedBefore.openingDebtPendingMinor + 90000,
  );
  const repeatId = await transferUpload(fixture);
  assert.equal((await preview8(repeatId)).data.error.code, "IMPORT_DUPLICATE");
});

test("phase eight rejects sample data without explicit confirmation, duplicate IDs, unsupported versions, broken links and bad image bytes", async () => {
  assert.equal(
    (
      await request(
        "recoveries/upload-url",
        "POST",
        { kind: "restore", sizeBytes: 40 * 1024 * 1024 + 1 },
        { "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    422,
  );
  const sample = prototypeFixture("phase8-demo", undefined, true),
    id = await transferUpload(sample),
    p = await preview8(id);
  assert.equal(p.response.status, 200);
  assert.equal(
    (await confirm8(id, p.data.previewHash)).data.error.code,
    "DEMO_CONFIRMATION",
  );
  assert.equal(
    (await confirm8(id, p.data.previewHash, { allowDemo: true })).response
      .status,
    200,
  );
  for (const transform of [
    (v: any) => ({ ...v, version: 2 }),
    (v: any) => ({ ...v, records: [...v.records, v.records[0]] }),
    (v: any) => ({ ...v, gardens: [...v.gardens, v.gardens[0]] }),
    (v: any) => ({
      ...v,
      records: v.records.map((r: any, i: number) =>
        i === 0 ? { ...r, garden: "missing" } : r,
      ),
    }),
    (v: any) => ({
      ...v,
      records: v.records.map((r: any, i: number) =>
        i === 0 ? { ...r, photo: "data:image/png;base64,YmFk" } : r,
      ),
    }),
  ]) {
    const fixture = transform(prototypeFixture(randomUUID()));
    const before = (await request("summary")).data.netMinor,
      job = await transferUpload(fixture);
    assert.equal((await preview8(job)).response.status, 422);
    assert.equal((await request("summary")).data.netMinor, before);
  }
});

test("phase eight stale preview, storage failure and audit failure leave no half import and identical retries succeed once", async () => {
  const fixture = prototypeFixture(
      "phase8-rollback",
      "data:image/png;base64," + Buffer.from(png).toString("base64"),
    ),
    id = await transferUpload(fixture);
  let p = await preview8(id);
  assert.equal(p.response.status, 200);
  await phase7Garden("phase8-changed-after-preview");
  assert.equal(
    (await confirm8(id, p.data.previewHash)).data.error.code,
    "STALE_PREVIEW",
  );
  p = await preview8(id);
  assert.equal(p.response.status, 200);
  const before = (await request("summary")).data,
    key = randomUUID();
  await pool().query(
    "create function private.test_import_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='prototype.imported' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_import_failure before insert on public.audit_events for each row execute function private.test_import_failure()",
  );
  try {
    assert.equal(
      (await confirm8(id, p.data.previewHash, {}, key)).response.status,
      500,
    );
  } finally {
    await pool().query(
      "drop trigger test_import_failure on public.audit_events;drop function private.test_import_failure()",
    );
  }
  assert.deepEqual((await request("summary")).data, before);
  assert.equal(
    (
      await pool().query(
        "select count(*) n from private.legacy_imports where transfer_id=$1",
        [id],
      )
    ).rows[0].n,
    "0",
  );
  assert.equal(
    (
      await pool().query(
        "select count(*) n from private.idempotency_requests where key=$1",
        [key],
      )
    ).rows[0].n,
    "0",
  );
  assert.equal(
    (await confirm8(id, p.data.previewHash, {}, key)).response.status,
    200,
  );
  assert.equal(
    (await confirm8(id, p.data.previewHash, {}, key)).response.status,
    200,
  );
  const immutable = (
    await pool().query(
      "select id from public.expenses where legacy_details->>'id'='phase8-rollbackrepair-b'",
    )
  ).rows[0].id;
  await assert.rejects(
    pool().query("update public.expenses set legacy_details='{}' where id=$1", [
      immutable,
    ]),
  );
});

test("phase eight snapshot remains consistent when a payment commits during original-photo download", async () => {
  const garden = await phase7Garden("phase8-snapshot"),
    expense = await phase7Expense(garden, "1000");
  const storage = supabase(true),
    from = storage.storage.from.bind(storage.storage);
  let first = true,
    release!: () => void,
    signal!: () => void;
  const started = new Promise<void>((r) => (signal = r)),
    gate = new Promise<void>((r) => (release = r));
  storage.storage.from = (bucket: string) => {
    const api = from(bucket),
      download = api.download.bind(api);
    api.download = (async (...args: Parameters<typeof download>) => {
      if (first) {
        first = false;
        signal();
        await gate;
      }
      return download(...args);
    }) as unknown as typeof api.download;
    return api;
  };
  const pending = createArchive(
    pool(),
    storage,
    ownerId,
    process.env.SUPABASE_URL!,
  );
  await started;
  const payment = await request(
    `expenses/${expense}/payments`,
    "POST",
    { paymentDate: "2026-09-12", amountBaht: "1" },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(payment.response.status, 200);
  release();
  const archive = await pending;
  assert.ok(
    !archive.data.expense_payments.some((p) => p.id === payment.data.id),
  );
  const live = (await request("summary")).data;
  assert.equal(
    archive.manifest.summary.pendingMinor,
    live.laborPendingMinor +
      live.expensePendingMinor +
      live.openingDebtPendingMinor +
      100,
  );
});

test("phase eight missing originals fail backup and can retry; failed photo upload does not import half a prototype", async () => {
  const row = (
      await pool().query(
        "select id,storage_key,mime_type from public.receipt_files limit 1",
      )
    ).rows[0],
    storage = supabase(true),
    got = await storage.storage.from("palm-receipts").download(row.storage_key),
    bytes = Buffer.from(await got.data!.arrayBuffer()),
    key = randomUUID();
  const before = (await request("summary")).data;
  await pool().query(
    "update public.receipt_files set storage_key=$2 where id=$1",
    [row.id, ownerId + "/missing-" + randomUUID()],
  );
  try {
    const result = await request(
      "backups",
      "POST",
      { passphrase: backupPassword },
      { "Idempotency-Key": key },
    );
    assert.equal(result.response.status, 503);
    assert.equal(
      (
        await pool().query(
          "select status from private.transfer_jobs where owner_id=$1 and request_key=$2",
          [ownerId, key],
        )
      ).rows[0].status,
      "failed",
    );
  } finally {
    await pool().query(
      "update public.receipt_files set storage_key=$2 where id=$1",
      [row.id, row.storage_key],
    );
  }
  assert.equal(
    (
      await request(
        "backups",
        "POST",
        { passphrase: backupPassword },
        { "Idempotency-Key": key },
      )
    ).response.status,
    200,
  );
  assert.deepEqual((await request("summary")).data, before);
  const id = await transferUpload(
      prototypeFixture(
        "phase8-storagefail",
        "data:image/png;base64," + Buffer.from(png).toString("base64"),
      ),
    ),
    p = await preview8(id),
    confirmKey = randomUUID();
  assert.equal(p.response.status, 200);
  const changed = await storage.storage.updateBucket("palm-receipts", {
    public: false,
    fileSizeLimit: 1,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
  });
  assert.ok(!changed.error);
  try {
    assert.equal(
      (await confirm8(id, p.data.previewHash, {}, confirmKey)).response.status,
      503,
    );
  } finally {
    await storage.storage.updateBucket("palm-receipts", {
      public: false,
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ],
      fileSizeLimit: 10485760,
    });
  }
  assert.deepEqual((await request("summary")).data, before);
  assert.equal(
    (await confirm8(id, p.data.previewHash, {}, confirmKey)).response.status,
    200,
  );
  const security = (
    await pool().query(
      "select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'select') client,has_table_privilege('anon',c.oid,'select') anon from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('transfer_jobs','transfer_objects','legacy_imports')",
    )
  ).rows;
  assert.equal(security.length, 3);
  assert.ok(security.every((t) => t.relrowsecurity && !t.client && !t.anon));
});

test("phase eight encrypted backup contains every table, payment history, Auth mapping and original files; corruption and missing photos are rejected", async () => {
  const key = randomUUID(),
    r = await request(
      "backups",
      "POST",
      { passphrase: backupPassword },
      { "Idempotency-Key": key },
    );
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "ready");
  assert.ok(!JSON.stringify(r.data).includes("encrypted_password"));
  const bytes = Buffer.from(await (await fetch(r.data.url)).arrayBuffer());
  phase8Archive = bytes;
  assert.ok(!bytes.includes(Buffer.from('"encrypted_password"')));
  const archive = await decryptArchive(bytes, backupPassword);
  assert.equal(
    archive.manifest.summary.netMinor,
    (await request("summary")).data.netMinor,
  );
  assert.equal(archive.auth.users[0].id, ownerId);
  assert.ok(archive.auth.identities.length);
  assert.equal(archive.files.length, archive.data.receipt_files.length);
  assert.ok(archive.data.expense_payments.some((p) => p.voided_at));
  assert.ok(archive.data.expense_allocations.length);
  assert.ok(archive.imports.length);
  const repeated = await request(
    "backups",
    "POST",
    { passphrase: backupPassword },
    { "Idempotency-Key": key },
  );
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.data.id, r.data.id);
  assert.equal(
    (
      await request(
        "backups",
        "POST",
        { passphrase: backupPassword + "other" },
        { "Idempotency-Key": key },
      )
    ).response.status,
    409,
  );
  const uploadKey = randomUUID();
  const restoreId = await transferUpload(bytes, "restore", uploadKey);
  assert.equal(
    (await preview8(restoreId, { passphrase: backupPassword + "wrong" }))
      .response.status,
    422,
  );
  const retryUpload = await request(
    "recoveries/upload-url",
    "POST",
    { kind: "restore", sizeBytes: bytes.length },
    { "Idempotency-Key": uploadKey },
  );
  assert.equal(retryUpload.response.status, 200);
  assert.equal(retryUpload.data.id, restoreId);
  assert.equal(retryUpload.data.status, "uploaded");
  assert.equal(retryUpload.data.path, undefined);
  const p = await preview8(restoreId, { passphrase: backupPassword });
  assert.equal(p.response.status, 200);
  assert.equal(
    (
      await confirm8(restoreId, p.data.previewHash, {
        passphrase: backupPassword,
      })
    ).data.status,
    "verified-for-new-environment",
  );
  const broken = Buffer.from(bytes);
  broken[broken.length - 1] ^= 1;
  const corrupted = await transferUpload(broken, "restore");
  assert.equal(
    (await preview8(corrupted, { passphrase: backupPassword })).response.status,
    422,
  );
  const missing = { ...archive, files: archive.files.slice(1) };
  const missingBytes = await encryptArchive(missing, backupPassword),
    missingId = await transferUpload(missingBytes, "restore");
  assert.equal(
    (await preview8(missingId, { passphrase: backupPassword })).response.status,
    422,
  );
  assert.equal((await request("backups/" + randomUUID())).response.status, 404);
  const anonymous = await fetch(origin + "/api/v1/backups");
  assert.equal(anonymous.status, 401);
  assert.equal(
    (
      await request(
        "backups",
        "POST",
        { passphrase: backupPassword },
        { Origin: "https://evil.invalid", "Idempotency-Key": randomUUID() },
      )
    ).response.status,
    403,
  );
});

test("phase eight real restore into a second isolated Supabase stack preserves data, photos and username/password access; populated targets are refused", async () => {
  const env = Object.fromEntries(
    Object.entries(
      parseEnv(readFileSync(".env.recovery.test.local", "utf8")),
    ).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  assert.equal(env.PALM_TEST_ENVIRONMENT, "true");
  assert.equal(env.PALM_RECOVERY_TARGET, "true");
  assert.equal(env.SUPABASE_URL, "http://127.0.0.1:55421");
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55422");
  assert.equal(env.APP_URL, "http://127.0.0.1:3200");
  const db = databasePool(env),
    storage = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  try {
    await migrate(db);
    const old = (
      await db.query(
        "select 'palm-receipts' bucket,storage_key from public.receipt_files union all select 'palm-transfers',storage_key from private.transfer_jobs",
      )
    ).rows;
    for (const b of ["palm-receipts", "palm-transfers"]) {
      const keys = old.filter((o) => o.bucket === b).map((o) => o.storage_key);
      if (keys.length) await storage.storage.from(b).remove(keys);
    }
    await db.query("truncate auth.users,public.owner_accounts cascade");
    const target = { db, storage, url: env.SUPABASE_URL, enabled: true };
    await db.query(
      "update storage.buckets set public=true where id='palm-receipts'",
    );
    try {
      await assert.rejects(
        restoreToEmptyEnvironment(phase8Archive, backupPassword, target, true),
        /private buckets/,
      );
    } finally {
      await db.query(
        "update storage.buckets set public=false where id='palm-receipts'",
      );
    }
    await assert.rejects(
      restoreToEmptyEnvironment(
        phase8Archive,
        backupPassword,
        { ...target, url: "https://feotpdylvprtihgklndj.supabase.co" },
        true,
      ),
    );
    const p = await restoreToEmptyEnvironment(
      phase8Archive,
      backupPassword,
      target,
      false,
    );
    assert.equal(p.status, "preview");
    assert.equal(
      (await db.query("select count(*) n from public.owner_accounts")).rows[0]
        .n,
      "0",
    );
    assert.equal(
      (await db.query("select count(*) n from auth.users")).rows[0].n,
      "0",
    );
    await db.query(
      "create function private.test_restore_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='recovery.restored' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_restore_failure before insert on public.audit_events for each row execute function private.test_restore_failure()",
    );
    try {
      await assert.rejects(
        restoreToEmptyEnvironment(phase8Archive, backupPassword, target, true),
      );
    } finally {
      await db.query(
        "drop trigger test_restore_failure on public.audit_events;drop function private.test_restore_failure()",
      );
    }
    assert.equal(
      (await db.query("select count(*) n from public.owner_accounts")).rows[0]
        .n,
      "0",
    );
    assert.equal(
      (await db.query("select count(*) n from auth.users")).rows[0].n,
      "0",
    );
    const restored = await restoreToEmptyEnvironment(
      phase8Archive,
      backupPassword,
      target,
      true,
    );
    assert.equal(restored.status, "restored");
    assert.equal(
      (
        await db.query(
          "select count(*) n from private.transfer_objects where owner_id=$1 and bucket='palm-transfers' and expires_at>now()",
          [ownerId],
        )
      ).rows[0].n,
      "1",
    );
    const archive = await decryptArchive(phase8Archive, backupPassword);
    assert.deepEqual(restored.summary, archive.manifest.summary);
    const signed = await createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({
      email: archive.auth.users[0].email,
      password,
    });
    assert.ok(!signed.error, "restored original Auth password must work");
    assert.equal(signed.data.user!.id, ownerId);
    if (process.env.TEST_APP_MODE === "production") {
      const targetApp = await startApp(env);
      try {
        const login = await fetch(env.APP_URL + "/api/v1/session", {
          method: "POST",
          headers: { Origin: env.APP_URL, "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        assert.equal(login.status, 200);
        const targetCookie = login.headers.get("set-cookie")!.split(";")[0];
        const summary = await fetch(env.APP_URL + "/api/v1/summary", {
          headers: { Cookie: targetCookie },
        });
        assert.equal(summary.status, 200);
        assert.equal(
          (await summary.json()).netMinor,
          archive.manifest.summary.netMinor,
        );
      } finally {
        await stopApp(targetApp, false);
      }
    }

    for (const f of archive.files) {
      const downloaded = await storage.storage
        .from("palm-receipts")
        .download(
          (
            await db.query(
              "select storage_key from public.receipt_files where id=$1",
              [f.id],
            )
          ).rows[0].storage_key,
        );
      assert.ok(!downloaded.error);
      assert.equal(
        sha(Buffer.from(await downloaded.data!.arrayBuffer())),
        f.sha256,
      );
    }
    const before = (await db.query("select count(*) n from public.sales"))
      .rows[0].n;
    await assert.rejects(
      restoreToEmptyEnvironment(phase8Archive, backupPassword, target, true),
      /ปลายทางมีข้อมูล/,
    );
    assert.equal(
      (await db.query("select count(*) n from public.sales")).rows[0].n,
      before,
    );
    const triggers = (
      await db.query(
        "select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'",
      )
    ).rows[0].n;
    assert.equal(triggers, "0");
  } finally {
    await db.end();
  }
});

let automaticArchive: Buffer;
const autoPassword = "automatic-backup-test-secret-2026-private";
test("phase nine offsite encryption, failed transfer, audit rollback, concurrent retry and stale status preserve business data and earlier backup points", async () => {
  const store = await new TestOffsite().init();
  const options = {
    db: pool(),
    storage: supabase(true),
    sourceUrl: process.env.SUPABASE_URL!,
    password: autoPassword,
    offsite: store,
    runId: "9001",
  };
  const before = (await request("summary")).data;
  try {
    assert.equal(
      (await request("backups/automatic-status")).data.state,
      "not-configured",
    );
    assert.equal(
      (await fetch(origin + "/api/v1/backups/automatic-status")).status,
      401,
    );
    store.publicRepository = true;
    await assert.rejects(runAutomaticBackup(options));
    assert.equal(
      (await automaticStatus(pool(), ownerId)).state,
      "not-configured",
    );
    store.publicRepository = false;
    store.corruptDownload = true;
    await assert.rejects(runAutomaticBackup(options));
    assert.equal(offsiteHealth(store.objects).status, "missing");
    assert.equal((await automaticStatus(pool(), ownerId)).lastSuccess, null);
    store.corruptDownload = false;
    await pool().query(
      "create function private.test_auto_failure() returns trigger language plpgsql set search_path='' as $$ begin if NEW.action='backup.automatic_completed' then raise exception 'fixture failure'; end if; return NEW; end $$;create trigger test_auto_failure before insert on public.audit_events for each row execute function private.test_auto_failure()",
    );
    try {
      await assert.rejects(runAutomaticBackup(options));
    } finally {
      await pool().query(
        "drop trigger test_auto_failure on public.audit_events;drop function private.test_auto_failure()",
      );
    }
    assert.equal((await automaticStatus(pool(), ownerId)).state, "failed");
    assert.equal((await automaticStatus(pool(), ownerId)).lastSuccess, null);
    assert.equal(
      (
        await pool().query(
          "select count(*) n from public.audit_events where action='backup.automatic_completed'",
        )
      ).rows[0].n,
      "0",
    );
    const raced = await Promise.all([
      runAutomaticBackup(options),
      runAutomaticBackup(options),
    ]);
    assert.equal(raced.filter((r) => r.status === "complete").length, 1);
    const success = raced.find((r) => r.status === "complete")!;
    const original = await readFile(
      join(store.directory, success.artifactId!, "backup.palmbackup"),
    );
    const count = store.objects.length;
    assert.equal(
      (await runAutomaticBackup(options)).status,
      "already-complete",
    );
    assert.equal(store.objects.length, count);
    const status = (await request("backups/automatic-status")).data;
    assert.equal(status.state, "healthy");
    assert.ok(!JSON.stringify(status).includes("lease_token"));
    assert.equal(offsiteHealth(store.objects).status, "fresh");
    assert.equal(
      (await automaticStatus(pool(), ownerId, Date.now() + 25 * 3600000)).state,
      "stale",
    );
    await pool().query(
      "update private.automatic_backup_runs set slot=slot-1 where id=$1",
      [success.id],
    );
    store.failUpload = true;
    await assert.rejects(runAutomaticBackup(options));
    const failed = await automaticStatus(pool(), ownerId);
    assert.equal(failed.state, "failed");
    assert.equal(failed.lastSuccess.id, success.id);
    assert.equal(
      sha(
        await readFile(
          join(store.directory, success.artifactId!, "backup.palmbackup"),
        ),
      ),
      sha(original),
    );
    store.failUpload = false;
    const final = await runAutomaticBackup(options);
    automaticArchive = await readFile(
      join(store.directory, final.artifactId!, "backup.palmbackup"),
    );
    const archive = await decryptArchive(automaticArchive, autoPassword);
    assert.equal(archive.manifest.summary.netMinor, before.netMinor);
    assert.equal(
      archive.manifest.summary.pendingMinor,
      before.laborPendingMinor +
        before.openingDebtPendingMinor +
        before.expensePendingMinor,
    );
    assert.equal(archive.files.length, archive.data.receipt_files.length);
    assert.ok(archive.auth.identities.length);
    assert.equal((await request("summary")).data.netMinor, before.netMinor);
    assert.deepEqual((await request("summary")).data, before);
    const secure = (
      await pool().query(
        "select relrowsecurity rls,has_table_privilege('authenticated','private.automatic_backup_runs','SELECT,INSERT,UPDATE,DELETE') client from pg_class where oid='private.automatic_backup_runs'::regclass",
      )
    ).rows[0];
    assert.equal(secure.rls, true);
    assert.equal(secure.client, false);
    // A saturated destination must keep all earlier good files and fail before export.
    await pool().query(
      "update private.automatic_backup_runs set slot=slot-2 where id=$1",
      [final.id],
    );
    store.objects.push({
      id: "9999",
      name: "other-usage",
      size: MAX_OFFSITE_BYTES,
      expired: false,
      runId: "9001",
    });
    const filesBefore = store.objects.length;
    await assert.rejects(runAutomaticBackup(options));
    assert.equal(store.objects.length, filesBefore);
    assert.ok((await automaticStatus(pool(), ownerId)).lastSuccess);
  } finally {
    await rm(store.directory, { recursive: true, force: true });
  }
});

test("phase nine restores an automatically encrypted offsite file into separate Supabase with original photos and username access", async () => {
  const env = parseEnv(readFileSync(".env.recovery.test.local", "utf8"));
  assert.equal(env.PALM_TEST_ENVIRONMENT, "true");
  assert.equal(env.PALM_RECOVERY_TARGET, "true");
  assert.equal(env.SUPABASE_URL, "http://127.0.0.1:55421");
  const url = new URL(env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55422");
  const db = databasePool(env),
    storage = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  try {
    await migrate(db);
    const old = (
      await db.query(
        "select 'palm-receipts' bucket,storage_key from public.receipt_files union all select 'palm-transfers',storage_key from private.transfer_jobs",
      )
    ).rows;
    for (const bucket of ["palm-receipts", "palm-transfers"]) {
      const keys = old
        .filter((o) => o.bucket === bucket)
        .map((o) => o.storage_key);
      if (keys.length) await storage.storage.from(bucket).remove(keys);
    }
    await db.query("truncate auth.users,public.owner_accounts cascade");
    const result = await restoreToEmptyEnvironment(
      automaticArchive,
      autoPassword,
      { db, storage, url: env.SUPABASE_URL!, enabled: true },
      true,
    );
    const archive = await decryptArchive(automaticArchive, autoPassword);
    assert.equal(result.status, "restored");
    assert.deepEqual(result.summary, archive.manifest.summary);
    assert.equal(
      (await db.query("select username from public.owner_accounts")).rows[0]
        .username,
      username,
    );
    const auth = await createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({
      email: archive.auth.users[0].email,
      password,
    });
    assert.ok(!auth.error);
    assert.equal(auth.data.user!.id, ownerId);
    for (const file of archive.files) {
      const key = (
        await db.query(
          "select storage_key from public.receipt_files where id=$1",
          [file.id],
        )
      ).rows[0].storage_key;
      const got = await storage.storage.from("palm-receipts").download(key);
      assert.ok(!got.error);
      assert.equal(
        sha(new Uint8Array(await got.data!.arrayBuffer())),
        file.sha256,
      );
    }
    if (process.env.TEST_APP_MODE === "production") {
      const app = await startApp(env as Record<string, string>);
      try {
        const login = await fetch(env.APP_URL + "/api/v1/session", {
          method: "POST",
          headers: { Origin: env.APP_URL!, "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        assert.equal(login.status, 200);
        const r = await fetch(env.APP_URL + "/api/v1/summary", {
          headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
        });
        assert.equal(r.status, 200);
        assert.equal(
          (await r.json()).netMinor,
          archive.manifest.summary.netMinor,
        );
      } finally {
        await stopApp(app, false);
      }
    }
  } finally {
    await db.end();
  }
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
  assert.deepEqual(
    (await mine.json()).map((g: { id: string }) => g.id).sort(),
    (
      await pool().query("select id from public.gardens where owner_id=$1", [
        ownerId,
      ])
    ).rows
      .map((g) => g.id)
      .sort(),
  );
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
    "expense_allocations",
    "opening_debts",
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
      expense_allocations: {
        owner_id: ownerId,
        expense_id: sharedId,
        garden_id: allocationGardens[0],
        amount_minor: 100,
      },
      opening_debts: {
        owner_id: ownerId,
        garden_id: gardenId,
        debt_date: "2026-10-01",
        payee: "forbidden",
        amount_minor: 100,
      },
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
    if (
      table === "expense_payments" ||
      table === "opening_debts" ||
      table === "expense_allocations"
    ) {
      for (const method of ["PATCH", "DELETE"]) {
        const deniedWrite: Response = await fetch(endpoint, {
          method,
          headers: { ...headers, "Content-Type": "application/json" },
          ...(method === "PATCH"
            ? {
                body: JSON.stringify(
                  table === "expense_payments"
                    ? {
                        voided_at: new Date().toISOString(),
                        void_reason: "bypass",
                      }
                    : { amount_minor: 1 },
                ),
              }
            : {}),
        });
        assert.equal(deniedWrite.status, 403);
      }
    }
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
