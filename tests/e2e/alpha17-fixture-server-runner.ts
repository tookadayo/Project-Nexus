// Test-only owner boundary: Playwright signals this process group, not native PG.
import { spawn, execFile } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { superviseFixtureOwner } from "./alpha17-fixture-shutdown.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = process.argv[2];
if (entry !== "verification" && entry !== "checkout") throw new Error("TEST_FIXTURE_ENTRY_NOT_ALLOWED");
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CI",
  "NEXUS_VERIFICATION_API_PORT", "NEXUS_VERIFICATION_WEB_PORT", "NEXUS_VERIFICATION_WEB_ORIGIN", "NEXUS_CHECKOUT_API_PORT", "NEXUS_CHECKOUT_WEB_PORT", "NEXUS_CHECKOUT_WEB_ORIGIN", "NEXUS_TEST_RUN_ID", "NEXUS_TEST_FIXTURE_RECEIPT",
  "NEXUS_TEST_DATABASE_URL", "NEXUS_TEST_PG_PROVIDER_RECEIPT", "NEXUS_TEST_PROVIDER_RECEIPT_SHA256", "NEXUS_TEST_BOOTSTRAP_FILE"]) {
  if (process.env[key]) env[key] = process.env[key];
}
// Direct Node entry keeps the IPC channel on the JS owner, without a tsx CLI child.
const child = spawn(process.execPath, ["--import", pathToFileURL(resolve(repo, "node_modules/tsx/dist/loader.mjs")).href,
  resolve(repo, `tests/e2e/${entry}-server.ts`)], {
  cwd: repo, env, detached: process.platform !== "win32", windowsHide: true, shell: false,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
// Only the runner holds Playwright's pipes. A detached owner cannot keep them
// open after a bounded, explicitly unconfirmed runner failure.
child.stdout?.pipe(process.stdout, { end: false }); child.stderr?.pipe(process.stderr, { end: false });
async function forceOwnedStop() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((accept, reject) => execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"],
      { windowsHide: true }, error => error ? reject(new Error("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED")) : accept()));
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) throw new Error("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED", { cause: error }); }
  }
}
void superviseFixtureOwner(child, process, forceOwnedStop).then(code => {
  if (code) process.stderr.write("TEST_FIXTURE_OWNER_FAILED\n");
  process.exitCode = code;
}, () => {
  process.stderr.write(`TEST_OWNED_FIXTURE_STOP_UNCONFIRMED ownerPid=${child.pid ?? "NOT_STARTED"}\n`);
  // Bounded non-success even if child handles keep the runner alive. Exiting
  // disconnects IPC and gives the owner its parent-loss cleanup path as well.
  // This path explicitly cannot certify that the OS stopped its resources.
  child.stdout?.destroy(); child.stderr?.destroy();
  try { if (child.connected) child.disconnect(); } finally { process.exit(1); }
});
