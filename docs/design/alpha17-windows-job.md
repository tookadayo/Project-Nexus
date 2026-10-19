# alpha17 Windows owned-process helper

## Scope and admission

This is a local Windows process-lifecycle component, not a publication adapter.
It does not inspect saved-session contents, discover credentials, enable a host
verifier, install software, change ACLs/services, or connect to a server. The
staging CLI still fails closed without independently verified private-root
evidence and an explicitly configured runner. FTPS remains disabled separately.

The production tools location is `C:\Users\pc-ad\NEXUS-RUNTIME\tools`.
Use real, canonical paths and independently reviewed SHA-256 pins. The MSIX-hosted
Codex process may virtualize `AppData\Local`; an apparent path there is not an
acceptable substitute for the final physical path.

## Build and trust

The checked source is `scripts/native/windows-job.cs`. Windows 11's Microsoft-
signed .NET Framework compiler at
`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` is sufficient. The
verified local compiler was 4.8.9221.0. No extra toolchain was installed.

Verify its Authenticode status and Microsoft signer before explicitly compiling:

```powershell
New-Item -ItemType Directory -Path .local\native -Force
& "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /optimize+ /platform:x64 /out:.local\native\windows-job.exe /r:System.Runtime.Serialization.dll .\scripts\native\windows-job.cs
Get-FileHash -Algorithm SHA256 -LiteralPath .local\native\windows-job.exe
```

The output is ignored build data. Do not infer a trusted helper hash from an
unreviewed server response, auto-build at application startup, or reuse an old
pin after rebuilding. The reviewed compiled helper pin, WinSCP.com pin, and
sibling WinSCP.exe pin must be supplied explicitly to `createWindowsJobRunner`.

Windows-protected `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
is the bootstrap trust root. A fixed `-EncodedCommand` contains only reviewed
bootstrap code. There is no execution-policy override, user profile, external
script file, or user module search path. Standard OS modules/assemblies compile
the small in-memory bootstrap. A restricted environment that prevents this
operation must remain closed.

## Integrity and process ownership

The bootstrap consumes a bounded three-field helper-pin frame and one bounded
target-request frame from stdin. It opens ancestor directory handles from root
to leaf with delete sharing denied, rejects reparse points, opens the helper
without write/delete sharing, checks its final path and link count, and hashes
that same open file handle. Those handles remain open until helper exit. This
closes the Node hash-check-to-spawn replacement window without changing ACLs.

The helper similarly locks and hashes the target plus every companion. It puts
itself in an outer `KILL_ON_JOB_CLOSE` Job Object before creating any target.
The child therefore inherits containment even if the helper dies between
`CreateProcess(CREATE_SUSPENDED)` and assignment to the inner work job. Only after
successful inner assignment is its main thread resumed. Breakaway is not enabled.
Unsupported nesting or failed native calls never resume an uncontained target.

Target stdin uses a separate pipe; stdout/stderr go to NUL. The explicit
STARTUPINFOEX handle list contains only target stdin's read end and NUL. Job
handles, executable locks, and the control-pipe writer are not inherited.

Natural root exit, timeout, and control-stdin EOF terminate the work job and wait
for its active process count to reach zero. Only then is a fixed receipt emitted.
A helper crash/kill closes its outer job and the kernel kills descendants.
An incomplete initial request has a ten-second watchdog. The bootstrap relays
stdin explicitly and closes the helper pipe on EOF; it never relies on console
stdin inheritance. The Node launcher retains its process handle and never uses
PID-only tree termination.

## Data and result handling

Only public tool options belong in argv. The script is sent over stdin, not an
argument or file. The child receives a minimal OS environment, not application
secrets. Target output is never retained, returned, or logged. The only captured
stdout is a maximum 4 KiB fixed helper receipt; stderr is discarded. Errors expose
fixed reason codes. No exception text or raw transport response is returned.

`treeTerminated: true` means local process cleanup was confirmed, not that remote
files are correct or an announcement was published. A timeout, cancellation,
nonzero helper status, malformed receipt, or uncertain execution must not permit
success/retry or an active-generation switch. Cancellation maps the target exit
code to null even if a natural exit races with it.

## Verification

`tests/unit/alpha17-windows-job.test.ts` compiles the current checked-in C# source
under a fresh ignored `.local` directory after compiler-signature verification.
It uses only synthetic Node fixtures, including detached three-level trees.
Coverage includes literal Windows argument quoting, stdin-only input, secret-
environment removal, NUL output, natural root exit, timeout, EOF, forced helper
and bootstrap termination, helper/ancestor/companion locks, independent bootstrap
pin/schema rejection, and a target that never reads an 8 MiB payload. No WinSCP
binary or network connection is executed by these tests.

Native contracts: [nested jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs),
[explicit handle inheritance](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[file sharing and reparse flags](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
