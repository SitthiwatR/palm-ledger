// JavaScript actions receive GitHub's short-lived artifact runtime credentials.
// A normal shell step does not reliably receive that context. Keep the complete
// worker in this action so the official artifact SDK can upload/download safely.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
try {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (
    !workspace ||
    !process.env.ACTIONS_RUNTIME_TOKEN ||
    !process.env.ACTIONS_RESULTS_URL
  ) {
    throw new Error("Missing Actions artifact runtime");
  }
  execFileSync(
    process.execPath,
    [
      join(workspace, "node_modules/tsx/dist/cli.mjs"),
      join(workspace, "scripts/automatic-backup.ts"),
    ],
    {
      cwd: workspace,
      env: process.env,
      stdio: "inherit",
    },
  );
} catch {
  console.error(
    "Automatic backup action failed; inspect the private run. No credentials were logged.",
  );
  process.exitCode = 1;
}
