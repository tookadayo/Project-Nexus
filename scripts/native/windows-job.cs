// Compiled only with the Windows-shipped, signature-verified .NET Framework csc.
// No target output, exception messages, credentials or command lines are logged.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

[DataContract] public sealed class Pin {
    [DataMember(IsRequired = true)] public string path;
    [DataMember(IsRequired = true)] public string sha256;
}
[DataContract] public sealed class Request {
    [DataMember(IsRequired = true)] public int protocol;
    [DataMember(IsRequired = true)] public Pin executable;
    [DataMember(IsRequired = true)] public Pin[] companions;
    [DataMember(IsRequired = true)] public string[] args;
    [DataMember(IsRequired = true)] public string cwd;
    [DataMember(IsRequired = true)] public int timeoutMs;
    [DataMember(IsRequired = true)] public string inputBase64;
}
public static class WindowsJob {
    const uint KillOnClose = 0x2000, Suspended = 4, NoWindow = 0x08000000, ExtendedStartup = 0x00080000;
    const uint WaitTimeout = 258;
    [StructLayout(LayoutKind.Sequential)] struct Security { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int size; public string reserved, desktop, title; public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
        public short show, reserved2Size; public IntPtr reserved2, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet; public uint activeLimit;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong reads, writes, others, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long user, kernel, periodUser, periodKernel; public uint faults, totalProcesses, activeProcesses, terminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct FileInformation {
        public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, ref Security security, uint disposition, uint attributes, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")] static extern SafeFileHandle OpenDirectory(string name, uint access, uint share, IntPtr security, uint disposition, uint attributes, IntPtr template);

    static void Require(bool condition) { if (!condition) throw new InvalidOperationException(); }
    static bool ValidText(string text) { return text != null && text.Length <= 32000 && text.IndexOf('\0') < 0; }
    static string Quote(string text) {
        Require(ValidText(text));
        StringBuilder value = new StringBuilder("\""); int slashes = 0;
        foreach (char character in text) {
            if (character == '\\') { slashes++; continue; }
            value.Append('\\', slashes * (character == '"' ? 2 : 1)); slashes = 0;
            if (character == '"') value.Append('\\'); value.Append(character);
        }
        value.Append('\\', slashes * 2); return value.Append('"').ToString();
    }
    static IntPtr Job() {
        IntPtr job = CreateJobObject(IntPtr.Zero, null); Require(job != IntPtr.Zero);
        try { Limits(job, KillOnClose); return job; } catch { CloseHandle(job); throw; }
    }
    static void Limits(IntPtr job, uint flags) {
        ExtendedLimit value = new ExtendedLimit(); value.basic.flags = flags;
        Require(SetInformationJobObject(job, 9, ref value, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
    }
    static uint Active(IntPtr job) {
        Accounting value; Require(QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        return value.activeProcesses;
    }
    static void LockParents(string path, List<SafeFileHandle> directories) {
        string full = Path.GetFullPath(path); Require(full.Length > 3 && full[1] == ':' && full[2] == '\\' && full.IndexOf(':', 2) < 0);
        List<string> parents = new List<string>();
        for (DirectoryInfo directory = Directory.GetParent(full); directory != null; directory = directory.Parent) parents.Add(directory.FullName);
        parents.Reverse();
        foreach (string parent in parents) {
            // Share READ|WRITE permits normal directory contents work but denies
            // ancestor rename/delete. OPEN_REPARSE_POINT lets us reject aliases.
            SafeFileHandle handle = OpenDirectory(parent, 0, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            try { FileInformation info; Require(!handle.IsInvalid && GetFileInformationByHandle(handle, out info) && (info.attributes & 0x400) == 0); directories.Add(handle); }
            catch { handle.Dispose(); throw; }
        }
    }
    static FileStream LockPin(Pin pin, List<SafeFileHandle> directories) {
        Require(pin != null && ValidText(pin.path) && Path.IsPathRooted(pin.path) && pin.sha256 != null && pin.sha256.Length == 64);
        LockParents(pin.path, directories);
        // Deny write/delete while the image or companion may still be executed.
        FileStream file = new FileStream(pin.path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try {
            Require(file.Length > 0 && file.Length <= 128L * 1024 * 1024);
            FileInformation info; Require(GetFileInformationByHandle(file.SafeFileHandle, out info) && info.links == 1 && (info.attributes & 0x400) == 0);
            StringBuilder final = new StringBuilder(32768);
            uint size = GetFinalPathNameByHandle(file.SafeFileHandle, final, (uint)final.Capacity, 0);
            Require(size > 0 && size < final.Capacity);
            string actual = final.ToString(); if (actual.StartsWith("\\\\?\\")) actual = actual.Substring(4);
            Require(String.Equals(actual, Path.GetFullPath(pin.path), StringComparison.OrdinalIgnoreCase));
            using (SHA256 sha = SHA256.Create()) {
                string hash = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
                Require(String.Equals(hash, pin.sha256, StringComparison.Ordinal));
            }
            return file;
        } catch { file.Dispose(); throw; }
    }
    static byte[] ReadBytes(Stream input, int length) {
        byte[] bytes = new byte[length]; int count = 0;
        while (count < length) { int read = input.Read(bytes, count, length - count); if (read <= 0) throw new EndOfStreamException(); count += read; }
        return bytes;
    }
    static Request ReadRequest(Stream input) {
        int size = BitConverter.ToInt32(ReadBytes(input, 4), 0); Require(size > 0 && size <= 16 * 1024 * 1024);
        using (MemoryStream buffer = new MemoryStream(ReadBytes(input, size))) {
            Request value = (Request)new DataContractJsonSerializer(typeof(Request)).ReadObject(buffer);
            Require(value.protocol == 1 && value.timeoutMs >= 100 && value.timeoutMs <= 300000 && value.companions != null && value.companions.Length <= 8
                && value.args != null && value.args.Length <= 128 && ValidText(value.cwd) && Path.IsPathRooted(value.cwd) && Directory.Exists(value.cwd)
                && value.inputBase64 != null && value.inputBase64.Length <= 12 * 1024 * 1024);
            foreach (string arg in value.args) Require(ValidText(arg)); return value;
        }
    }
    static void Receipt(string state, int? exitCode, bool empty) {
        Console.Out.WriteLine("{\"protocol\":1,\"state\":\"" + state + "\",\"exitCode\":" + (exitCode.HasValue ? exitCode.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "null") + ",\"treeTerminated\":" + (empty ? "true" : "false") + "}");
        Console.Out.Flush();
    }
    public static int Main() {
        IntPtr containment = IntPtr.Zero, work = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, nul = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero; bool attributesReady = false, safeToDisarm = false;
        Timer protocolDeadline = null;
        ProcessInfo child = new ProcessInfo(); List<FileStream> pins = new List<FileStream>(); List<SafeFileHandle> directories = new List<SafeFileHandle>();
        try {
            // Own ourselves BEFORE child creation. Every subsequently created child
            // inherits this job, even if we die between CreateProcess and assignment
            // to the inner work job. No suspended, unowned-process crash window.
            containment = Job(); Require(AssignProcessToJobObject(containment, GetCurrentProcess()));
            protocolDeadline = new Timer(delegate(object ignored) { Environment.Exit(70); }, null, 10000, Timeout.Infinite);
            Stream control = Console.OpenStandardInput(); Request request = ReadRequest(control);
            byte[] payload = Convert.FromBase64String(request.inputBase64); Require(payload.Length <= 8 * 1024 * 1024);
            protocolDeadline.Dispose(); protocolDeadline = null;
            pins.Add(LockPin(request.executable, directories)); foreach (Pin companion in request.companions) pins.Add(LockPin(companion, directories));
            work = Job();
            Security security = new Security(); security.length = Marshal.SizeOf(typeof(Security)); security.inherit = 1;
            Require(CreatePipe(out inputRead, out inputWrite, ref security, 0)); Require(SetHandleInformation(inputWrite, 1, 0));
            nul = CreateFile("NUL", 0x40000000, 3, ref security, 3, 0, IntPtr.Zero); Require(nul != new IntPtr(-1));
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); Require(size != IntPtr.Zero);
            attributes = Marshal.AllocHGlobal(size); Require(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); attributesReady = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handles, inputRead); Marshal.WriteIntPtr(handles, IntPtr.Size, nul);
            Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero));
            StartupEx startup = new StartupEx(); startup.startup.size = Marshal.SizeOf(typeof(StartupEx)); startup.startup.flags = 0x100;
            startup.startup.input = inputRead; startup.startup.output = nul; startup.startup.error = nul; startup.attributes = attributes;
            StringBuilder command = new StringBuilder(Quote(request.executable.path)); foreach (string arg in request.args) command.Append(" ").Append(Quote(arg));
            Require(command.Length < 32767);
            Require(CreateProcess(request.executable.path, command, IntPtr.Zero, IntPtr.Zero, true, Suspended | NoWindow | ExtendedStartup, IntPtr.Zero, request.cwd, ref startup, out child));
            // A failed nested-job assignment never resumes the child. Containment
            // remains armed and kills it if any cleanup step or this helper fails.
            Require(AssignProcessToJobObject(work, child.process)); Require(ResumeThread(child.thread) != 0xffffffff);
            CloseHandle(child.thread); child.thread = IntPtr.Zero; CloseHandle(inputRead); inputRead = IntPtr.Zero; CloseHandle(nul); nul = IntPtr.Zero;
            IntPtr writerHandle = inputWrite; inputWrite = IntPtr.Zero;
            Thread writer = new Thread(delegate() {
                try { using (FileStream stream = new FileStream(new SafeFileHandle(writerHandle, true), FileAccess.Write)) { stream.Write(payload, 0, payload.Length); } }
                catch { /* Broken target stdin is reflected by its exit status. */ }
                finally { Array.Clear(payload, 0, payload.Length); }
            }); writer.IsBackground = true; writer.Start();
            ManualResetEvent cancelled = new ManualResetEvent(false);
            Thread controller = new Thread(delegate() { try { control.ReadByte(); } catch { } finally { cancelled.Set(); } }); controller.IsBackground = true; controller.Start();
            Stopwatch clock = Stopwatch.StartNew(); string state; int? code = null;
            while (true) {
                uint wait = WaitForSingleObject(child.process, 20);
                if (wait == 0) { uint value; Require(GetExitCodeProcess(child.process, out value)); code = unchecked((int)value); state = "EXITED"; break; }
                Require(wait == WaitTimeout);
                if (cancelled.WaitOne(0)) { state = "CANCELLED"; break; }
                if (clock.ElapsedMilliseconds >= request.timeoutMs) { state = "TIMEOUT"; break; }
            }
            Require(TerminateJobObject(work, 125)); Stopwatch cleanup = Stopwatch.StartNew();
            while (Active(work) != 0 && cleanup.ElapsedMilliseconds < 5000) Thread.Sleep(10);
            Require(Active(work) == 0 && Active(containment) == 1);
            CloseHandle(child.process); child.process = IntPtr.Zero;
            // No target process remains, so normal helper exit may disarm its
            // self-containing job. All error paths leave KillOnClose armed.
            safeToDisarm = true; Receipt(state, code, true); return 0;
        } catch { Receipt("ERROR", null, false); return 70; }
        finally {
            if (protocolDeadline != null) protocolDeadline.Dispose();
            if (work != IntPtr.Zero) { TerminateJobObject(work, 125); CloseHandle(work); }
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread); if (child.process != IntPtr.Zero) CloseHandle(child.process);
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead); if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite); if (nul != IntPtr.Zero && nul != new IntPtr(-1)) CloseHandle(nul);
            if (attributesReady) DeleteProcThreadAttributeList(attributes); if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            foreach (FileStream file in pins) file.Dispose();
            foreach (SafeFileHandle directory in directories) directory.Dispose();
            if (containment != IntPtr.Zero) {
                if (safeToDisarm) { try { Limits(containment, 0); } catch { } }
                CloseHandle(containment); // On failure the kernel also kills us.
            }
        }
    }
}
