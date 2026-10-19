import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/** A transport to a private, quarantined directory only. This module has no
 * StaticPublisher interface, active pointer, rename, delete, chmod or live-root
 * write. STAGED_VERIFIED never means an announcement has been published. */
const hash = z.string().regex(/^[a-f0-9]{64}$/);
function unsafeScriptValue(value: string) { return [...value].some(character => character.charCodeAt(0) < 32) || /["%*?<>|]/.test(value); }
const localPath = z.string().min(1).max(1000).refine(value => isAbsolute(value) && !unsafeScriptValue(value));
const remotePath = z.string().max(400).regex(/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/)
  .refine(value => value.split("/").every(part => part !== "." && part !== ".."));
const timestamp = z.iso.datetime({ offset: false });
const transport = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("SFTP"), fingerprint: z.string().regex(/^ssh-(?:ed25519|rsa) \d{2,5} [A-Za-z0-9+/]{43}=?$/) }).strict(),
  z.object({ protocol: z.literal("FTPS_EXPLICIT"), fingerprint: z.string().regex(/^(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}$/) }).strict(),
]);
export const winScpStagingConfigSchema = z.object({
  schemaVersion: z.literal(1),
  consoleExecutable: localPath, consoleSha256: hash,
  engineExecutable: localPath, engineSha256: hash,
  /** Existing dedicated, read-only, protected INI. Only stat is used here; the
   * application never reads, copies or exports its content or saved password. */
  sessionIni: localPath,
  savedSite: z.string().max(150).regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/),
  host: z.string().max(253).regex(/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  port: z.number().int().min(1).max(65535), transport,
  privateStagingRoot: remotePath,
  publicDocumentRoots: z.array(remotePath).min(1).max(20),
  approvedManifestSha256: hash,
  /** Pins the exact reviewed public output, including legal/contact content.
   * Merely being in the file allowlist does not approve personal information. */
  reviewReference: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/),
  reviewExpiresAt: timestamp,
  timeoutMs: z.number().int().min(1000).max(300000).default(120000),
}).strict();
export type WinScpStagingConfig = z.infer<typeof winScpStagingConfigSchema>;
const manifestSchema = z.object({ schemaVersion: z.literal(1), generation: z.number().safe().int().positive(), generatedAt: timestamp,
  files: z.array(z.object({ path: z.string().max(220), sha256: hash }).strict()).min(1).max(5000) }).strict();

const staticPaths = new Set(["index.html", "404.html", "en/index.html", "product/index.html", "en/product/index.html", "demo/index.html", "en/demo/index.html",
  "pricing/index.html", "en/pricing/index.html", "pricing/snapshot.json", "announcements/index.html", "status/index.html", "status/status.json", "version.json"]);
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const announcementPath = new RegExp(`^announcements/${uuid}-[1-9][0-9]*-[0-9a-f]{16}/(?:en/)?index\\.html$`);
const assetPath = /^assets\/(?:site-[a-f0-9]{16}\.css|(?:status|demo|pricing)-[a-f0-9]{16}\.js)$/;
function permittedPath(value: string) { return staticPaths.has(value) || assetPath.test(value) || announcementPath.test(value) || /^legal\/(?:terms|privacy|beta|operator)\/(?:ja|en)\/index\.html$/.test(value); }
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
class StagingError extends Error {}
function requireCondition(condition: unknown, code: string): asserts condition { if (!condition) throw new StagingError(code); }
function safeCode(error: unknown) { return error instanceof StagingError ? error.message : "STAGING_LOCAL_VALIDATION_FAILED"; }
function assertScriptValue(value: string) { requireCondition(!unsafeScriptValue(value), "STAGING_UNSAFE_SCRIPT_VALUE"); }
const quote = (value: string) => { assertScriptValue(value); return `"${value}"`; };
const inside = (parent: string, child: string) => child.toLowerCase() === parent.toLowerCase() || child.toLowerCase().startsWith(`${parent.toLowerCase()}/`);

export type PrivateStagingRequest = Pick<WinScpStagingConfig, "host" | "port" | "transport" | "privateStagingRoot" | "publicDocumentRoots">;
/** A separate host/provider verifier must confirm the CURRENT canonical remote
 * root is not web-served and has no symlink/alias into a web root. Config JSON
 * booleans cannot replace this check. No verifier is installed by the CLI. */
