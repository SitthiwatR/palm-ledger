import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  AppError,
  SESSION_COOKIE,
  SESSION_SECONDS,
  authenticate,
  audit,
  hash,
  login,
  type Owner,
} from "./auth";
import { pool, transaction } from "./db";

const uuid = z.uuid();
const name = z
  .string()
  .trim()
  .min(1, "กรุณากรอกชื่อสวน")
  .max(80, "ชื่อสวนยาวไม่เกิน 80 ตัวอักษร");
const opening = z.number().int().min(-99999999999).max(99999999999);
const createGarden = z.object({ name, openingMinor: opening }).strict();
const patchGarden = z
  .object({
    name: name.optional(),
    openingMinor: opening.optional(),
    archived: z.boolean().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.openingMinor !== undefined ||
      v.archived !== undefined,
  );
const credentials = z
  .object({
    username: z.string().min(1).max(80),
    password: z.string().min(1).max(128),
  })
  .strict();
function garden(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    openingMinor: Number(row.opening_minor),
    archived: row.archived,
    version: row.version,
  };
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function body(req: NextRequest) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "JSON_REQUIRED", "กรุณาส่งข้อมูล JSON");
  if (Number(req.headers.get("content-length")) > 8192)
    throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลใหญ่เกินไป");
  const reader = req.body?.getReader();
  if (!reader)
    throw new AppError(422, "INVALID_JSON", "กรุณาส่งข้อมูลที่ต้องการบันทึก");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลใหญ่เกินไป");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(422, "INVALID_JSON", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
}
async function assertOwner(db: PoolClient, owner: Owner) {
  const row = (
    await db.query(
      "select auth_epoch from public.owner_accounts where id=$1 for share",
      [owner.id],
    )
  ).rows[0];
  if (!row || row.auth_epoch !== owner.auth_epoch)
    throw new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบใหม่");
}
async function writeGarden(req: NextRequest, owner: Owner, id?: string) {
  const input = id
    ? patchGarden.parse(await body(req))
    : createGarden.parse(await body(req));
  const key = req.headers.get("idempotency-key");
  if (!key || !uuid.safeParse(key).success)
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "กรุณาระบุรหัสคำขอบันทึก",
    );
  const fingerprint = hash(JSON.stringify({ method: req.method, id, input }));
  const data = await transaction(async (db) => {
    await assertOwner(db, owner);
    // Serialize retries for one key, including the first insert, across app instances.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner.id + key,
    ]);
    const previous = (
      await db.query(
        "select * from private.idempotency_requests where owner_id=$1 and key=$2",
        [owner.id, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว",
        );
      return previous.response;
    }
    let before = null,
      result;
    if (id) {
      const patch = input as z.infer<typeof patchGarden>;
      before = (
        await db.query(
          "select * from public.gardens where id=$1 and owner_id=$2 for update",
          [id, owner.id],
        )
      ).rows[0];
      if (!before) throw new AppError(404, "NOT_FOUND", "ไม่พบสวน");
      if (before.version !== patch.expectedVersion)
        throw new AppError(
          409,
          "STALE_VERSION",
          "ข้อมูลเปลี่ยนจากอีกหน้าจอ กรุณาโหลดข้อมูลล่าสุด",
        );
      result = (
        await db.query(
          `update public.gardens set name=$3,opening_minor=$4,archived=$5,version=version+1,updated_at=now()
        where id=$1 and owner_id=$2 returning *`,
          [
            id,
            owner.id,
            patch.name ?? before.name,
            patch.openingMinor ?? before.opening_minor,
            patch.archived ?? before.archived,
          ],
        )
      ).rows[0];
    } else {
      const create = input as z.infer<typeof createGarden>;
      result = (
        await db.query(
          "insert into public.gardens(owner_id,name,opening_minor) values ($1,$2,$3) returning *",
          [owner.id, create.name, create.openingMinor],
        )
      ).rows[0];
    }
    await audit(
      db,
      owner.id,
      id ? "garden.updated" : "garden.created",
      result.id,
      before,
      result,
    );
    const response = garden(result);
    await db.query(
      "insert into private.idempotency_requests(owner_id,key,request_hash,response) values ($1,$2,$3,$4)",
      [owner.id, key, fingerprint, JSON.stringify(response)],
    );
    return response;
  });
  return json(data, id ? 200 : 201);
}
export async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path,
      route = path.join("/"),
      method = req.method;
    if (!["GET", "HEAD"].includes(method)) {
      const expected = process.env.APP_URL;
      if (!expected) throw new Error("APP_URL is required");
      if (req.headers.get("origin") !== new URL(expected).origin)
        throw new AppError(
          403,
          "INVALID_ORIGIN",
          "ไม่สามารถส่งข้อมูลจากหน้านี้ได้",
        );
    }
    if (route === "session" && method === "POST") {
      const input = credentials.parse(await body(req));
      const result = await login(input.username, input.password);
      const response = json({ username: result.owner.username });
      response.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: new URL(process.env.APP_URL!).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_SECONDS,
      });
      return response;
    }
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (route === "session" && method === "DELETE") {
      if (token)
        await pool().query(
          "delete from private.owner_sessions where token_hash=$1",
          [hash(token)],
        );
      const response = json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
        secure: new URL(process.env.APP_URL!).protocol === "https:",
      });
      return response;
    }
    const owner = await authenticate(token);
    if (route === "session" && method === "GET")
      return json({ username: owner.username });
    if (route === "summary" && method === "GET") {
      const rows = await pool().query(
        "select coalesce(sum(opening_minor),0)::text as total,count(*)::int as count from public.gardens where owner_id=$1",
        [owner.id],
      );
      return json({
        netMinor: Number(rows.rows[0].total),
        gardenCount: rows.rows[0].count,
      });
    }
    if (route === "gardens" && method === "GET") {
      const rows = await pool().query(
        "select * from public.gardens where owner_id=$1 order by archived,name,id",
        [owner.id],
      );
      return json({ gardens: rows.rows.map(garden) });
    }
    if (route === "gardens" && method === "POST")
      return await writeGarden(req, owner);
    if (path.length === 2 && path[0] === "gardens") {
      const id = uuid.parse(path[1]);
      if (method === "PATCH") return await writeGarden(req, owner, id);
      if (method === "GET") {
        const row = (
          await pool().query(
            "select * from public.gardens where id=$1 and owner_id=$2",
            [id, owner.id],
          )
        ).rows[0];
        if (!row) throw new AppError(404, "NOT_FOUND", "ไม่พบสวน");
        return json(garden(row));
      }
    }
    throw new AppError(404, "NOT_FOUND", "ไม่พบหน้าที่ต้องการ");
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fields = Object.fromEntries(
        error.issues.map((i) => [i.path.join("."), i.message]),
      );
      return json(
        {
          error: {
            code: "VALIDATION",
            message: "กรุณาตรวจข้อมูลที่กรอก",
            fields,
          },
        },
        422,
      );
    }
    if (error instanceof AppError)
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
          },
        },
        error.status,
      );
    if ((error as { code?: string }).code === "23505")
      return json(
        {
          error: {
            code: "DUPLICATE_NAME",
            message: "มีสวนชื่อนี้อยู่แล้ว",
            fields: { name: "กรุณาใช้ชื่อสวนอื่น" },
          },
        },
        409,
      );
    // Never log DB parameters, credentials, tokens or request bodies.
    console.error(
      "API request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่ ข้อมูลที่กรอกยังอยู่",
        },
      },
      500,
    );
  }
}
