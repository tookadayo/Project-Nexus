import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type WindowsJobPin = { path: string; sha256: string };
/** Pins must come from reviewed local tooling, never from a server response.
 * The helper is explicitly built/reviewed; this module never compiles/downloads
 * it, discovers credentials, starts a shell, or installs a staging verifier. */
export type WindowsJobTools = { helper: WindowsJobPin; executable: WindowsJobPin; companions: WindowsJobPin[] };
export type WindowsJobRequest = { executable: string; args: string[]; script: string; timeoutMs: number; cwd: string; signal?: AbortSignal };
export type WindowsJobResult = { exitCode: number | null; timedOut?: boolean; cancelled?: boolean; treeTerminated: true };
class WindowsJobError extends Error {
  constructor(code: string) { super(code); this.name = "WindowsJobError"; }
}
const fail = (code: string): never => { throw new WindowsJobError(code); };
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 32000 && !value.includes("\0");
const canonical = (value: string) => resolve(value).toLowerCase();

/** Trust root: the Windows-protected system PowerShell and standard modules.
 * No external script file, profile, untrusted module path or policy bypass.
 * The fixed bootstrap locks ancestor directories and the compiled helper, then
 * hashes that SAME open file handle and retains every lock through helper exit.
 * Its first stdin frame is only the public helper pin. It reads one bounded
 * target frame and relays that plus control EOF over a dedicated helper pipe. */
