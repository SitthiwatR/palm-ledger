import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { audit, normalizedUsername, supabase } from "../src/server/auth";
import { closePool, pool, transaction } from "../src/server/db";
import { databaseErrorDetails } from "./database-diagnostics";

type OwnerStage =
  | "validation"
  | "configuration"
  | "database"
  | "Supabase Auth"
  | "owner registration";
class OwnerSetupError extends Error {
  constructor(
    public stage: OwnerStage,
    cause: unknown,
  ) {
    super("Owner setup failed", { cause });
  }
}

// Keep the main advice fixed. Database diagnostics are redacted separately.
export function ownerErrorMessage(error: unknown): string {
  const stage = error instanceof OwnerSetupError ? error.stage : "validation";
  const cause = error instanceof OwnerSetupError ? error.cause : error;
  const reasons: Record<string, string> = {
    USERNAME_INVALID:
      "Username must be 3–40 characters: letters, numbers, _, . or -.",
    PASSWORD_INVALID:
      "Password must be 12–128 characters. Enter it again; nothing is displayed while typing.",
    OWNER_EXISTS:
      "An owner already exists. Use reset with the existing username instead of create.",
    OWNER_NOT_FOUND:
      "No owner matches this username. Check the username and selected project.",
    CANCELLED: "Cancelled. No password was submitted.",
    "28P01":
      "Database password rejected. Check the Session pooler URI and URL-encode special characters in its password.",
    ENETUNREACH:
      "Database network unreachable. Use the Supabase Session pooler URI instead of the IPv6 direct connection.",
    EHOSTUNREACH:
      "Database host unreachable. Check the Session pooler URI and network access.",
    ENOTFOUND:
      "Hostname not found. Check the project URL and Session pooler hostname.",
    EAI_AGAIN: "DNS lookup failed. Check your network and try again.",
    ECONNREFUSED:
      "Connection refused. Check the Session pooler hostname, port and project status.",
    ETIMEDOUT:
      "Connection timed out. Check network/firewall access to the Session pooler.",
    ERR_INVALID_URL:
      "Database URI is invalid. Copy the complete Session pooler URI and URL-encode special characters in its password.",
    DEPTH_ZERO_SELF_SIGNED_CERT:
      "Database CA is not trusted. Check the provider CA and local network TLS interception; keep verification enabled.",
    SELF_SIGNED_CERT_IN_CHAIN:
      "Database CA is not trusted. Run prepare-database-ca.ts from this repository folder.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      "Database CA is missing. Run prepare-database-ca.ts from this repository folder.",
    CERT_HAS_EXPIRED:
      "TLS certificate expired. Check the system clock and provider certificate.",
    ERR_TLS_CERT_ALTNAME_INVALID:
      "TLS hostname verification failed. Check the provider hostname; keep verification enabled.",
    "42P01":
      "Owner tables are missing. Check that DATABASE_URL points to the migrated production project.",
    "23503":
      "Auth user and database do not match. Use DATABASE_URL and Supabase keys from the same project.",
    "42501": "Database permission denied. Check the database connection role.",
    XX000:
      "Pooler rejected the connection. Check project status, pooler hostname and postgres.PROJECT_REF username.",
    weak_password:
      "Supabase rejected the password policy. Choose a stronger password that meets the project's Auth settings.",
    email_address_invalid:
      "Supabase rejected the internal account email. Check the project's Auth email validation settings.",
  };
  const code =
    typeof cause === "string"
      ? cause
      : typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          typeof cause.code === "string"
        ? cause.code
        : "";
  let reason = Object.hasOwn(reasons, code) ? reasons[code] : undefined;
  if (
    !reason &&
    cause instanceof Error &&
    /connection timeout|timeout expired/i.test(cause.message)
  )
    reason = reasons.ETIMEDOUT;
  if (
    !reason &&
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    (cause.status === 401 || cause.status === 403)
  )
    reason =
      "Supabase admin access rejected. Use the service_role/secret key from the selected project, not an anon/publishable key.";
  if (!reason && stage === "configuration")
    reason =
      "Check DATABASE_URL (or POSTGRES_URL), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.hosted.local.";
  if (!reason)
    reason =
      "Check this stage's service configuration and project status. No provider response or credential was printed.";
  return `Owner update failed [${stage}]: ${reason}`;
}

