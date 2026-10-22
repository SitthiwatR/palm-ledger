import { GithubBackupStore } from "./github-backup-store";
import { offsiteHealth } from "../src/server/recovery/automatic";
// This check needs only the private repository's short-lived GITHUB_TOKEN.
// It can alert while PostgreSQL, Supabase Storage or the web deployment is down.
try {
  const store = new GithubBackupStore(
    process.env.BACKUP_DESTINATION_REPOSITORY!,
    process.env.GITHUB_TOKEN!,
  );
  await store.assertPrivate();
  const result = offsiteHealth(await store.list());
  if (result.status !== "fresh")
    throw new Error("Backup missing or older than 24 hours");
  console.log("Offsite backup point is within 24 hours.");
} catch {
  console.error(
    "Backup alert: no verified offsite point within 24 hours, or offsite monitoring failed. Inspect this private workflow and the daily backup job.",
  );
  process.exitCode = 1;
}
