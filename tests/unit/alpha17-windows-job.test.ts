import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWindowsJob, windowsJobBootstrapCommand, type WindowsJobTools } from "../../packages/operations/src/alpha17-windows-job";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const supported = process.platform === "win32";
const windows = supported ? describe : describe.skip;
const source = resolve("scripts/native/windows-job.cs");
let root: string, helper: string, fixture: string, executable: string, tools: WindowsJobTools;
const fixtureSource = `const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const [depthText, directory, mode, ...args] = process.argv.slice(2), depth=Number(depthText);
const marker=path.join(directory, 'heartbeat-'+depth);
fs.writeFileSync(marker, String(process.pid)+'\\n');
if(mode === 'input') { let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>input+=data); process.stdin.on('end',()=>{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({input,args,secret:process.env.NEXUS_JOB_SECRET===undefined}));process.stdout.write('MUST_NOT_BE_RETAINED');process.stderr.write('MUST_NOT_BE_RETAINED');}); }
else { if(depth>0) cp.spawn(process.execPath,[__filename,String(depth-1),directory,mode],{stdio:'ignore',detached:true}).unref(); setInterval(()=>fs.appendFileSync(marker,'.'),30); if(mode==='exit' && depth===2) setTimeout(()=>process.exit(7),800); }
`;