export async function manageOwner(
  mode: "create" | "reset",
  name: string,
  password: string,
) {
  let stage: OwnerStage = "validation";
  try {
    const username = normalizedUsername(name);
    const validName = z
      .string()
      .min(3)
      .max(40)
      .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}_.-]*$/u)
      .safeParse(username);
    if (!validName.success) throw "USERNAME_INVALID";
    if (!z.string().min(12).max(128).safeParse(password).success)
      throw "PASSWORD_INVALID";
    stage = "configuration";
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL)
      throw new Error("Missing database configuration");
    const admin = supabase(true);
    stage = "database";
    return await transaction(async (db) => {
      await db.query("select pg_advisory_xact_lock(1926021)");
      const current = (
        await db.query("select * from public.owner_accounts for update")
      ).rows[0];
      if (mode === "create") {
        if (current) throw "OWNER_EXISTS";
        stage = "Supabase Auth";
        const result = await admin.auth.admin.createUser({
          email: `${randomUUID()}@palm-ledger.invalid`,
          password,
          email_confirm: true,
        });
        if (result.error) throw result.error;
        const id = result.data.user.id;
        stage = "owner registration";
        try {
          await db.query(
            "insert into public.owner_accounts(id,username) values ($1,$2)",
            [id, username],
          );
          await audit(db, id, "owner.created", id, null, { username });
        } catch (error) {
          await admin.auth.admin.deleteUser(id);
          throw error;
        }
        return id;
      }
      if (!current || current.username !== username) throw "OWNER_NOT_FOUND";
      stage = "Supabase Auth";
      const result = await admin.auth.admin.updateUserById(current.id, {
        password,
      });
      if (result.error) throw result.error;
      stage = "owner registration";
      await db.query(
        "update public.owner_accounts set auth_epoch=auth_epoch+1 where id=$1",
        [current.id],
      );
      await db.query("delete from private.owner_sessions where owner_id=$1", [
        current.id,
      ]);
      await audit(db, current.id, "owner.password_reset", current.id, null, {
        sessionsRevoked: true,
      });
      return current.id;
    });
  } catch (error) {
    throw new OwnerSetupError(stage, error);
  }
}
async function readPassword(): Promise<string> {
  if (!stdin.isTTY) {
    let value = "";
    for await (const chunk of stdin) value += chunk;
    return value.replace(/\r?\n$/, "");
  }
  stdout.write("New password (12+ characters, hidden): ");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const listener = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject("CANCELLED");
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    function cleanup() {
      stdin.off("data", listener);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    }
    stdin.on("data", listener);
  });
}
if (process.argv[1]?.endsWith("owner.ts")) {
  const [mode, name] = process.argv.slice(2);
  let hiddenPassword = "";
  if (mode === "check") {
    (async () => {
      const result = await pool().query(
        "select exists(select 1 from public.owner_accounts) as configured",
      );
      console.log("Database connection: OK. Owner tables: OK.");
      console.log(
        "Owner login:",
        result.rows[0].configured ? "configured" : "not configured yet",
      );
    })()
      .catch((error) => {
        console.error(
          ownerErrorMessage(new OwnerSetupError("database", error)),
        );
        console.error(
          "Database details:",
          JSON.stringify(databaseErrorDetails(error)),
        );
        process.exitCode = 1;
      })
      .finally(closePool);
  } else if (!["create", "reset"].includes(mode) || !name) {
    console.error(
      "Usage: owner.ts check | create|reset USERNAME (password from hidden prompt or stdin)",
    );
    process.exitCode = 1;
  } else
    readPassword()
      .then((password) => {
        hiddenPassword = password;
        return manageOwner(mode as "create" | "reset", name, password);
      })
      .then(() => console.log("Owner updated. No credentials were printed."))
      .catch((error) => {
        console.error(ownerErrorMessage(error));
        if (error instanceof OwnerSetupError && error.stage === "database")
          console.error(
            "Database details:",
            JSON.stringify(databaseErrorDetails(error.cause, [hiddenPassword])),
          );
        process.exitCode = 1;
      })
      .finally(() => {
        hiddenPassword = "";
        return closePool();
      });
}
