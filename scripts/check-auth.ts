import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { supabase } from "../src/server/auth";
import { databaseErrorDetails } from "./database-diagnostics";

export function authConfigSummary(env: Record<string, string | undefined>) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const host = env.SUPABASE_URL
    ? new URL(env.SUPABASE_URL).hostname
    : "missing";
  const result: Record<string, unknown> = {
    host,
    keyPresent: Boolean(key),
    keyHasOuterWhitespace: key !== key.trim(),
    keyType: key.startsWith("sb_secret_")
      ? "secret"
      : key.startsWith("sb_publishable_")
        ? "publishable (not admin)"
        : "unrecognized",
  };
  if (key.split(".").length === 3) {
    try {
      const claims = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString("utf8"),
      );
      result.keyType = "JWT (claims below are unverified)";
      result.claimedRole =
        claims.role === "service_role"
          ? "service_role"
          : claims.role === "anon"
            ? "anon (not admin)"
            : "other/missing";
      result.claimedProjectMatches =
        typeof claims.ref === "string"
          ? claims.ref === host.split(".")[0]
          : "no project claim";
      result.claimedExpired =
        typeof claims.exp === "number"
          ? claims.exp <= Date.now() / 1000
          : "no expiry claim";
    } catch {
      result.keyType = "malformed JWT";
    }
  }
  return result;
}

export function authEnvFileMatches(
  file: string,
  env: Record<string, string | undefined>,
) {
  const expected = parseEnv(file);
  return Object.fromEntries(
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [
      key,
      expected[key] === undefined ? "not in file" : expected[key] === env[key],
    ]),
  );
}

async function checkAuth() {
  console.log(
    "Auth configuration:",
    JSON.stringify(authConfigSummary(process.env)),
  );
  const args = process.execArgv;
  const inline = args.find((arg) => arg.startsWith("--env-file="));
  const position = args.indexOf("--env-file");
  const file =
    inline?.slice("--env-file=".length) ||
    (position >= 0 ? args[position + 1] : undefined);
  if (file) {
    const matches = authEnvFileMatches(readFileSync(file, "utf8"), process.env);
    console.log("Runtime matches selected env file:", JSON.stringify(matches));
    if (Object.values(matches).includes(false))
      console.log(
        "An inherited environment variable overrides the selected file. Clear the conflicting variable in this terminal and retry.",
      );
  }
  // Discard all returned user data; this request only checks admin authorization.
  const { error } = await supabase(true).auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) throw error;
  console.log(
    "Supabase Auth admin access: OK (read-only check; no account created).",
  );
  if (process.argv.includes("--public-settings")) {
    const response = await fetch(
      new URL("/auth/v1/settings", process.env.SUPABASE_URL),
      {
        headers: {
          apikey:
            process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Could not verify public Auth settings");
    const settings = await response.json();
    const summary = {
      signupDisabled: settings.disable_signup === true,
      anonymousEnabled: settings.external?.anonymous_users === true,
    };
    console.log("Public Auth settings:", JSON.stringify(summary));
    if (!summary.signupDisabled || summary.anonymousEnabled)
      throw new Error(
        "Owner-only release requires public signup and anonymous sign-in disabled in Supabase Auth settings",
      );
  }
}

if (process.argv[1]?.endsWith("check-auth.ts")) {
  checkAuth().catch((error) => {
    console.error(
      "Auth check failed:",
      JSON.stringify(databaseErrorDetails(error)),
    );
    process.exitCode = 1;
  });
}