export type PrivateStagingVerifier = (request: PrivateStagingRequest) => Promise<{ state: "VERIFIED"; bindingSha256: string; expiresAt: string } | { state: "UNVERIFIED" }>;
export function privateStagingBinding(request: PrivateStagingRequest) {
  return digest(JSON.stringify([request.host.toLowerCase(), request.port, request.transport.protocol, request.transport.fingerprint,
    request.privateStagingRoot, [...request.publicDocumentRoots].sort()]));
}
export type WinScpRunRequest = { executable: string; args: string[]; script: string; timeoutMs: number; cwd: string };
export type WinScpRunResult = { exitCode: number | null; timedOut?: boolean };
export type WinScpRunner = (request: WinScpRunRequest) => Promise<WinScpRunResult>;
export type StagingReceipt = { state: "NOT_STARTED" | "UNKNOWN"; published: false; reasonCode: string; stagingId?: string }
  | { state: "STAGED_VERIFIED"; published: false; generation: number; manifestSha256: string; fileCount: number; stagingId: string };

function config(input: unknown, now: number) {
  const parsed = winScpStagingConfigSchema.safeParse(input);
  requireCondition(parsed.success, "STAGING_CONFIG_INVALID");
  const value = parsed.data;
  requireCondition(Number.isFinite(now) && Date.parse(value.reviewExpiresAt) > now, "STAGING_REVIEW_EXPIRED");
  requireCondition(basename(value.consoleExecutable).toLowerCase() === "winscp.com" && basename(value.engineExecutable).toLowerCase() === "winscp.exe"
    && dirname(value.consoleExecutable).toLowerCase() === dirname(value.engineExecutable).toLowerCase(), "STAGING_EXECUTABLE_LAYOUT_INVALID");
  requireCondition(value.publicDocumentRoots.every(root => !inside(root, value.privateStagingRoot) && !inside(value.privateStagingRoot, root)), "STAGING_PUBLIC_ROOT_FORBIDDEN");
  return value;
}
async function ordinaryFile(path: string, maxBytes: number) {
  const stat = await lstat(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= maxBytes, "STAGING_NONREGULAR_OR_OVERSIZE_FILE");
  return stat;
}
async function verifyLocalTools(value: WinScpStagingConfig) {
  for (const [path, expected] of [[value.consoleExecutable, value.consoleSha256], [value.engineExecutable, value.engineSha256]] as const) {
    await ordinaryFile(path, 64 * 1024 * 1024);
    requireCondition((await realpath(path)).toLowerCase() === resolve(path).toLowerCase(), "STAGING_EXECUTABLE_ALIAS_FORBIDDEN");
    requireCondition(digest(await readFile(path)) === expected, "STAGING_EXECUTABLE_HASH_MISMATCH");
  }
  const stat = await ordinaryFile(value.sessionIni, 4 * 1024 * 1024);
  // On Windows Node's write permission bits reflect FILE_ATTRIBUTE_READONLY.
  // This does not claim to audit an ACL: protection and execution account must
  // be reviewed independently before a real private-root verifier is installed.
  requireCondition((stat.mode & 0o222) === 0, "STAGING_SESSION_STORE_MUST_BE_READ_ONLY");
  requireCondition((await realpath(value.sessionIni)).toLowerCase() === resolve(value.sessionIni).toLowerCase(), "STAGING_SESSION_STORE_ALIAS_FORBIDDEN");
}
async function enumerate(root: string, allowedDirectories?: Set<string>, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    requireCondition(!entry.isSymbolicLink(), "STAGING_LINK_FORBIDDEN");
    if (entry.isDirectory()) {
      requireCondition(!allowedDirectories || allowedDirectories.has(path), "STAGING_UNLISTED_DIRECTORY");
      found.push(...await enumerate(join(root, entry.name), allowedDirectories, path));
    } else {
      requireCondition(entry.isFile(), "STAGING_NONREGULAR_OR_OVERSIZE_FILE");
      found.push(path);
    }
    requireCondition(found.length <= 5001, "STAGING_TOO_MANY_FILES");
  }
  return found;
}
const secretContent = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\b(?:DISCORD_TOKEN|DATABASE_URL|REDIS_URL|SESSION_SECRET|OAUTH_CLIENT_SECRET|CLOUDFLARE_API_TOKEN)\s*[=:]\s*["']?[^\s"'<]{4,}|(?:postgres(?:ql)?|redis|https?|s?ftp):\/\/[^\s/:@]+:[^\s/@]+@/i;
async function bundle(rootInput: string, expectedManifest: string, requireGenerationName = true) {
  const root = resolve(rootInput), stat = await lstat(root);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && (await realpath(root)).toLowerCase() === root.toLowerCase(), "STAGING_BUNDLE_ROOT_INVALID");
  await ordinaryFile(join(root, "manifest.json"), 1024 * 1024);
  const manifestBytes = await readFile(join(root, "manifest.json"));
  requireCondition(digest(manifestBytes) === expectedManifest, "STAGING_REVIEW_HASH_MISMATCH");
  const parsed = manifestSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)));
  requireCondition(parsed.success, "STAGING_MANIFEST_INVALID");
  const manifest = parsed.data;
  requireCondition(!requireGenerationName || basename(root) === `generation-${manifest.generation}`, "STAGING_GENERATION_DIRECTORY_MISMATCH");
  const names = manifest.files.map(file => file.path), unique = new Set(names.map(path => path.toLowerCase()));
  requireCondition(unique.size === names.length && names.every(permittedPath) && !names.includes("manifest.json"), "STAGING_PATH_NOT_ALLOWED");
  requireCondition([...staticPaths].every(path => names.includes(path)), "STAGING_INCOMPLETE_OFFICIAL_BUNDLE");
  for (const kind of ["site", "status", "demo", "pricing"]) requireCondition(names.filter(path => path.startsWith(`assets/${kind}-`)).length === 1, "STAGING_INCOMPLETE_OFFICIAL_BUNDLE");
  const directories = new Set<string>();
  for (const name of names) for (let path = name.slice(0, name.lastIndexOf("/")); name.includes("/") && path; path = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") directories.add(path);
  const actual = (await enumerate(root, directories)).sort();
  requireCondition(JSON.stringify(actual) === JSON.stringify([...names, "manifest.json"].sort()), "STAGING_MANIFEST_FILE_SET_MISMATCH");
  const files = new Map<string, Buffer>([["manifest.json", manifestBytes]]);
  let bytes = manifestBytes.length;
  for (const file of manifest.files) {
    const path = join(root, file.path);
    await ordinaryFile(path, 5 * 1024 * 1024);
    const content = await readFile(path);
    requireCondition(digest(content) === file.sha256, "STAGING_ARTIFACT_HASH_MISMATCH");
    requireCondition(!assetPath.test(file.path) || file.path.includes(`-${file.sha256.slice(0, 16)}.`), "STAGING_ASSET_NAME_HASH_MISMATCH");
    requireCondition(!secretContent.test(new TextDecoder("utf-8", { fatal: true }).decode(content)), "STAGING_SENSITIVE_CONTENT_REJECTED");
    bytes += content.length;
    requireCondition(bytes <= 128 * 1024 * 1024, "STAGING_BUNDLE_TOO_LARGE");
    files.set(file.path, content);
  }
  return { generation: manifest.generation, files, directories: [...directories].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)) };
}

