import { createClient } from "@supabase/supabase-js";
import { databasePool } from "../src/server/db";
import {
  runAutomaticBackup,
  validateAutomaticSource,
} from "../src/server/recovery/automatic";
import { GithubBackupStore } from "./github-backup-store";

let db: ReturnType<typeof databasePool> | undefined;
try {
  db = databasePool();
  validateAutomaticSource(db, process.env);
  const offsite = new GithubBackupStore(
    process.env.BACKUP_DESTINATION_REPOSITORY!,
    process.env.GITHUB_TOKEN!,
  );
  const storage = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const result = await runAutomaticBackup({
    db,
    storage,
    sourceUrl: process.env.SUPABASE_URL!,
    password: process.env.BACKUP_ENCRYPTION_PASSWORD!,
    offsite,
    runId: process.env.GITHUB_RUN_ID!,
  });
  console.log("Automatic backup:", result.status);
} catch {
  console.error(
    "Automatic backup failed. Check private repository access, source availability, retention and quota. No credentials or business data were logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
