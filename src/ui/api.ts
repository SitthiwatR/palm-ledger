type Failure = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};
export class RequestError extends Error {
  constructor(
    public info: Failure,
    public status: number,
  ) {
    super(info.message);
  }
}
export async function api(
  path: string,
  method = "GET",
  data?: unknown,
  key?: string,
) {
  const response = await fetch("/api/v1/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && window.location.pathname !== "/login")
      window.location.replace("/login");
    throw new RequestError(result.error, response.status);
  }
  return result;
}
export function message(error: unknown) {
  return error instanceof RequestError
    ? error.message
    : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ ข้อมูลที่กรอกยังอยู่";
}