export const windowsJobBootstrapCommand = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
try {
Add-Type -ReferencedAssemblies 'System.Web.Extensions','System.Core' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;
public sealed class BootstrapPin {
 public string path;
 public string sha256;
}
public static class NexusJobBootstrap {
 [StructLayout(LayoutKind.Sequential)] struct Info {
  public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation,access,write;
  public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")]
 static extern SafeFileHandle OpenDirectory(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags);
 static void Require(bool condition) { if(!condition) throw new InvalidOperationException(); }
 static byte[] Read(Stream input,int size) {
  byte[] data=new byte[size]; int at=0; while(at<size) { int n=input.Read(data,at,size-at); if(n==0) throw new EndOfStreamException(); at+=n; } return data;
 }
 public static int Run() {
  List<SafeFileHandle> directories=new List<SafeFileHandle>();
  try {
   Stream input=Console.OpenStandardInput(); int size=BitConverter.ToInt32(Read(input,4),0); Require(size>0 && size<=4096);
   JavaScriptSerializer parser=new JavaScriptSerializer(); parser.MaxJsonLength=4096; parser.RecursionLimit=4;
   Dictionary<string,object> fields=parser.DeserializeObject(Encoding.UTF8.GetString(Read(input,size))) as Dictionary<string,object>;
   Require(fields!=null && fields.Count==3 && fields.ContainsKey("protocol") && fields.ContainsKey("path") && fields.ContainsKey("sha256") && fields["protocol"] is int && (int)fields["protocol"]==1);
   BootstrapPin pin=new BootstrapPin(); pin.path=fields["path"] as string; pin.sha256=fields["sha256"] as string;
   Require(pin.path!=null && pin.path.Length<=1000 && pin.path.IndexOf('\0')<0 && pin.sha256!=null && pin.sha256.Length==64);
   byte[] targetPrefix=Read(input,4); int targetSize=BitConverter.ToInt32(targetPrefix,0); Require(targetSize>0 && targetSize<=16*1024*1024);
   byte[] targetFrame=Read(input,targetSize);
   string full=Path.GetFullPath(pin.path); Require(full.Length>3 && full[1]==':' && full[2]=='\\' && full.IndexOf(':',2)<0 && String.Equals(full,pin.path,StringComparison.OrdinalIgnoreCase));
   List<string> parents=new List<string>(); for(DirectoryInfo d=Directory.GetParent(full);d!=null;d=d.Parent) parents.Add(d.FullName); parents.Reverse();
   foreach(string parent in parents) {
    SafeFileHandle handle=OpenDirectory(parent,0,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
    try { Info info; Require(!handle.IsInvalid && GetFileInformationByHandle(handle,out info) && (info.attributes&0x400)==0); directories.Add(handle); }
    catch { handle.Dispose(); throw; }
   }
   using(FileStream locked=new FileStream(full,FileMode.Open,FileAccess.Read,FileShare.Read)) {
    Info info; Require(GetFileInformationByHandle(locked.SafeFileHandle,out info) && info.links==1 && (info.attributes&0x400)==0 && locked.Length>0 && locked.Length<=128L*1024*1024);
    StringBuilder final=new StringBuilder(32768); uint length=GetFinalPathNameByHandle(locked.SafeFileHandle,final,(uint)final.Capacity,0);
    Require(length>0 && length<final.Capacity); string actual=final.ToString(); if(actual.StartsWith("\\\\?\\")) actual=actual.Substring(4);
    Require(String.Equals(actual,full,StringComparison.OrdinalIgnoreCase));
    using(SHA256 hash=SHA256.Create()) Require(BitConverter.ToString(hash.ComputeHash(locked)).Replace("-","").ToLowerInvariant()==pin.sha256);
    using(Process child=new Process()) {
     child.StartInfo.FileName=full; child.StartInfo.UseShellExecute=false; child.StartInfo.CreateNoWindow=true;
     child.StartInfo.RedirectStandardInput=true; child.StartInfo.RedirectStandardOutput=true; child.StartInfo.RedirectStandardError=true;
     Require(child.Start());
     Thread relay=new Thread(delegate() {
      try { Stream output=child.StandardInput.BaseStream; output.Write(targetPrefix,0,4); output.Write(targetFrame,0,targetFrame.Length); output.Flush(); Array.Clear(targetFrame,0,targetFrame.Length); input.CopyTo(output); }
      catch { }
      finally { Array.Clear(targetFrame,0,targetFrame.Length); try { child.StandardInput.Close(); } catch { } }
     }); relay.IsBackground=true; relay.Start();
     System.Threading.Tasks.Task receipt=child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
     System.Threading.Tasks.Task errors=child.StandardError.BaseStream.CopyToAsync(Stream.Null);
     child.WaitForExit(); Require(receipt.Wait(2000) && errors.Wait(2000)); return child.ExitCode;
    }
   }
  } catch { return 71; }
  finally { foreach(SafeFileHandle directory in directories) directory.Dispose(); }
 }
}
'@
exit [NexusJobBootstrap]::Run()
} catch { exit 71 }
`;

async function verifyPin(pin: WindowsJobPin) {
  if (!pin || !text(pin.path) || !isAbsolute(pin.path) || !/^[a-f0-9]{64}$/.test(pin.sha256)) fail("WINDOWS_JOB_PIN_INVALID");
  const stat = await lstat(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 128 * 1024 * 1024
    || canonical(await realpath(pin.path)) !== canonical(pin.path)) fail("WINDOWS_JOB_IMAGE_INVALID");
  if (createHash("sha256").update(await readFile(pin.path)).digest("hex") !== pin.sha256) fail("WINDOWS_JOB_HASH_MISMATCH");
}

/** Local, handle-owned Windows process tree. Target stdout/stderr go directly
 * to NUL in the native helper and are never retained or returned. Arguments
 * must contain public tool options only: scripts/input belong in stdin.
 * Every unsupported platform, integrity or containment failure is closed. */
export async function runWindowsJob(tools: WindowsJobTools, request: WindowsJobRequest): Promise<WindowsJobResult> {
  if (process.platform !== "win32") fail("WINDOWS_JOB_PLATFORM_UNSUPPORTED");
  try {
    if (!tools || !Array.isArray(tools.companions) || tools.companions.length > 8 || !text(request.executable)
      || canonical(request.executable) !== canonical(tools.executable.path)
      || !Array.isArray(request.args) || request.args.length > 128 || !request.args.every(text)
      || !text(request.cwd) || !isAbsolute(request.cwd) || typeof request.script !== "string"
      || Buffer.byteLength(request.script, "utf8") > 8 * 1024 * 1024
      || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 300000) fail("WINDOWS_JOB_REQUEST_INVALID");
    for (const pin of [tools.helper, tools.executable, ...tools.companions]) await verifyPin(pin);
    const directory = await lstat(request.cwd);
    if (!directory.isDirectory() || directory.isSymbolicLink() || canonical(await realpath(request.cwd)) !== canonical(request.cwd)) fail("WINDOWS_JOB_DIRECTORY_INVALID");
    if (request.signal?.aborted) return { exitCode: null, cancelled: true, treeTerminated: true };
    const frame = Buffer.from(JSON.stringify({ protocol: 1, executable: tools.executable, companions: tools.companions,
      args: request.args, cwd: request.cwd, timeoutMs: request.timeoutMs, inputBase64: Buffer.from(request.script, "utf8").toString("base64") }), "utf8");
    if (frame.length > 16 * 1024 * 1024) fail("WINDOWS_JOB_REQUEST_INVALID");
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(frame.length);
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot)) throw new WindowsJobError("WINDOWS_JOB_ENVIRONMENT_INVALID");
    // Do not expose this process's application secrets to a transfer process.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", SystemRoot: systemRoot, WINDIR: systemRoot, PATH: join(systemRoot, "System32"),
      PSModulePath: join(systemRoot, "System32/WindowsPowerShell/v1.0/Modules") };
    for (const key of ["TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
    return await new Promise<WindowsJobResult>((accept, reject) => {
      const command = Buffer.from(windowsJobBootstrapCommand, "utf16le").toString("base64");
      const helper = spawn(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command],
        { cwd: request.cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      let output = "", overflow = false, aborted = false, watchdog = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        aborted = true;
        // EOF is control cancellation, distinct from the target stdin payload.
        helper.stdin.end();
        forceTimer ??= setTimeout(() => { helper.kill(); }, 2000);
      };
      const timer = setTimeout(() => { watchdog = true; cancel(); }, request.timeoutMs + 6500);
      request.signal?.addEventListener("abort", cancel, { once: true });
      helper.stdin.on("error", () => { /* A closed helper receives no retry. */ });
      helper.stdout.on("data", (chunk: Buffer) => {
        if (output.length + chunk.length > 4096) { overflow = true; cancel(); return; }
        output += chunk.toString("utf8");
      });
      helper.once("error", () => { /* close always follows error; report no raw OS detail. */ });
      helper.once("exit", () => { helper.stdin.end(); });
      helper.once("close", (code, signal) => {
        clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); request.signal?.removeEventListener("abort", cancel);
        if (overflow || watchdog || signal || code !== 0) { reject(new WindowsJobError("WINDOWS_JOB_EXECUTION_UNCONFIRMED")); return; }
        try {
          const receipt: unknown = JSON.parse(output);
          if (!receipt || typeof receipt !== "object" || Object.keys(receipt).sort().join(",") !== "exitCode,protocol,state,treeTerminated") fail("WINDOWS_JOB_RECEIPT_INVALID");
          const result = receipt as { protocol: unknown; state: unknown; exitCode: unknown; treeTerminated: unknown };
          if (result.protocol !== 1 || result.treeTerminated !== true || !["EXITED", "TIMEOUT", "CANCELLED"].includes(String(result.state))
            || (result.state === "EXITED" ? !Number.isInteger(result.exitCode) : result.exitCode !== null)) fail("WINDOWS_JOB_RECEIPT_INVALID");
          accept({ exitCode: aborted ? null : result.exitCode as number | null, treeTerminated: true,
            ...(result.state === "TIMEOUT" ? { timedOut: true } : {}), ...(result.state === "CANCELLED" || aborted ? { cancelled: true } : {}) });
        } catch { reject(new WindowsJobError("WINDOWS_JOB_EXECUTION_UNCONFIRMED")); }
      });
      // Keep control stdin OPEN after the one frame. Closing it cancels the job.
      // Child script stdin is separately closed by the helper after its payload.
      const bootstrap = Buffer.from(JSON.stringify({ protocol: 1, ...tools.helper }), "utf8"), bootstrapPrefix = Buffer.alloc(4); bootstrapPrefix.writeUInt32LE(bootstrap.length);
      helper.stdin.write(bootstrapPrefix); helper.stdin.write(bootstrap); helper.stdin.write(prefix); helper.stdin.write(frame, () => frame.fill(0));
    });
  } catch (error) {
    if (error instanceof WindowsJobError) throw error;
    throw new WindowsJobError("WINDOWS_JOB_LOCAL_VALIDATION_FAILED");
  }
}

/** Structurally compatible with WinScpRunner without enabling that caller's
 * private-root admission gate. Both WinSCP.com and sibling WinSCP.exe must be
 * pinned in tools. No binary, saved session or connection is inferred here. */
export function createWindowsJobRunner(tools: WindowsJobTools) {
  return (request: WindowsJobRequest) => runWindowsJob(tools, request);
}
