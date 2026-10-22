import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
export async function trackObject(
  db: Pool,
  job: string,
  owner: string,
  bucket: "palm-receipts" | "palm-transfers",
  key: string,
  days: number,
) {
  await db.query(
    "insert into private.transfer_objects(owner_id,transfer_id,bucket,storage_key,expires_at) values($1,$2,$3,$4,now()+$5::int*interval '1 day') on conflict(storage_key) do nothing",
    [owner, job, bucket, key, days],
  );
}
export async function cleanupExpired(
  db: Pool,
  storage: SupabaseClient,
  owner: string,
) {
  const rows = (
    await db.query(
      "select * from private.transfer_objects where owner_id=$1 and expires_at<=now() order by expires_at,storage_key limit 20",
      [owner],
    )
  ).rows;
  for (const row of rows) {
    const used =
      row.bucket === "palm-receipts" &&
      (
        await db.query(
          "select exists(select 1 from public.receipt_files where owner_id=$1 and storage_key=$2) used",
          [owner, row.storage_key],
        )
      ).rows[0].used;
    if (!used) {
      const result = await storage.storage
        .from(row.bucket)
        .remove([row.storage_key]);
      if (result.error) continue;
    }
    await db.query(
      "delete from private.transfer_objects where storage_key=$1 and owner_id=$2",
      [row.storage_key, owner],
    );
  }
}
