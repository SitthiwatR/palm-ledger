import { connect as connectTcp, isIP } from "node:net";
import {
  connect as connectTls,
  checkServerIdentity,
  type ConnectionOptions,
} from "node:tls";
import { pool, closePool } from "../src/server/db";
import { databaseErrorDetails } from "./database-diagnostics";

/** PostgreSQL starts with a protocol-specific SSL request, before sending credentials. */
export function probePostgresTls(
  host: string,
  port: number,
  ca: ConnectionOptions["ca"],
  report: (message: string) => void,
  timeoutMs = 15_000,
) {
  return new Promise<void>((resolve, reject) => {
    let stage = "TCP";
    let secure: ReturnType<typeof connectTls> | undefined;
    let settled = false;
    const socket = connectTcp({ host, port });
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      secure?.destroy();
      socket.destroy();
      reject(new Error(`${stage} failed`, { cause: error }));
    }
    socket.setTimeout(timeoutMs, () => fail(new Error("Stage timed out")));
    socket.on("error", fail);
    socket.on("end", () => fail(new Error("Server closed the connection")));
    socket.once("connect", () => {
      report("TCP: OK");
      stage = "PostgreSQL SSL negotiation";
      report(`${stage}: waiting`);
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4);
      socket.write(request);
    });
    socket.once("data", (data) => {
      if (data.length !== 1 || data[0] !== 83) {
        fail(new Error("Server did not accept the PostgreSQL SSL request"));
        return;
      }
      report("PostgreSQL SSL negotiation: OK");
      stage = "TLS verification";
      report(`${stage}: waiting`);
      try {
        secure = connectTls({
          socket,
          servername: isIP(host) ? undefined : host,
          checkServerIdentity: (_servername, certificate) =>
            checkServerIdentity(host, certificate),
          ca,
          rejectUnauthorized: true,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error("TLS setup failed"));
        return;
      }
      secure.setTimeout(timeoutMs, () => fail(new Error("Stage timed out")));
      secure.on("error", fail);
      secure.once("secureConnect", () => {
        settled = true;
        report("TLS verification: OK");
        secure?.destroy();
        resolve();
      });
    });
  });
}

async function checkNetwork() {
  const connection = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connection) throw new Error("DATABASE_URL or POSTGRES_URL is missing");
  const url = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Expected a PostgreSQL connection URI");
  const port = Number(url.port || 5432);
  console.log("Target:", JSON.stringify({ host: url.hostname, port }));
  if (process.env.SUPABASE_URL) {
    const project = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
    if (url.hostname.endsWith(".pooler.supabase.com"))
      console.log(
        "Pooler username matches Supabase project:",
        decodeURIComponent(url.username) === `postgres.${project}`,
      );
    if (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co"))
      console.log(
        "Direct database matches Supabase project:",
        url.hostname === `db.${project}.supabase.co`,
      );
  }
  const db = pool();
  const ssl = db.options.ssl;
  const ca = ssl && typeof ssl === "object" ? ssl.ca : undefined;
  await probePostgresTls(url.hostname, port, ca, console.log);
  // This read-only diagnostic allows more time than the application's 5s default.
  db.options.connectionTimeoutMillis = 30_000;
  db.options.query_timeout = 15_000;
  console.log(
    "PostgreSQL authentication/query: waiting (up to 30s to connect)",
  );
  const result = await db.query(
    "select exists(select 1 from public.owner_accounts) as configured",
  );
  console.log("PostgreSQL authentication/query: OK");
  console.log(
    "Owner login:",
    result.rows[0].configured ? "configured" : "not configured yet",
  );
}

if (process.argv[1]?.endsWith("check-database-network.ts")) {
  checkNetwork()
    .catch((error) => {
      console.error(
        "Network check failed:",
        JSON.stringify(databaseErrorDetails(error)),
      );
      process.exitCode = 1;
    })
    .finally(closePool);
}
