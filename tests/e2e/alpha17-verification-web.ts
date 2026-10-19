// Synthetic-only TLS front. Production Next authentication and HTTPS gates stay active.
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, lstat, realpath, mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import { createBrowserProxy } from "./alpha17-browser-proxy.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const origin = new URL("https://app.nexus.test:3150");
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root: string, file: string) => { const part = relative(root, file); return Boolean(part) && !part.startsWith("..") && !isAbsolute(part); };
const externalKeys = ["NEXUS_TEST_DATABASE_URL", "NEXUS_TEST_PG_PROVIDER_RECEIPT", "NEXUS_TEST_PROVIDER_RECEIPT_SHA256", "NEXUS_TEST_BOOTSTRAP_FILE"];
type Exit = { code: number | null; signal: NodeJS.Signals | null };

async function main() {
  if (externalKeys.some(key => Object.hasOwn(process.env, key))) throw new Error("TEST_EXTERNAL_PROVIDER_NOT_SUPPORTED");
  if ((process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? origin.origin) !== origin.origin ||
      (process.env.NEXUS_VERIFICATION_WEB_PORT ?? "3150") !== "3150" ||
      (process.env.NEXUS_VERIFICATION_API_PORT ?? "3151") !== "3151") throw new Error("TEST_ORIGIN_NOT_ALLOWED");
  for (const root of [repo, resolve(repo, "apps/web")]) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      const present = await lstat(resolve(root, name)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw new Error("TEST_ENV_METADATA_UNAVAILABLE");
      });
      if (present) throw new Error("ENV_FILE_PRESENT_DO_NOT_AUTOLOAD");
    }
  }
  const repoRoot = await realpath(repo), local = resolve(repoRoot, ".local");
  const localInfo = await lstat(local);
  if (!localInfo.isDirectory() || localInfo.isSymbolicLink() || !samePath(await realpath(local), local)) throw new Error("TEST_LOCAL_DIRECTORY_UNSAFE");
  const bootstrapPath = resolve(local, "verification-e2e.json"), bootstrapInfo = await lstat(bootstrapPath);
  if (!bootstrapInfo.isFile() || bootstrapInfo.isSymbolicLink() || bootstrapInfo.nlink !== 1 || bootstrapInfo.size > 4096 ||
      !samePath(await realpath(bootstrapPath), bootstrapPath)) throw new Error("TEST_BOOTSTRAP_UNSAFE");
  let bootstrap: unknown;
  try { bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8")); } catch { throw new Error("TEST_BOOTSTRAP_INVALID"); }
  if (!bootstrap || typeof bootstrap !== "object" || Object.keys(bootstrap).length !== 1 || !("databaseUrl" in bootstrap) ||
      typeof bootstrap.databaseUrl !== "string") throw new Error("TEST_BOOTSTRAP_INVALID");
  const databaseUrl = bootstrap.databaseUrl;
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error("TEST_DATABASE_NOT_ALLOWED"); }
  if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.username !== "nexus" || database.password !== "nexus" ||
      database.pathname !== "/postgres" || !/^\d+$/.test(database.port) || Number(database.port) < 1024 || Number(database.port) > 65535 ||
      database.search || database.hash) throw new Error("TEST_DATABASE_NOT_ALLOWED");

  let tlsDirectory: string | undefined;
  let tlsIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket; };
  const servers: (http.Server | https.Server)[] = [];
  const owned: { child: ChildProcess; closed: Promise<Exit> }[] = [];
  let stopping = false, failure: string | undefined, cancellation: "SIGINT" | "SIGTERM" | undefined, nextExit: Exit | undefined;
  let finish!: () => void;
  const lifetime = new Promise<void>(accept => { finish = accept; });
  const own = (child: ChildProcess, code: string) => {
    const closed = new Promise<Exit>(accept => {
      child.once("error", () => { failure = code; finish(); });
      child.once("close", (exitCode, signal) => accept({ code: exitCode, signal }));
    });
    const entry = { child, closed };
    owned.push(entry);
    return entry;
  };
  const cancel = (signal: "SIGINT" | "SIGTERM") => {
    cancellation ??= signal;
    for (const { child } of owned) if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    finish();
  };
  const onInt = () => cancel("SIGINT"), onTerm = () => cancel("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const waitClosed = async (closed: Promise<Exit>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([closed.then(() => true), new Promise<false>(accept => { timer = setTimeout(() => accept(false), 5000); })]); }
    finally { clearTimeout(timer); }
  };
  const cleanup = async () => {
    stopping = true;
    for (const socket of sockets) socket.destroy();
    for (const server of [...servers].reverse()) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>(accept => server.close(() => accept()));
    }
    for (const { child, closed } of [...owned].reverse()) {
      if (child.exitCode === null && child.signalCode === null) child.kill(cancellation ?? "SIGTERM");
      if (!await waitClosed(closed)) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (!await waitClosed(closed)) throw new Error("TEST_OWNED_CHILD_STOP_UNCONFIRMED");
      }
    }
    // Delete only our exact mkdtemp inode and its two fixed ordinary files. No recursive deletion.
    const directory = tlsDirectory, identity = tlsIdentity;
    if (!directory) return;
    const current = await lstat(directory);
    if (!identity || !inside(local, directory) || dirname(directory) !== local || !current.isDirectory() || current.isSymbolicLink() ||
        current.dev !== identity.dev || current.ino !== identity.ino || !samePath(await realpath(directory), directory)) throw new Error("TEST_TLS_DIRECTORY_OWNER_UNCONFIRMED");
    for (const name of await readdir(directory)) {
      if (!["cert.pem", "key.pem"].includes(name)) throw new Error("TEST_TLS_DIRECTORY_UNEXPECTED_FILE");
      const file = join(directory, name);
      await verifyTlsFile(file);
      await unlink(file);
    }
    await rmdir(directory);
  };
  const listen = async (server: http.Server | https.Server, port: number) => {
    servers.push(server);
    server.on("connection", track);
    await new Promise<void>((accept, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        server.on("error", () => { failure = "TEST_LOOPBACK_SERVER_FAILED"; finish(); });
        accept();
      });
    });
  };
  const verifyTlsFile = async (file: string) => {
    const info = await lstat(file);
    if (!tlsDirectory || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !samePath(await realpath(file), file) || !inside(tlsDirectory, file)) throw new Error("TEST_TLS_FILE_UNSAFE");
  };
  try {
    tlsDirectory = await mkdtemp(join(local, "alpha17-tls-"));
    tlsIdentity = await lstat(tlsDirectory);
    if (cancellation) return;
    const certificate = join(tlsDirectory, "cert.pem"), privateKey = join(tlsDirectory, "key.pem");
    const maker = own(spawn("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=app.nexus.test",
      "-addext", "subjectAltName=DNS:app.nexus.test,IP:127.0.0.1", "-keyout", privateKey, "-out", certificate],
    { cwd: repo, windowsHide: true, shell: false, stdio: "ignore" }), "TEST_OPENSSL_UNAVAILABLE");
    const generated = await maker.closed;
    if (cancellation) return;
    if (failure || generated.code !== 0 || generated.signal) throw new Error(failure ?? "TEST_SYNTHETIC_CERTIFICATE_FAILED");
    await Promise.all([verifyTlsFile(certificate), verifyTlsFile(privateKey)]);
    const [cert, key] = await Promise.all([readFile(certificate), readFile(privateKey)]);
    if (cancellation) return;
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const name of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CI"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    Object.assign(env, {
      NODE_ENV: "production", DATABASE_URL: databaseUrl,
      NODE_OPTIONS: `--require="${resolve(repo, "tests/e2e/verification-fetch.cjs").replaceAll("\\", "/")}"`,
      NEXUS_VERIFICATION_WEB_PORT: "3150", NEXUS_VERIFICATION_API_PORT: "3151", NEXUS_VERIFICATION_WEB_ORIGIN: origin.origin,
      IDENTITY_KEY: "aa".repeat(32), LOOKUP_KEY: "bb".repeat(32), COMPONENT_KEY: "verification-components",
      DISCORD_TOKEN: "verification-bot", DISCORD_APPLICATION_ID: "941111111111111111", DISCORD_CLIENT_SECRET: "verification-client",
      NEXUS_SESSION_SECRET: "s".repeat(64), NEXUS_WEB_URL: origin.origin, NEXUS_WEB_AUTH_MODE: "oauth", NEXUS_HOSTED_BETA: "on",
      NEXUS_API_URL: "http://127.0.0.1:3153", API_KEY: "verification-api-key", NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_DISCORD_BILLING_ENABLED: "false", NEXUS_BILLING_DEVELOPER_COUNTRY: "JP", NEXUS_INTERNAL_ADMIN_IDS: "911111111111111111",
    });
    const next = own(spawn(process.execPath, [resolve(repo, "apps/web/node_modules/next/dist/bin/next"), "start", "--port", "3152", "--hostname", "127.0.0.1"],
      { cwd: resolve(repo, "apps/web"), env, windowsHide: true, shell: false, stdio: "inherit" }), "TEST_NEXT_START_FAILED");
    void next.closed.then(exit => { nextExit = exit; if (!stopping) { if (!cancellation) failure = "TEST_NEXT_EARLY_EXIT"; finish(); } });
    const front = https.createServer({ key, cert }, (request, response) => {
      const upstream = http.request({ hostname: "127.0.0.1", port: 3152, method: request.method, path: request.url, headers: request.headers }, incoming => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on("socket", track);
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.on("aborted", () => upstream.destroy());
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    });
    const readiness = http.createServer((_request, response) => {
      const check = https.get({ hostname: "127.0.0.1", port: 3150, servername: origin.hostname, headers: { Host: origin.host }, path: "/", ca: cert, rejectUnauthorized: true, timeout: 3000 }, checked => {
        checked.resume();
        response.writeHead(checked.statusCode === 200 ? 200 : 503);
        response.end();
      });
      check.on("socket", track);
      check.on("error", () => { if (!response.headersSent) response.writeHead(503); response.end(); });
      check.on("timeout", () => check.destroy(new Error("TEST_HTTPS_READINESS_TIMEOUT")));
    });
    await listen(front, 3150);
    if (cancellation) return;
    await listen(readiness, 3154);
    if (cancellation) return;
    await listen(createBrowserProxy(track), 3155);
    await lifetime;
    if (failure) throw new Error(failure);
  } finally {
    try { await cleanup(); }
    finally { process.off("SIGINT", onInt); process.off("SIGTERM", onTerm); }
    if (cancellation) process.exitCode = cancellation === "SIGINT" ? 130 : 143;
    else if (nextExit) process.exitCode = nextExit.code ?? 1;
  }
}
void main().catch(error => {
  const code = error instanceof Error && /^(?:TEST_[A-Z_]+|ENV_FILE_PRESENT_DO_NOT_AUTOLOAD)$/.test(error.message) ? error.message : "TEST_HTTPS_FIXTURE_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