beforeAll(async () => {
  if (!supported) return;
  await mkdir(resolve(".local"), { recursive: true }); root = await mkdtemp(resolve(".local/windows-job-test-"));
  helper = join(root, "windows-job.exe"); fixture = join(root, "synthetic-child.cjs"); await writeFile(fixture, fixtureSource);
  const compiler = join(process.env.SystemRoot!, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  // The compiler ships with Windows: no network/package install is performed.
  const signatureScript = `$s=Get-AuthenticodeSignature -LiteralPath '${compiler.replaceAll("'", "''")}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { exit 1 }`;
  const signature = spawnSync(join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(signatureScript, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, shell: false,
    env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, PSModulePath: join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/Modules") } });
  expect(signature.status, "Windows compiler must have a valid Microsoft signature: " + signature.stdout + signature.stderr).toBe(0);
  const compiled = spawnSync(compiler, ["/nologo", "/target:exe", "/optimize+", "/platform:x64", `/out:${helper}`, "/r:System.Runtime.Serialization.dll", source], { encoding: "utf8", windowsHide: true, shell: false });
  expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  executable = await realpath(process.execPath);
  tools = { helper: { path: helper, sha256: sha(await readFile(helper)) }, executable: { path: executable, sha256: sha(await readFile(executable)) }, companions: [{ path: fixture, sha256: sha(await readFile(fixture)) }] };
}, 30000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function directory() { return mkdtemp(join(root, "run-")); }
async function waitForThree(directory: string) {
  for (let attempt = 0; attempt < 350; attempt++) {
    if ((await readdir(directory)).filter(name => name.startsWith("heartbeat-")).length === 3) return;
    await pause(20);
  }
  throw new Error("Synthetic process tree did not start");
}
async function assertTreeStopped(directory: string) {
  const names = (await readdir(directory)).filter(name => name.startsWith("heartbeat-")); expect(names).toHaveLength(3);
  const first = await Promise.all(names.map(name => readFile(join(directory, name), "utf8")));
  await pause(250); expect(await Promise.all(names.map(name => readFile(join(directory, name), "utf8")))).toEqual(first);
}
function protocolFrame(value: unknown) {
  const data = Buffer.from(JSON.stringify(value)), prefix = Buffer.alloc(4); prefix.writeUInt32LE(data.length); return Buffer.concat([prefix, data]);
}
function bootstrap(directory: string, helperPin: unknown) {
  const systemRoot = process.env.SystemRoot!;
  const launched = spawn(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsJobBootstrapCommand, "utf16le").toString("base64")], {
    cwd: directory, shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"],
    env: { NODE_ENV: "test", SystemRoot: systemRoot, WINDIR: systemRoot, PSModulePath: join(systemRoot, "System32/WindowsPowerShell/v1.0/Modules") },
  });
  launched.stdin.on("error", () => {}); launched.once("exit", () => launched.stdin.end());
  const closed = new Promise<number | null>(resolve => launched.once("close", resolve));
  launched.stdin.write(protocolFrame(helperPin));
  launched.stdin.write(protocolFrame({ protocol: 1, executable: tools.executable, companions: tools.companions, args: [fixture, "2", directory, "hang"], cwd: directory, timeoutMs: 10000, inputBase64: "" }));
  return { launched, closed };
}
windows("alpha17 Windows Job Object local-only containment", () => {
  it("pins images and fails closed before starting any child on a changed helper or companion", async () => {
    const cwd = await directory(), request = { executable, args: [fixture, "0", cwd, "input"], cwd, timeoutMs: 2000, script: "" };
    await expect(runWindowsJob({ ...tools, helper: { ...tools.helper, sha256: "0".repeat(64) } }, request)).rejects.toThrow("WINDOWS_JOB_HASH_MISMATCH");
    await expect(runWindowsJob({ ...tools, companions: [{ path: fixture, sha256: "0".repeat(64) }] }, request)).rejects.toThrow("WINDOWS_JOB_HASH_MISMATCH");
    expect(await readdir(cwd)).toEqual([]);
  });
  it("keeps shell metacharacters, Unicode, spaces, quotes and trailing backslashes literal; only stdin carries input", async () => {
    const cwd = await directory(), args = ["plain", "", "with spaces", 'quoted"value', "trailing\\", "a\\\"b", "日本語 & $env:PATH %PATH% | >"];
    process.env.NEXUS_JOB_SECRET = "SYNTHETIC_MUST_NOT_LEAK";
    try {
      const result = await runWindowsJob(tools, { executable, args: [fixture, "0", cwd, "input", ...args], cwd, timeoutMs: 3000, script: "synthetic-input-only\n" });
      expect(result).toEqual({ exitCode: 0, treeTerminated: true });
      expect(JSON.parse(await readFile(join(cwd, "result.json"), "utf8"))).toEqual({ input: "synthetic-input-only\n", args, secret: true });
      expect(JSON.stringify(result)).not.toContain("MUST_NOT_BE_RETAINED");
    } finally { delete process.env.NEXUS_JOB_SECRET; }
  }, 20000);
  it("terminates detached grandchildren when the root exits naturally", async () => {
    const cwd = await directory();
    const result = await runWindowsJob(tools, { executable, args: [fixture, "2", cwd, "exit"], cwd, timeoutMs: 5000, script: "" });
    expect(result).toEqual({ exitCode: 7, treeTerminated: true }); await assertTreeStopped(cwd);
  }, 20000);
  it("terminates all three levels on native timeout", async () => {
    const cwd = await directory();
    const result = await runWindowsJob(tools, { executable, args: [fixture, "2", cwd, "hang"], cwd, timeoutMs: 4000, script: "" });
    expect(result).toEqual({ exitCode: null, timedOut: true, treeTerminated: true }); await assertTreeStopped(cwd);
  }, 20000);
  it("uses control-stdin EOF to cancel and confirms zero target processes", async () => {
    const cwd = await directory(), controller = new AbortController();
    const companion = join(cwd, "locked-companion.txt"); await writeFile(companion, "fixed companion");
    const pinned = { ...tools, companions: [...tools.companions, { path: companion, sha256: sha(await readFile(companion)) }] };
    const running = runWindowsJob(pinned, { executable, args: [fixture, "2", cwd, "hang"], cwd, timeoutMs: 5000, script: "", signal: controller.signal });
    running.catch(() => {});
    try { await waitForThree(cwd); await expect(writeFile(companion, "changed", { flag: "r+" })).rejects.toThrow(); } finally { controller.abort(); }
    expect(await running).toEqual({ exitCode: null, cancelled: true, treeTerminated: true }); await assertTreeStopped(cwd);
  }, 20000);
  it("kernel kill-on-close terminates all descendants even if the helper itself is forcibly killed", async () => {
    const cwd = await directory();
    const metadata = Buffer.from(JSON.stringify({ protocol: 1, executable: tools.executable, companions: tools.companions, args: [fixture, "2", cwd, "hang"], cwd, timeoutMs: 10000, inputBase64: "" }));
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(metadata.length);
    const native = spawn(helper, [], { cwd, windowsHide: true, shell: false, stdio: ["pipe", "ignore", "ignore"] });
    native.stdin.on("error", () => {}); native.stdin.write(prefix); native.stdin.write(metadata);
    const closed = new Promise(resolve => native.once("close", resolve));
    try { await waitForThree(cwd); native.kill(); await closed; await pause(100); await assertTreeStopped(cwd); }
    finally { native.kill(); }
  });
  it("locks the exact helper and all ancestor entries through native execution", async () => {
    const cwd = await directory(), bin = join(cwd, "bin"), controller = new AbortController(); await mkdir(bin);
    const copy = join(bin, "windows-job.exe"); await copyFile(helper, copy);
    const running = runWindowsJob({ ...tools, helper: { path: copy, sha256: tools.helper.sha256 } }, { executable, args: [fixture, "2", cwd, "hang"], cwd, timeoutMs: 10000, script: "", signal: controller.signal }); running.catch(() => {});
    try {
      await waitForThree(cwd);
      await expect(writeFile(copy, "changed", { flag: "r+" })).rejects.toThrow();
      await expect(rename(copy, join(bin, "replaced.exe"))).rejects.toThrow();
      await expect(rename(bin, join(cwd, "renamed"))).rejects.toThrow();
    } finally { controller.abort(); await running; }
    await rename(bin, join(cwd, "released")); await assertTreeStopped(cwd);
  }, 20000);
  it.each(["unknown", "changed-hash"])("bootstrap independently rejects %s helper metadata after JavaScript preflight", async kind => {
    const cwd = await directory(), pin = kind === "unknown" ? { protocol: 1, ...tools.helper, unexpected: true } : { protocol: 1, ...tools.helper, sha256: "0".repeat(64) };
    const { launched, closed } = bootstrap(cwd, pin);
    try { expect(await closed).toBe(71); expect(await readdir(cwd)).toEqual([]); } finally { launched.kill(); }
  }, 20000);
  it("cancels the helper via pipe EOF if the bootstrap itself is forcibly killed", async () => {
    const cwd = await directory(), { launched, closed } = bootstrap(cwd, { protocol: 1, ...tools.helper });
    try { await waitForThree(cwd); launched.kill(); await closed; await pause(150); await assertTreeStopped(cwd); }
    finally { launched.stdin.end(); launched.kill(); }
  }, 20000);
  it("times out even when the target never reads a maximum-size stdin payload", async () => {
    const cwd = await directory();
    const result = await runWindowsJob(tools, { executable, args: [fixture, "0", cwd, "hang"], cwd, timeoutMs: 700, script: "x".repeat(8 * 1024 * 1024) });
    expect(result).toEqual({ exitCode: null, timedOut: true, treeTerminated: true });
    const marker = join(cwd, "heartbeat-0"), first = await readFile(marker, "utf8"); await pause(150); expect(await readFile(marker, "utf8")).toBe(first);
  }, 20000);
  it("rejects a different target, command NUL or oversized payload without invoking any helper", async () => {
    const cwd = await directory(), request = { executable, args: [], cwd, timeoutMs: 1000, script: "" };
    await expect(runWindowsJob(tools, { ...request, executable: join(cwd, "other.exe") })).rejects.toThrow("WINDOWS_JOB_REQUEST_INVALID");
    await expect(runWindowsJob(tools, { ...request, args: ["a\0b"] })).rejects.toThrow("WINDOWS_JOB_REQUEST_INVALID");
    await expect(runWindowsJob(tools, { ...request, script: "x".repeat(8 * 1024 * 1024 + 1) })).rejects.toThrow("WINDOWS_JOB_REQUEST_INVALID");
    expect(await readdir(cwd)).toEqual([]);
  });
});

describe("alpha17 Windows Job source containment invariants", () => {
  it("owns the helper before creating children and admits only an explicit handle list", async () => {
    const code = await readFile(source, "utf8");
    expect(code.indexOf("AssignProcessToJobObject(containment, GetCurrentProcess())")).toBeLessThan(code.indexOf("Require(CreateProcess("));
    expect(code).toContain("new IntPtr(0x00020002)"); expect(code).toContain("Suspended | NoWindow | ExtendedStartup");
    expect(code).not.toContain("taskkill"); expect(code).not.toContain("Process.GetProcessById");
  });
});
