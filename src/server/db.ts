import { Pool, type PoolClient } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const globalDb = globalThis as unknown as { palmPool?: Pool };
export async function closePool() {
  await globalDb.palmPool?.end();
}
export function databasePool(
  config: Record<string, string | undefined> = process.env,
) {
  let connectionString = config.DATABASE_URL || config.POSTGRES_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL or POSTGRES_URL is required");
  const certificatePath = join(process.cwd(), ".certificates/supabase-ca.crt");
  const ca =
    config.DATABASE_CA_CERT?.replaceAll("\\n", "\n") ||
    (existsSync(certificatePath)
      ? readFileSync(certificatePath, "utf8")
      : undefined);
  if (ca) {
    const url = new URL(connectionString);
    if (url.searchParams.has("sslcert") || url.searchParams.has("sslkey"))
      throw new Error(
        "Client TLS certificates require a separate database configuration",
      );
    // pg URL options otherwise override its explicit SSL object.
    for (const key of ["sslmode", "sslrootcert", "ssl", "uselibpqcompat"])
      url.searchParams.delete(key);
    connectionString = url.toString();
  }
  return new Pool({
    connectionString,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
}
export function pool() {
  return (globalDb.palmPool ??= databasePool());
}
export async function transaction<T>(
  work: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query("begin");
    const result = await work(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
