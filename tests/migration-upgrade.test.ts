import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { testEnv } from "./support";

test("Phase 7 migration preserves every pre-existing column/ID including session ciphertext, receipt metadata and payment history", async () => {
  // support.ts refuses anything outside localhost:54422 and the test markers.
  const admin = new Pool({ connectionString: testEnv.DATABASE_URL }),
    dbName = "palm_upgrade_" + randomUUID().replaceAll("-", "");
  const url = new URL(testEnv.DATABASE_URL);
  url.pathname = "/" + dbName;
  let target: Pool | undefined;
  try {
    await admin.query(`create database ${dbName}`);
    target = new Pool({ connectionString: url.toString() });
    await target.query(
      "create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])",
    );
    const files = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files.slice(0, -1))
      await target.query(await readFile("supabase/migrations/" + f, "utf8"));
    const owner = randomUUID(),
      g = randomUUID(),
      s = randomUUID(),
      l = randomUUID(),
      e = randomUUID(),
      d = randomUUID();
    await target.query("insert into auth.users values($1);", [owner]);
    await target.query(
      "insert into public.owner_accounts(id,username) values($1,'upgrade-owner')",
      [owner],
    );
    await target.query(
      "insert into public.gardens(id,owner_id,name,opening_minor) values($1,$2,'เดิม',500000)",
      [g, owner],
    );
    await target.query(
      "insert into public.sales(id,owner_id,garden_id,sale_date,buyer,invoice_number,net_weight_grams,price_minor_per_kg,gross_minor,deductions_minor,net_minor) values($1,$2,$3,'2026-09-01','ผู้ซื้อ','เดิม',1000000,1000,1000000,10000,990000)",
      [s, owner, g],
    );
    await target.query(
      "insert into public.sale_deductions(owner_id,sale_id,description,amount_minor) values($1,$2,'หักเดิม',10000)",
      [owner, s],
    );
    await target.query(
      "insert into public.sale_labor(id,owner_id,sale_id,mode,payee,basis_units,rate_minor,amount_minor) values($1,$2,$3,'weight','ทีม',1000000,80000,80000)",
      [l, owner, s],
    );
    await target.query(
      "insert into public.expenses(id,owner_id,garden_id,expense_date,kind,payee,note,unit,quantity_milli,rate_minor,amount_minor) values($1,$2,null,'2026-09-02','other','ร้าน','เก็บไว้','item',1000,100000,100000)",
      [e, owner],
    );
    await target.query(
      "insert into public.expense_allocations(expense_id,owner_id,garden_id,amount_minor) values($1,$2,$3,100000)",
      [e, owner, g],
    );
    await target.query(
      "insert into public.opening_debts(id,owner_id,garden_id,debt_date,payee,amount_minor) values($1,$2,$3,'2026-01-01','หนี้เดิม',100000)",
      [d, owner, g],
    );
    for (const [column, id, n] of [
      ["expense_id", e, 33333],
      ["sale_labor_id", l, 25000],
      ["opening_debt_id", d, 10000],
    ] as const)
      await target.query(
        `insert into public.expense_payments(owner_id,${column},payment_date,amount_minor) values($1,$2,'2026-09-03',$3)`,
        [owner, id, n],
      );
    const cancelled = (
      await target.query(
        "insert into public.expense_payments(owner_id,expense_id,payment_date,amount_minor) values($1,$2,'2026-09-04',100) returning id",
        [owner, e],
      )
    ).rows[0].id;
    await target.query(
      "update public.expense_payments set voided_at=now(),void_reason='ผิดเดิม' where id=$1",
      [cancelled],
    );
    await target.query(
      "insert into public.receipt_files(owner_id,sale_id,storage_key,mime_type,size_bytes,sha256) values($1,$2,'original-photo','image/png',64,repeat('a',64))",
      [owner, s],
    );
    await target.query(
      "insert into public.labor_profiles(owner_id,mode,payee,rate_minor) values($1,'weight','ทีม',80000)",
      [owner],
    );
    await target.query(
      "insert into private.owner_sessions(token_hash,owner_id,auth_epoch,sealed_tokens,expires_at) values('unchanged-token-hash',$1,1,'unchanged-ciphertext',now()+interval '20 days')",
      [owner],
    );
    await target.query(
      "insert into public.audit_events(owner_id,action,entity_id,after_data) values($1,'sale.created',$2,'{\"historical\":true}')",
      [owner, s],
    );
    const tables = [
      "public.owner_accounts",
      "public.gardens",
      "public.sales",
      "public.sale_deductions",
      "public.sale_labor",
      "public.expenses",
      "public.expense_allocations",
      "public.expense_payments",
      "public.opening_debts",
      "public.receipt_files",
      "public.labor_profiles",
      "public.audit_events",
      "private.owner_sessions",
    ];
    const snapshots = [];
    for (const table of tables) {
      const [schema, name] = table.split(".");
      const columns = (
        await target.query(
          "select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position",
          [schema, name],
        )
      ).rows
        .map((r) => '"' + r.column_name + '"')
        .join(",");
      const rows = (
        await target.query(`select ${columns} from ${table} order by 1,2`)
      ).rows;
      snapshots.push({ table, columns, rows });
    }
    const oldAttribution = (
      await target.query(
        "select * from private.expense_attributions order by garden_id",
      )
    ).rows;
    await target.query(
      await readFile("supabase/migrations/" + files.at(-1), "utf8"),
    );
    for (const snap of snapshots)
      assert.deepEqual(
        (
          await target.query(
            `select ${snap.columns} from ${snap.table} order by 1,2`,
          )
        ).rows,
        snap.rows,
        snap.table,
      );
    assert.deepEqual(
      (
        await target.query(
          "select * from private.expense_attributions order by garden_id",
        )
      ).rows,
      oldAttribution,
    );
    const snapshot = (
      await target.query(
        "select garden_id,to_char(labor_date,'YYYY-MM-DD') date,version,voided_at from public.sale_labor where id=$1",
        [l],
      )
    ).rows[0];
    assert.deepEqual(snapshot, {
      garden_id: g,
      date: "2026-09-01",
      version: 1,
      voided_at: null,
    });
  } finally {
    await target?.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  }
});