/** Read-only local validation; never starts a process, accesses saved-session
 * contents, creates a scratch directory or opens a remote connection. */
export async function inspectOfficialBundle(input: { config: unknown; bundleDirectory: string }, now = Date.now()) {
  try {
    const value = config(input.config, now);
    await verifyLocalTools(value);
    const prepared = await bundle(input.bundleDirectory, value.approvedManifestSha256);
    return { state: "NOT_STARTED" as const, published: false as const, reasonCode: "STAGING_PREFLIGHT_ONLY", generation: prepared.generation, fileCount: prepared.files.size };
  } catch (error) { return { state: "NOT_STARTED" as const, published: false as const, reasonCode: safeCode(error) }; }
}

function openCommand(value: WinScpStagingConfig) {
  requireCondition(value.transport.protocol === "SFTP", "STAGING_FTPS_STRICT_PIN_UNAVAILABLE");
  const common = `HostName=${quote(value.host)} PortNumber=${value.port} ProxyMethod=0 Tunnel=off PostLoginCommands="" Utf=1`;
  // WinSCP source SessionData.h: fsSFTPonly=2. Enforce it over
  // the stored site's protocol; there is no FTPS command branch.
  return `open ${quote(value.savedSite)} -timeout=15 -hostkey=${quote(value.transport.fingerprint)} -rawsettings FSProtocol=2 ${common} SshNoUserAuth=off AuthKI=off AuthGSSAPI=off AuthGSSAPIKEX=off TryAgent=off AgentFwd=off SftpServer=""`;
}
function transferScript(value: WinScpStagingConfig, prepared: Awaited<ReturnType<typeof bundle>>, stagingId: string, source: string, readBack: string) {
  const remote = `${value.privateStagingRoot}/${stagingId}`;
  const commands = ["option echo off", "option batch abort", "option confirm on", "option reconnecttime 0", "option failonnomatch on", openCommand(value), `mkdir ${quote(remote)}`];
  for (const directory of prepared.directories) commands.push(`mkdir ${quote(`${remote}/${directory}`)}`);
  for (const name of prepared.files.keys()) commands.push(`put -transfer=binary -nopreservetime -nopermissions -resumesupport=off ${quote(join(source, name))} ${quote(`${remote}/${name}`)}`);
  for (const name of prepared.files.keys()) commands.push(`get -transfer=binary -resumesupport=off ${quote(`${remote}/${name}`)} ${quote(join(readBack, name))}`);
  return [...commands, "close", "exit", ""].join("\n");
}

