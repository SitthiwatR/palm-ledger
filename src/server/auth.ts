import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { transaction } from "./db";

export const SESSION_COOKIE = "palm_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export function supabase(admin = false) {
  const url = process.env.SUPABASE_URL;
  const key = admin
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export function normalizedUsername(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function encryptionKey() {
  const value = process.env.SESSION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be 32 random bytes in hexadecimal",
    );
  return Buffer.from(value, "hex");
}
function seal(tokens: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function unseal(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  ) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
}
export type Owner = { id: string; username: string; auth_epoch: number };
export async function login(username: string, password: string) {
  const result = await transaction(async (db) => {
    const key = hash(normalizedUsername(username));
    await db.query(
      "insert into private.login_attempts(key) values ($1) on conflict do nothing",
      [key],
    );
    const attempt = (
      await db.query(
        "select * from private.login_attempts where key=$1 for update",
        [key],
      )
    ).rows[0];
    const recent =
      Date.now() - new Date(attempt.window_start).getTime() < 15 * 60 * 1000;
    if (recent && attempt.failures >= 5) return { blocked: true } as const;
    const owner = (
      await db.query<Owner>(
        "select id, username, auth_epoch from public.owner_accounts where username=$1 for update",
        [normalizedUsername(username)],
      )
    ).rows[0];
    let tokens;
    if (owner) {
      const user = await supabase(true).auth.admin.getUserById(owner.id);
      if (user.error) throw new Error("Unable to resolve owner identity");
      const auth = await supabase().auth.signInWithPassword({
        email: user.data.user.email!,
        password,
      });
      if (!auth.error && auth.data.session) tokens = auth.data.session;
    }
    if (!owner || !tokens) {
      await db.query(
        "update private.login_attempts set failures=$2, window_start=$3 where key=$1",
        [
          key,
          recent ? attempt.failures + 1 : 1,
          recent ? attempt.window_start : new Date(),
        ],
      );
      return { invalid: true } as const;
    }
    await db.query("delete from private.login_attempts where key=$1", [key]);
    await db.query(
      "delete from private.owner_sessions where expires_at <= now()",
    );
    const token = randomBytes(32).toString("hex");
    await db.query(
      "insert into private.owner_sessions(token_hash,owner_id,auth_epoch,sealed_tokens,expires_at) values ($1,$2,$3,$4,$5)",
      [
        hash(token),
        owner.id,
        owner.auth_epoch,
        seal(tokens),
        new Date(Date.now() + SESSION_SECONDS * 1000),
      ],
    );
    return { token, owner } as const;
  });
  if ("blocked" in result)
    throw new AppError(
      429,
      "RATE_LIMIT",
      "ลองเข้าสู่ระบบหลายครั้งแล้ว กรุณารอ 15 นาที",
    );
  if ("invalid" in result)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    );
  return result;
}
export async function authenticate(token: string | undefined): Promise<Owner> {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ");
  const owner = await transaction(async (db) => {
    const row = (
      await db.query(
        `select s.*,o.username,o.auth_epoch as current_epoch from private.owner_sessions s
      join public.owner_accounts o on o.id=s.owner_id where token_hash=$1 for update of s`,
        [hash(token)],
      )
    ).rows[0];
    if (!row) return null;
    if (
      new Date(row.expires_at).getTime() <= Date.now() ||
      row.auth_epoch !== row.current_epoch
    ) {
      await db.query("delete from private.owner_sessions where token_hash=$1", [
        hash(token),
      ]);
      return null;
    }
    let tokens = unseal(row.sealed_tokens);
    const client = supabase();
    if (tokens.expires_at * 1000 < Date.now() + 60000) {
      const refreshed = await client.auth.refreshSession({
        refresh_token: tokens.refresh_token,
      });
      if (refreshed.error || !refreshed.data.session) {
        await db.query(
          "delete from private.owner_sessions where token_hash=$1",
          [hash(token)],
        );
        return null;
      }
      tokens = refreshed.data.session as typeof tokens;
      await db.query(
        "update private.owner_sessions set sealed_tokens=$2 where token_hash=$1",
        [hash(token), seal(tokens)],
      );
    }
    const user = await client.auth.getUser(tokens.access_token);
    if (user.error || user.data.user.id !== row.owner_id) return null;
    return {
      id: row.owner_id,
      username: row.username,
      auth_epoch: row.current_epoch,
    };
  });
  if (!owner)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    );
  return owner;
}
export async function audit(
  db: PoolClient,
  ownerId: string,
  action: string,
  id: string | null,
  before: unknown,
  after: unknown,
) {
  await db.query(
    "insert into public.audit_events(owner_id,action,entity_id,before_data,after_data) values ($1,$2,$3,$4,$5)",
    [
      ownerId,
      action,
      id,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  );
}
