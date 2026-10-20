import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "../src/server/db";

export async function migrate() {
  const db = await pool().connect();
  try {
    await db.query("select pg_advisory_lock(1926020)");
    await db.query("create schema if not exists private");
    await db.query(
      "create table if not exists private.schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())",
    );
    const files = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = await readFile("supabase/migrations/" + file, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = (
        await db.query(
          "select checksum from private.schema_migrations where name=$1",
          [file],
        )
      ).rows[0];
      if (previous) {
        if (previous.checksum !== checksum)
          throw new Error("Applied migration changed: " + file);
        continue;
      }
      // Migration SQL contains its own transaction; record its checksum atomically.
      const executable = sql
        .trim()
        .replace(/^begin;/i, "")
        .replace(/commit;$/i, "");
      await db.query("begin");
      try {
        await db.query(executable);
        await db.query(
          "insert into private.schema_migrations(name,checksum) values ($1,$2)",
          [file, checksum],
        );
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    await db.query("notify pgrst, 'reload schema'");
  } finally {
    await db.query("select pg_advisory_unlock(1926020)");
    db.release();
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Migrations applied."))
    .catch(() => {
      console.error(
        "Migration failed; inspect migration and database readiness.",
      );
      process.exitCode = 1;
    })
    .finally(() => pool().end());
}