export async function stageOfficialBundle(input: { config: unknown; bundleDirectory: string }, dependencies: {
  authorizePrivateRoot?: PrivateStagingVerifier; runner?: WinScpRunner; now?: () => number;
} = {}): Promise<StagingReceipt> {
  let admitted = false, scratch: string | undefined, stagingId: string | undefined;
  try {
    const now = dependencies.now?.() ?? Date.now(), value = config(input.config, now);
    // WinSCP -certificate adds trust for an otherwise untrusted certificate;
    // a CA-valid certificate may bypass fingerprint comparison. No injected
    // runner (including a Windows Job runner) can confer TLS pin authority.
    requireCondition(value.transport.protocol !== "FTPS_EXPLICIT", "STAGING_FTPS_STRICT_PIN_UNAVAILABLE");
    await verifyLocalTools(value);
    const prepared = await bundle(input.bundleDirectory, value.approvedManifestSha256);
    requireCondition(dependencies.authorizePrivateRoot, "STAGING_PRIVATE_ROOT_UNVERIFIED");
    const request: PrivateStagingRequest = { host: value.host, port: value.port, transport: value.transport, privateStagingRoot: value.privateStagingRoot, publicDocumentRoots: value.publicDocumentRoots };
    const proof = await dependencies.authorizePrivateRoot(request);
    requireCondition(proof.state === "VERIFIED" && proof.bindingSha256 === privateStagingBinding(request)
      && Number.isFinite(Date.parse(proof.expiresAt)) && Date.parse(proof.expiresAt) > now
      && Date.parse(proof.expiresAt) <= now + 3600000, "STAGING_PRIVATE_ROOT_UNVERIFIED");
    // No native runner is installed until a Windows process-handle/job strategy
    // can own and stop the .com helper AND engine without PID-reuse hazards.
    // Supplying config or a private-root verifier cannot bypass this boundary.
    requireCondition(dependencies.runner, "STAGING_NATIVE_RUNNER_UNVERIFIED");
    scratch = await mkdtemp(join(tmpdir(), "nexus-public-staging-"));
    assertScriptValue(scratch);
    const source = join(scratch, "snapshot"), readBack = join(scratch, "readback");
    await mkdir(source); await mkdir(readBack);
    for (const directory of prepared.directories) { await mkdir(join(source, directory), { recursive: true }); await mkdir(join(readBack, directory), { recursive: true }); }
    for (const [name, bytes] of prepared.files) await writeFile(join(source, name), bytes, { flag: "wx" });
    // No process can read a mutable original generation directory. Revalidate
    // the private local snapshot, and check authorization immediately before I/O.
    await bundle(source, value.approvedManifestSha256, false);
    const admissionNow = dependencies.now?.() ?? Date.now();
    requireCondition(Date.parse(proof.expiresAt) > admissionNow && Date.parse(value.reviewExpiresAt) > admissionNow, "STAGING_REVIEW_EXPIRED");
    stagingId = `generation-${prepared.generation}-${randomUUID()}`;
    const script = transferScript(value, prepared, stagingId, source, readBack);
    const args = [`/ini=${value.sessionIni}`, "/nointeractiveinput", "/log=nul", "/xmllog=nul", "/rawconfig", "Logging\\Logging=off", "Logging\\LogActions=off", "Logging\\LogSensitive=off"];
    admitted = true;
    const result = await dependencies.runner({ executable: value.consoleExecutable, args, script, timeoutMs: value.timeoutMs, cwd: scratch });
    requireCondition(result.exitCode === 0 && !result.timedOut, "STAGING_TRANSFER_UNCONFIRMED");
    await bundle(readBack, value.approvedManifestSha256, false);
    return { state: "STAGED_VERIFIED", published: false, generation: prepared.generation, manifestSha256: value.approvedManifestSha256, fileCount: prepared.files.size, stagingId };
  } catch (error) { return { state: admitted ? "UNKNOWN" : "NOT_STARTED", published: false, reasonCode: safeCode(error), ...(stagingId ? { stagingId } : {}) }; }
  finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => { /* Reviewed public snapshot only; never hide an uncertain transfer. */ }); }
}
