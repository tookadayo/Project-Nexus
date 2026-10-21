import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOfficialStatic, canonicalPublicJson, contactUnavailable } from "../../packages/presentation/src/alpha16-publication";
import { inspectOfficialBundle, privateStagingBinding, stageOfficialBundle, type PrivateStagingVerifier, type WinScpRunner, type WinScpStagingConfig } from "../../packages/operations/src/alpha17-winscp-staging";
import type { WindowsJobRequest, WindowsJobResult } from "../../packages/operations/src/alpha17-windows-job";
import { publicationStagingCommand } from "../../scripts/publication/stage";

const now = Date.parse("2026-10-18T00:00:00.000Z"), expiry = "2026-10-18T00:05:00.000Z";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scratch: string[] = [], stores: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await chmod(store, 0o600).catch(() => {});
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nexus-staging-test-")); scratch.push(root);
  const directory = join(root, "generation-4"); await mkdir(directory);
  const result = buildOfficialStatic({ schemaVersion: 1, generation: 4, generatedAt: new Date(now).toISOString(), officialOrigin: "https://www.nexus.example",
    appOrigin: "https://app.nexus.example", announcements: [], status: null, legal: [], contact: contactUnavailable }, now);
  for (const [name, bytes] of Object.entries(result.files)) { await mkdir(dirname(join(directory, name)), { recursive: true }); await writeFile(join(directory, name), bytes); }
  const consoleExecutable = join(root, "WinSCP.com"), engineExecutable = join(root, "WinSCP.exe"), sessionIni = join(root, "private-site.ini");
  await writeFile(consoleExecutable, "fixture console"); await writeFile(engineExecutable, "fixture engine");
  await writeFile(sessionIni, "THIS_FIXTURE_CONTENT_MUST_NOT_BE_EXPORTED"); await chmod(sessionIni, 0o400); stores.push(sessionIni);
  const config: WinScpStagingConfig = { schemaVersion: 1, consoleExecutable, consoleSha256: sha("fixture console"), engineExecutable, engineSha256: sha("fixture engine"), sessionIni,
    savedSite: "NEXUS/staging-only", host: "ftp.nexus.example", port: 22, transport: { protocol: "SFTP", fingerprint: `ssh-ed25519 255 ${"A".repeat(43)}=` },
    privateStagingRoot: "/home/fixture/nexus-staging", publicDocumentRoots: ["/home/fixture/public_html"], approvedManifestSha256: sha(result.files["manifest.json"]!),
    reviewReference: "fixture-reviewed-output", reviewExpiresAt: expiry, timeoutMs: 1000 };
  return { root, directory, config, result };
}
const verifier: PrivateStagingVerifier = async request => ({ state: "VERIFIED", bindingSha256: privateStagingBinding(request), expiresAt: expiry });
function echoRunner(tamper?: (readbackPaths: string[]) => Promise<void>) {
  return vi.fn<WinScpRunner>(async request => {
    const uploaded = new Map<string, string>();
    for (const line of request.script.split("\n")) {
      const put = /^put .* "([^"]+)" "([^"]+)"$/.exec(line);
      if (put) uploaded.set(put[2]!, put[1]!);
    }
    const readbackPaths: string[] = [];
    for (const line of request.script.split("\n")) {
      const get = /^get .* "([^"]+)" "([^"]+)"$/.exec(line);
      if (get) {
        const source = uploaded.get(get[1]!); if (!source) throw new Error("FAKE_MISSING_UPLOAD");
        await writeFile(get[2]!, await readFile(source)); readbackPaths.push(get[2]!);
      }
    }
    await tamper?.(readbackPaths);
    return { exitCode: 0 };
  });
}
async function rewriteManifest(f: Awaited<ReturnType<typeof fixture>>, mutate: (manifest: { files: { path: string; sha256: string }[] }) => void) {
  const file = join(f.directory, "manifest.json"), manifest = JSON.parse(await readFile(file, "utf8")); mutate(manifest);
  const content = canonicalPublicJson(manifest); await writeFile(file, content); f.config.approvedManifestSha256 = sha(content);
}

