import { Pool, type PoolClient } from "pg";

const globalDb = globalThis as unknown as { palmPool?: Pool };
export function pool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL or POSTGRES_URL is required");
  return (globalDb.palmPool ??= new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  }));
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
