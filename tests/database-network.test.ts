import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { probePostgresTls } from "../scripts/check-database-network";

async function withServer(
  handle: (socket: Socket) => void,
  run: (port: number) => Promise<void>,
) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    handle(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(address.port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("network probe distinguishes an open TCP port from a stalled PostgreSQL SSL negotiation", async () => {
  let request: Buffer | undefined;
  await withServer(
    (socket) => {
      socket.once("data", (data) => {
        request = typeof data === "string" ? Buffer.from(data) : data;
      });
    },
    async (port) => {
      const progress: string[] = [];
      await assert.rejects(
        probePostgresTls(
          "127.0.0.1",
          port,
          undefined,
          (line) => progress.push(line),
          500,
        ),
        /PostgreSQL SSL negotiation failed/,
      );
      assert.deepEqual(progress, [
        "TCP: OK",
        "PostgreSQL SSL negotiation: waiting",
      ]);
      assert.equal(request?.toString("hex"), "0000000804d2162f");
    },
  );
});

test("network probe refuses a server that does not accept PostgreSQL TLS", async () => {
  await withServer(
    (socket) => {
      socket.once("data", () => socket.write("N"));
    },
    async (port) => {
      await assert.rejects(
        probePostgresTls("127.0.0.1", port, undefined, () => {}, 1000),
        /PostgreSQL SSL negotiation failed/,
      );
    },
  );
});

test("network probe reports the TLS stage when PostgreSQL accepts SSL but the handshake fails", async () => {
  await withServer(
    (socket) => {
      socket.once("data", () => {
        socket.write("S");
        socket.once("data", () => socket.write("invalid TLS response"));
      });
    },
    async (port) => {
      const progress: string[] = [];
      await assert.rejects(
        probePostgresTls(
          "127.0.0.1",
          port,
          undefined,
          (line) => progress.push(line),
          1000,
        ),
        /TLS verification failed/,
      );
      assert.ok(progress.includes("PostgreSQL SSL negotiation: OK"));
      assert.ok(!progress.includes("TLS verification: OK"));
    },
  );
});
