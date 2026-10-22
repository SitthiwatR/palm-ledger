import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { databasePool } from "../src/server/db";
import { migrate } from "./migrate";
import {
  restoreToEmptyEnvironment,
  assertRecoveryTarget,
} from "../src/server/recovery/restore";
import { decryptArchive, passphrase } from "../src/server/recovery/format";
import { readPassword } from "./owner";
const [mode, file, configFile, ...flags] = process.argv.slice(2);
if (
  !["init", "inspect", "preview", "restore"].includes(mode) ||
  !file ||
  (!["init", "inspect"].includes(mode) && !configFile) ||
  flags.some((f) => f !== "--confirm")
) {
  console.error(
    "Usage: recovery.ts init TARGET_ENV | inspect FILE | preview|restore FILE TARGET_ENV [--confirm]. Password from hidden prompt/stdin; never pass it as an argument.",
  );
  process.exitCode = 1;
} else {
  let secret = "";
  let db: ReturnType<typeof databasePool> | undefined;
  try {
    if (mode === "init") {
      const env = parseEnv(await readFile(file, "utf8"));
      if (
        env.PALM_RECOVERY_TARGET !== "true" ||
        !env.SUPABASE_URL ||
        new URL(env.SUPABASE_URL).hostname ===
          "feotpdylvprtihgklndj.supabase.co"
      )
        throw new Error(
          "กู้คืนได้เฉพาะระบบใหม่ที่กำหนด PALM_RECOVERY_TARGET=true ไม่ใช้ production",
        );
      db = databasePool(env);
      assertRecoveryTarget(db, env.SUPABASE_URL!);
      const present = await db.query(
        "select to_regclass('public.owner_accounts')::text owner_table",
      );
      if (present.rows[0].owner_table)
        throw new Error(
          "ปลายทางมี app schema แล้ว ไม่สร้างทับ ใช้ preview เพื่อตรวจ",
        );
      if (
        (await db.query("select exists(select 1 from auth.users) present"))
          .rows[0].present
      )
        throw new Error("ปลายทางมีบัญชีแล้ว");
      await migrate(db);
      console.log(
        "Empty recovery environment initialized. No credentials printed.",
      );
    } else {
      secret = passphrase.parse(
        await readPassword("Backup passphrase (hidden): "),
      );
      const bytes = await readFile(file);
      if (mode === "inspect") {
        const a = await decryptArchive(bytes, secret);
        console.log(
          JSON.stringify(
            {
              format: a.format,
              version: a.version,
              createdAt: a.createdAt,
              summary: a.manifest.summary,
              username: a.data.owner_accounts[0].username,
              requiresNewLogin: true,
            },
            null,
            2,
          ),
        );
      } else {
        if (mode === "restore" && !flags.includes("--confirm"))
          throw new Error(
            "Run preview first; --confirm is required for restoring the empty recovery environment.",
          );
        const env = parseEnv(await readFile(configFile, "utf8"));
        if (
          !env.SUPABASE_URL ||
          !env.SUPABASE_SERVICE_ROLE_KEY ||
          !env.DATABASE_URL ||
          env.PALM_RECOVERY_TARGET !== "true"
        )
          throw new Error(
            "Recovery target configuration is incomplete or PALM_RECOVERY_TARGET is not true.",
          );
        db = databasePool(env);
        assertRecoveryTarget(db, env.SUPABASE_URL!);
        const storage = createClient(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const report = await restoreToEmptyEnvironment(
          bytes,
          secret,
          { db, storage, url: env.SUPABASE_URL, enabled: true },
          mode === "restore",
        );
        const reportPath = file + "." + mode + "-report.json";
        await writeFile(reportPath, JSON.stringify(report, null, 2), {
          mode: 0o600,
        });
        console.log(
          "Recovery " +
            mode +
            " verified. Report: " +
            reportPath +
            ". No credentials printed.",
        );
      }
    }
  } catch (e) {
    const safe =
      e instanceof Error &&
      /ชุดสำรอง|ปลายทาง|ต้นทาง|ระบบใหม่|เวอร์ชัน|กู้คืน|ไม่ commit|คัดลอก|ตรวจรูป|ข้อมูลหลัง|บัญชี/.test(
        e.message,
      )
        ? e.message
        : "Recovery failed. Inspect target readiness and the archive; no credentials were printed.";
    console.error(safe);
    process.exitCode = 1;
  } finally {
    secret = "";
    await db?.end();
  }
}
