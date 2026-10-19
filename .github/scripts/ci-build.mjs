import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearInterval, setInterval } from "node:timers";

// CI-only runner totals. Never read environment, command lines, or application files.
const started = performance.now();
const readText = (path) => {
  try { return readFileSync(path, "utf8"); } catch { return null; }
};
const numberAt = (text, key, suffix = "") => {
  const match = text?.match(new RegExp("^" + key + ":?\\s+(\\d+)" + suffix + "\\s*$", "m"));
  return match ? Number(match[1]) : null;
};
const scalar = (text) => text !== null && /^\d+\s*$/.test(text) ? Number(text) : null;
let previousCpu = null;
let sampleCount = 0;
function sample(event, details = {}) {
  try {
    const memory = readText("/proc/meminfo");
    const stat = readText("/proc/stat");
    const ticks = stat?.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
    const cpu = ticks?.length === 8 && ticks.every(Number.isFinite)
      ? { total: ticks.reduce((sum, value) => sum + value, 0), idle: ticks[3] + ticks[4] }
      : null;
    let cpuBusyPercent = null;
    if (cpu && previousCpu && cpu.total > previousCpu.total && cpu.idle >= previousCpu.idle) {
      cpuBusyPercent = Math.round(10000 * (1 - (cpu.idle - previousCpu.idle) / (cpu.total - previousCpu.total))) / 100;
    }
    previousCpu = cpu;
    let processCount = null;
    try { processCount = readdirSync("/proc", { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).length; } catch { /* unavailable outside Linux */ }
    const cgroupEvents = readText("/sys/fs/cgroup/memory.events");
    process.stdout.write("[ci-build-resource] " + JSON.stringify({
      event, sample: ++sampleCount, utc: new Date().toISOString(),
      elapsedSeconds: Math.round((performance.now() - started) / 1000),
      scope: "runner-totals",
      memoryTotalKiB: numberAt(memory, "MemTotal", "\\s+kB"),
      memoryAvailableKiB: numberAt(memory, "MemAvailable", "\\s+kB"),
      swapTotalKiB: numberAt(memory, "SwapTotal", "\\s+kB"),
      swapFreeKiB: numberAt(memory, "SwapFree", "\\s+kB"),
      cpuBusyPercent, processCount,
      processesRunning: numberAt(stat, "procs_running"),
      processesBlocked: numberAt(stat, "procs_blocked"),
      cgroupMemoryCurrentBytes: scalar(readText("/sys/fs/cgroup/memory.current")),
      cgroupMemoryMaxBytes: scalar(readText("/sys/fs/cgroup/memory.max")),
      cgroupOom: numberAt(cgroupEvents, "oom"),
      cgroupOomKill: numberAt(cgroupEvents, "oom_kill"),
      ...details,
    }) + "\n");
  } catch {
    process.stdout.write("[ci-build-resource] " + JSON.stringify({ event, diagnosticsUnavailable: true }) + "\n");
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("CI build command required.\n");
  process.exitCode = 2;
} else {
  let child;
  let requestedSignal = null;
  let spawnCode = null;
  let periodicSamples = 0;
  const signalExitCode = (signal) => 128 + (constants.signals[signal] ?? 1);
  const forwardSignal = (signal) => {
    if (!requestedSignal) sample("cancellation-requested", { requestedSignal: signal });
    requestedSignal = signal;
    if (child?.pid) {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch { /* child already exited */ }
    }
  };
  const onInterrupt = () => forwardSignal("SIGINT");
  const onTerminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  sample("start");
  child = spawn(command, args, { shell: false, stdio: "inherit", detached: process.platform !== "win32" });
  if (requestedSignal) forwardSignal(requestedSignal);
  const timer = setInterval(() => {
    sample("interval");
    if (++periodicSamples >= 120) {
      clearInterval(timer);
      process.stdout.write("[ci-build-resource] " + JSON.stringify({ event: "periodic-sample-limit", limit: 120 }) + "\n");
    }
  }, 30_000);
  timer.unref();
  child.on("error", (error) => {
    spawnCode = error.code === "ENOENT" ? 127 : error.code === "EACCES" ? 126 : 1;
  });
  const result = await new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  clearInterval(timer);
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  const exitCode = requestedSignal ? signalExitCode(requestedSignal)
    : spawnCode ?? (Number.isInteger(result.code) ? result.code : signalExitCode(result.signal));
  sample("finish", { exitCode, childSignal: result.signal, requestedSignal });
  process.exitCode = exitCode;
}