describe("alpha17 WinSCP private staging", () => {
  it("preflights locally without a verifier, connection or saved-session export", async () => {
    const f = await fixture();
    expect(await inspectOfficialBundle({ config: f.config, bundleDirectory: f.directory }, now)).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_PREFLIGHT_ONLY", generation: 4, published: false });
    expect(JSON.stringify(await inspectOfficialBundle({ config: f.config, bundleDirectory: f.directory }, now))).not.toContain("THIS_FIXTURE_CONTENT");
  });
  it("keeps default production execution closed rather than trusting config booleans", async () => {
    const f = await fixture(), runner = echoRunner();
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, now: () => now })).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_PRIVATE_ROOT_UNVERIFIED", published: false });
    expect(runner).not.toHaveBeenCalled();
    expect(await stageOfficialBundle({ config: { ...f.config, privateRootVerified: true }, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_CONFIG_INVALID" });
  });
  it("uploads a new private generation, reads every byte back and never claims publication", async () => {
    const f = await fixture(), runner = echoRunner();
    const receipt = await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now });
    expect(receipt).toMatchObject({ state: "STAGED_VERIFIED", published: false, generation: 4, manifestSha256: f.config.approvedManifestSha256, fileCount: Object.keys(f.result.files).length });
    expect(receipt.stagingId).toMatch(/^generation-4-[0-9a-f-]{36}$/);
    const request = runner.mock.calls[0]![0];
    expect(request.script).toContain(`mkdir "${f.config.privateStagingRoot}/${receipt.stagingId}"`);
    expect(request.script).toContain("FSProtocol=2"); expect(request.script).toContain("SshNoUserAuth=off");
    expect(request.script).toContain("option confirm on"); expect(request.script).toContain("option batch abort");
    expect(request.script).toContain("option reconnecttime 0"); expect(request.script).toContain("-resumesupport=off");
    expect(request.script).not.toContain("public_html"); expect(request.script).not.toMatch(/^\s*(?:mv|rm|rmdir|chmod|synchronize|call|ln)\s/m);
    expect(JSON.stringify(request)).not.toContain("THIS_FIXTURE_CONTENT");
    expect(request.args).toContain("/nointeractiveinput"); expect(request.args).toContain("/log=nul");
    expect(request.args).not.toContain(request.script);
    expect(request.script.match(/^put /gm)).toHaveLength(Object.keys(f.result.files).length);
    expect(request.script.match(/^get /gm)).toHaveLength(Object.keys(f.result.files).length);
  });
  it("rejects FTPS even when an injected runner is present, without issuing a transfer receipt", async () => {
    const f = await fixture(), runner = echoRunner();
    f.config.transport = { protocol: "FTPS_EXPLICIT", fingerprint: Array(32).fill("AA").join(":") }; f.config.port = 21;
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toEqual({ state: "NOT_STARTED", published: false, reasonCode: "STAGING_FTPS_STRICT_PIN_UNAVAILABLE" });
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, now: () => now })).toEqual({ state: "NOT_STARTED", published: false, reasonCode: "STAGING_FTPS_STRICT_PIN_UNAVAILABLE" });
    expect(runner).not.toHaveBeenCalled();
  });
  it("keeps FTPS closed before authority checks even with a Windows Job runner-shaped injection", async () => {
    const f = await fixture();
    f.config.transport = { protocol: "FTPS_EXPLICIT", fingerprint: Array(32).fill("AA").join(":") }; f.config.port = 21;
    // Exact structural contract of createWindowsJobRunner, without creating a
    // native helper, child process, credential or network connection.
    const runner = vi.fn<(request: WindowsJobRequest) => Promise<WindowsJobResult>>(async () => ({
      exitCode: 0, treeTerminated: true, timedOut: false, cancelled: false,
    }));
    const authorizePrivateRoot = vi.fn<PrivateStagingVerifier>(verifier);
    const receipt = await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, {
      runner, authorizePrivateRoot, now: () => now,
    });
    expect(receipt).toEqual({ state: "NOT_STARTED", published: false, reasonCode: "STAGING_FTPS_STRICT_PIN_UNAVAILABLE" });
    expect(authorizePrivateRoot).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
  it("keeps native FTPS closed because WinSCP certificate trust is not a strict CA-valid pin check", async () => {
    const f = await fixture(); f.config.transport = { protocol: "FTPS_EXPLICIT", fingerprint: Array(32).fill("AA").join(":") }; f.config.port = 21;
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "NOT_STARTED", published: false, reasonCode: "STAGING_FTPS_STRICT_PIN_UNAVAILABLE" });
  });
  it("keeps native SFTP closed until safe owned-process-tree lifecycle is implemented", async () => {
    const f = await fixture();
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "NOT_STARTED", published: false, reasonCode: "STAGING_NATIVE_RUNNER_UNVERIFIED" });
  });
  it.each(["FTP", "FTPS_IMPLICIT", "SCP"])("rejects unsupported transport %s and any credentials fields", async protocol => {
    const f = await fixture(), runner = echoRunner();
    const input = { config: { ...f.config, transport: { protocol, fingerprint: "*" }, password: "fixture" }, bundleDirectory: f.directory };
    expect(await stageOfficialBundle(input, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_CONFIG_INVALID" }); expect(runner).not.toHaveBeenCalled();
  });
  it("rejects injection and wildcard/accept-new identity before any connection", async () => {
    const f = await fixture(), runner = echoRunner();
    for (const override of [{ savedSite: "safe\ncall anything" }, { savedSite: "sftp://user:pass@host/" }, { privateStagingRoot: "/private/%TEMP%" }, { host: "host\" PortNumber=1" },
      { transport: { protocol: "SFTP", fingerprint: "acceptnew" } }, { transport: { protocol: "FTPS_EXPLICIT", fingerprint: "*" } }]) {
      expect(await stageOfficialBundle({ config: { ...f.config, ...override }, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_CONFIG_INVALID" });
    }
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects a public root, its descendants and ancestors", async () => {
    const f = await fixture(), runner = echoRunner();
    for (const root of ["/home/fixture/public_html", "/home/fixture/public_html/staging", "/home/fixture", "/HOME/FIXTURE/PUBLIC_HTML/staging"]) {
      expect(await stageOfficialBundle({ config: { ...f.config, privateStagingRoot: root }, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_PUBLIC_ROOT_FORBIDDEN", state: "NOT_STARTED" });
    }
    expect(runner).not.toHaveBeenCalled();
  });
  it("requires current independently bound private-root evidence", async () => {
    const f = await fixture(), runner = echoRunner();
    for (const proof of [{ state: "UNVERIFIED" } as const, { state: "VERIFIED", bindingSha256: "0".repeat(64), expiresAt: expiry } as const,
      { state: "VERIFIED", bindingSha256: privateStagingBinding(f.config), expiresAt: new Date(now).toISOString() } as const,
      { state: "VERIFIED", bindingSha256: privateStagingBinding(f.config), expiresAt: new Date(now + 3600001).toISOString() } as const]) {
      expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: async () => proof, now: () => now })).toMatchObject({ reasonCode: "STAGING_PRIVATE_ROOT_UNVERIFIED", state: "NOT_STARTED" });
    }
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects a mutable session store or changed executable without reading credentials", async () => {
    const f = await fixture(), runner = echoRunner(); await chmod(f.config.sessionIni, 0o600);
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_SESSION_STORE_MUST_BE_READ_ONLY", state: "NOT_STARTED" });
    await chmod(f.config.sessionIni, 0o400); await writeFile(f.config.engineExecutable, "changed fixture");
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_EXECUTABLE_HASH_MISMATCH", state: "NOT_STARTED" }); expect(runner).not.toHaveBeenCalled();
  });
  it("pins the independently reviewed manifest, and rejects changed bytes", async () => {
    const f = await fixture(), runner = echoRunner();
    await writeFile(join(f.directory, "manifest.json"), "{}");
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_REVIEW_HASH_MISMATCH", state: "NOT_STARTED" }); expect(runner).not.toHaveBeenCalled();
  });
  it("rejects extras, excluded paths and unlisted directories even if their bytes look public", async () => {
    const f = await fixture(), runner = echoRunner();
    await writeFile(join(f.directory, ".env"), "fixture");
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_MANIFEST_FILE_SET_MISMATCH", state: "NOT_STARTED" });
    await rm(join(f.directory, ".env")); await mkdir(join(f.directory, "backups"));
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_UNLISTED_DIRECTORY", state: "NOT_STARTED" });
    await rmdir(join(f.directory, "backups")); await rewriteManifest(f, manifest => manifest.files.push({ path: "../private.json", sha256: "0".repeat(64) }));
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_PATH_NOT_ALLOWED", state: "NOT_STARTED" }); expect(runner).not.toHaveBeenCalled();
  });
  it("rejects changed artifact hashes, linked files and credential material even in approved HTML", async () => {
    const f = await fixture(), runner = echoRunner();
    await writeFile(join(f.directory, "index.html"), "changed");
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_ARTIFACT_HASH_MISMATCH", state: "NOT_STARTED" });
    const content = "DISCORD_TOKEN=synthetic-rejected-fixture"; await writeFile(join(f.directory, "index.html"), content);
    await rewriteManifest(f, manifest => { manifest.files.find(file => file.path === "index.html")!.sha256 = sha(content); });
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_SENSITIVE_CONTENT_REJECTED", state: "NOT_STARTED" });
    await link(join(f.directory, "manifest.json"), join(f.root, "linked-manifest.json"));
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_NONREGULAR_OR_OVERSIZE_FILE", state: "NOT_STARTED" }); expect(runner).not.toHaveBeenCalled();
  });
  it("rejects expired review and a generation directory mismatch", async () => {
    const f = await fixture(), runner = echoRunner();
    expect(await stageOfficialBundle({ config: { ...f.config, reviewExpiresAt: new Date(now).toISOString() }, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ reasonCode: "STAGING_REVIEW_EXPIRED", state: "NOT_STARTED" });
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.root }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "NOT_STARTED" }); expect(runner).not.toHaveBeenCalled();
  });
  it.each(["nonzero", "timeout", "throw", "missing", "changed"])("returns UNKNOWN after admission for %s, with no retry or switch", async failure => {
    const f = await fixture();
    const runner: WinScpRunner = failure === "nonzero" ? vi.fn(async () => ({ exitCode: 1 })) : failure === "timeout" ? vi.fn(async () => ({ exitCode: 0, timedOut: true }))
      : failure === "throw" ? vi.fn(async () => { throw new Error("untrusted server response and secret"); }) : echoRunner(async paths => { if (failure === "missing") await rm(paths[0]!); else await writeFile(paths[1]!, "corrupt readback"); });
    const receipt = await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now });
    expect(receipt).toMatchObject({ state: "UNKNOWN", published: false }); expect(receipt.stagingId).toMatch(/^generation-4-/); expect(runner).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(receipt)).not.toContain("untrusted server response");
  });
  it("never overwrites the original bundle; changed originals during transfer cannot affect its snapshot", async () => {
    const f = await fixture(), echo = echoRunner();
    const runner: WinScpRunner = async request => { await writeFile(join(f.directory, "index.html"), "changed after validation"); return echo(request); };
    expect(await stageOfficialBundle({ config: f.config, bundleDirectory: f.directory }, { runner, authorizePrivateRoot: verifier, now: () => now })).toMatchObject({ state: "STAGED_VERIFIED", published: false });
    expect(await readFile(join(f.directory, "index.html"), "utf8")).toBe("changed after validation");
  });
  it("sanitizes CLI read/usage failures and does not accept credentials in arguments", async () => {
    expect(await publicationStagingCommand(["missing-config", "missing-bundle", "password=fixture"])).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_USAGE", published: false });
    expect(await publicationStagingCommand(["missing-config", "missing-bundle"])).toMatchObject({ state: "NOT_STARTED", reasonCode: "STAGING_INPUT_UNREADABLE", published: false });
  });
});
