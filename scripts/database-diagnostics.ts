/** Describe service failures without logging URLs, passwords or error stacks. */
export function databaseErrorDetails(
  error: unknown,
  hiddenValues: string[] = [],
) {
  const secrets = new Set(hiddenValues.filter(Boolean));
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      /TOKEN|KEY|SECRET|PASSWORD|DATABASE_URL|POSTGRES_URL/i.test(name)
    )
      secrets.add(value);
  }
  for (const connection of [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ]) {
    if (!connection) continue;
    try {
      const url = new URL(connection);
      if (url.password) {
        secrets.add(url.password);
        secrets.add(decodeURIComponent(url.password));
      }
    } catch {
      // The complete invalid URL is already redacted above.
    }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  function redact(value: string) {
    for (const secret of ordered)
      value = value.replaceAll(secret, "[REDACTED]");
    return value
      .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, "[REDACTED URL]")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED TOKEN]")
      .replace(/sb_(?:secret|publishable)_[\w-]+/g, "[REDACTED KEY]")
      .slice(0, 1000);
  }
  const details: Record<string, string>[] = [];
  const seen = new Set<object>();
  function visit(value: unknown) {
    if (
      details.length >= 6 ||
      typeof value !== "object" ||
      !value ||
      seen.has(value)
    )
      return;
    seen.add(value);
    const fields: Record<string, string> = {};
    for (const key of [
      "name",
      "code",
      "status",
      "message",
      "syscall",
    ] as const) {
      if (key in value) {
        const field = (value as Record<string, unknown>)[key];
        if (typeof field === "string") fields[key] = redact(field);
        else if (
          key === "status" &&
          typeof field === "number" &&
          Number.isFinite(field)
        )
          fields[key] = String(field);
      }
    }
    details.push(fields);
    if ("cause" in value) visit(value.cause);
    if ("errors" in value && Array.isArray(value.errors))
      for (const child of value.errors) visit(child);
  }
  visit(error);
  return details;
}
