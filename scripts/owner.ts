import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { audit, normalizedUsername, supabase } from "../src/server/auth";
import { pool, transaction } from "../src/server/db";

export async function manageOwner(
  mode: "create" | "reset",
  name: string,
  password: string,
) {
  const username = normalizedUsername(name);
  z.string()
    .min(3)
    .max(40)
    .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}_.-]*$/u)
    .parse(username);
  z.string().min(12).max(128).parse(password);
  return transaction(async (db) => {
    await db.query("select pg_advisory_xact_lock(1926021)");
    const current = (
      await db.query("select * from public.owner_accounts for update")
    ).rows[0];
    if (mode === "create") {
      if (current) throw new Error("An owner already exists. Use reset.");
      const result = await supabase(true).auth.admin.createUser({
        email: `${randomUUID()}@palm-ledger.invalid`,
        password,
        email_confirm: true,
      });
      if (result.error) throw new Error("Auth account could not be created");
      const id = result.data.user.id;
      try {
        await db.query(
          "insert into public.owner_accounts(id,username) values ($1,$2)",
          [id, username],
        );
        await audit(db, id, "owner.created", id, null, { username });
      } catch (error) {
        await supabase(true).auth.admin.deleteUser(id);
        throw error;
      }
      return id;
    }
    if (!current || current.username !== username)
      throw new Error("Owner not found");
    const result = await supabase(true).auth.admin.updateUserById(current.id, {
      password,
    });
    if (result.error) throw new Error("Auth password could not be reset");
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
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f") value = value.slice(0, -1);
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
  if (!["create", "reset"].includes(mode) || !name) {
    console.error(
      "Usage: owner.ts create|reset USERNAME (password from hidden prompt or stdin)",
    );
    process.exitCode = 1;
  } else
    readPassword()
      .then((password) =>
        manageOwner(mode as "create" | "reset", name, password),
      )
      .then(() => console.log("Owner updated. No credentials were printed."))
      .catch(() => {
        console.error(
          "Owner update failed. Check username, password length (12–128), service configuration and existing owner.",
        );
        process.exitCode = 1;
      })
      .finally(() => pool().end());
}
