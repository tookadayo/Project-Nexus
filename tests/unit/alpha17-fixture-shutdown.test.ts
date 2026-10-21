import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainFixtureClients, fixtureShutdown, fixtureStopMessage, fixtureResultMessage, installFixtureShutdown, isFixtureStopMessage, isFixtureResultMessage, superviseFixtureOwner } from "../e2e/alpha17-fixture-shutdown";

afterEach(() => { vi.useRealTimers(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function processPair() {
  const signals = new EventEmitter(), child = new EventEmitter() as EventEmitter & { connected: boolean; send: ReturnType<typeof vi.fn> };
  child.connected = true;
  child.send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null); return true; });
  return { signals, child, owner: child as unknown as ChildProcess };
}
describe("owned synthetic fixture shutdown", () => {
  it("waits for HTTP, pool and actual backends before PG, then marks CLOSED", async () => {
    const stages: string[] = [], gate = deferred();
    const stop = fixtureShutdown({ closeFixture: async () => { stages.push("http"); await gate.promise; }, closeApi: async () => { stages.push("api"); },
      destroyDatabase: async () => { stages.push("pool"); }, drainDatabase: async () => { stages.push("backends"); },
      stopDatabase: async () => { stages.push("pg"); }, markClosed: async () => { stages.push("closed"); } });
    const first = stop(), second = stop();
    expect(first).toBe(second); expect(stages).toEqual(["http"]);
    gate.resolve(); await first;
    expect(stages).toEqual(["http", "api", "pool", "backends", "pg", "closed"]);
  });
  it("still attempts every owned cleanup stage but never reports CLOSED after failure", async () => {
    const stages: string[] = [], failure = new Error("drain failed"), closed = vi.fn();
    const stop = fixtureShutdown({ closeFixture: async () => { stages.push("http"); }, closeApi: async () => { stages.push("api"); },
      destroyDatabase: async () => { stages.push("pool"); }, drainDatabase: async () => { stages.push("backends"); throw failure; },
      stopDatabase: async () => { stages.push("pg"); }, markClosed: closed });
    await expect(stop()).rejects.toMatchObject({ message: "TEST_FIXTURE_SHUTDOWN_FAILED", errors: [failure] });
    expect(stages).toEqual(["http", "api", "pool", "backends", "pg"]); expect(closed).not.toHaveBeenCalled();
  });
  it("does not attempt to drain or stop an external provider", async () => {
    const close = vi.fn(async () => {}), stop = fixtureShutdown({ closeFixture: close, closeApi: close, destroyDatabase: close, markClosed: close });
    await stop(); expect(close).toHaveBeenCalledTimes(4);
  });
  it("drains live backends without an unconditional delay after zero", async () => {
    const read = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0), pause = vi.fn(async () => {});
    await drainFixtureClients(read, pause);
    expect(read).toHaveBeenCalledTimes(3); expect(pause.mock.calls).toEqual([[20], [20]]);
  });
  it("fails a retained connection after the fixed bounded drain", async () => {
    const read = vi.fn(async () => 1), pause = vi.fn(async () => {});
    await expect(drainFixtureClients(read, pause)).rejects.toThrow("TEST_DATABASE_CLIENTS_STILL_CONNECTED");
    expect(read).toHaveBeenCalledTimes(250); expect(pause).toHaveBeenCalledTimes(250);
  });
  it("propagates an observer query failure", async () => {
    const failure = new Error("observer failed"), pause = vi.fn();
    await expect(drainFixtureClients(async () => { throw failure; }, pause)).rejects.toBe(failure);
    expect(pause).not.toHaveBeenCalled();
  });
  it("accepts only the exact internal IPC control shape", () => {
    expect(isFixtureStopMessage(fixtureStopMessage)).toBe(true);
    for (const value of [null, "SIGTERM", {}, { ...fixtureStopMessage, extra: true }, { ...fixtureStopMessage, version: 2 }]) expect(isFixtureStopMessage(value)).toBe(false);
  });
  it.each(["SIGINT", "SIGTERM"])("translates %s to one IPC stop and awaits the owner close", async signal => {
    const p = processPair(), force = vi.fn(async () => {}), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    p.signals.emit(signal); p.signals.emit(signal);
    expect(p.child.send).toHaveBeenCalledTimes(1); expect(p.child.send.mock.calls[0]![0]).toEqual(fixtureStopMessage);
    let done = false; void result.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    p.child.emit("message", fixtureResultMessage(true)); p.child.emit("close", 0, null); expect(await result).toBe(0); expect(force).not.toHaveBeenCalled();
    expect(p.signals.listenerCount(signal)).toBe(0);
  });
  it("never treats an unexpected clean child exit as success and awaits owned cleanup", async () => {
    const p = processPair(), gate = deferred(), force = vi.fn(() => gate.promise), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    p.child.emit("close", 0, null); expect(force).toHaveBeenCalledTimes(1);
    let done = false; void result.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    gate.resolve(); expect(await result).toBe(1);
  });
  it("makes parent disconnect a failure while requesting owned cleanup", async () => {
    const p = processPair(), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, vi.fn(async () => {}));
    p.signals.emit("disconnect"); expect(p.child.send).toHaveBeenCalledTimes(1);
    p.child.emit("close", 0, null); expect(await result).toBe(1);
  });
  it("forces only the supplied owner after the unchanged outer 15s budget's 10s inner limit", async () => {
    vi.useFakeTimers();
    const p = processPair(), force = vi.fn(async () => {}), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    p.signals.emit("SIGTERM"); await vi.advanceTimersByTimeAsync(9999); expect(force).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(force).toHaveBeenCalledTimes(1);
    p.child.emit("close", null, "SIGKILL"); expect(await result).toBe(1);
  });
  it("makes IPC delivery failure visible and stops only the supplied owner", async () => {
    const p = processPair(), force = vi.fn(async () => {});
    p.child.send.mockImplementation((_message: unknown, callback: (error: Error) => void) => { callback(new Error("IPC failed")); return false; });
    const result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    p.signals.emit("SIGTERM"); expect(force).toHaveBeenCalledTimes(1); p.child.emit("close", 1, null); expect(await result).toBe(1);
  });
  it.each([false, undefined])("does not trust exit0 without a successful completion ack (%s)", async ok => {
    const p = processPair(), force = vi.fn(async () => {}), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    p.signals.emit("SIGTERM"); if (ok !== undefined) p.child.emit("message", fixtureResultMessage(ok));
    p.child.emit("close", 0, null); expect(await result).toBe(1); expect(force).toHaveBeenCalledTimes(1);
  });
  it("accepts only the exact boolean completion ack shape", () => {
    expect(isFixtureResultMessage(fixtureResultMessage(true))).toBe(true);
    expect(isFixtureResultMessage(fixtureResultMessage(false))).toBe(true);
    for (const value of [null, fixtureStopMessage, { ...fixtureResultMessage(true), extra: true }, { ...fixtureResultMessage(true), ok: "true" }]) expect(isFixtureResultMessage(value)).toBe(false);
  });
  it("rejects an unconfirmed force failure without waiting forever for child close", async () => {
    vi.useFakeTimers();
    const p = processPair(), force = vi.fn(async () => { throw new Error("OS denied"); }), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, force);
    const rejected = expect(result).rejects.toThrow("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED");
    p.signals.emit("SIGTERM"); await vi.advanceTimersByTimeAsync(10000); await rejected;
    expect(force).toHaveBeenCalledTimes(1); expect(p.signals.listenerCount("SIGTERM")).toBe(0);
  });
  it("rejects force completion without a child close within the remaining fixed budget", async () => {
    vi.useFakeTimers();
    const p = processPair(), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, vi.fn(async () => {}));
    const rejected = expect(result).rejects.toThrow("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED");
    p.signals.emit("SIGTERM"); await vi.advanceTimersByTimeAsync(13000); await rejected;
    expect(p.signals.listenerCount("SIGTERM")).toBe(0);
  });
  it("bounds a stuck force cleanup even after the child emits close", async () => {
    vi.useFakeTimers();
    const p = processPair(), gate = deferred(), result = superviseFixtureOwner(p.owner, p.signals as unknown as NodeJS.Process, () => gate.promise);
    const rejected = expect(result).rejects.toThrow("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED");
    p.signals.emit("SIGTERM"); await vi.advanceTimersByTimeAsync(10000); p.child.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(3000); await rejected; gate.resolve();
  });
  it("owner awaits IPC cleanup before disconnecting without reclassifying its own disconnect", async () => {
    const owner = new EventEmitter() as EventEmitter & { connected: boolean; send: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; stderr: { write: ReturnType<typeof vi.fn> }; exitCode?: number };
    owner.connected = true; owner.stderr = { write: vi.fn() }; owner.disconnect = vi.fn(() => { owner.connected = false; owner.emit("disconnect"); });
    owner.send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null); return true; });
    const gate = deferred(), stop = vi.fn(() => gate.promise), finish = installFixtureShutdown(stop, owner as unknown as NodeJS.Process);
    owner.emit("message", fixtureStopMessage); expect(stop).toHaveBeenCalledTimes(1); expect(owner.disconnect).not.toHaveBeenCalled();
    gate.resolve(); await finish(); expect(owner.disconnect).toHaveBeenCalledTimes(1); expect(owner.exitCode).toBeUndefined(); expect(owner.stderr.write).not.toHaveBeenCalled();
    expect(owner.send.mock.calls[0]![0]).toEqual(fixtureResultMessage(true));
  });
  it.each(["cleanup", "send"])("owner makes %s failure explicit before disconnecting", async mode => {
    const owner = new EventEmitter() as EventEmitter & { connected: boolean; send: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; stderr: { write: ReturnType<typeof vi.fn> }; exitCode?: number };
    owner.connected = true; owner.stderr = { write: vi.fn() }; owner.disconnect = vi.fn(() => { owner.connected = false; owner.emit("disconnect"); });
    owner.send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(mode === "send" ? new Error("delivery failed") : null); return true; });
    const finish = installFixtureShutdown(async () => { if (mode === "cleanup") throw new Error("cleanup failed"); }, owner as unknown as NodeJS.Process);
    await finish(); expect(owner.exitCode).toBe(1); expect(owner.disconnect).toHaveBeenCalledTimes(1);
    expect(owner.stderr.write).toHaveBeenCalledWith(mode === "cleanup" ? "TEST_FIXTURE_SHUTDOWN_FAILED\n" : "TEST_FIXTURE_RESULT_SEND_FAILED\n");
    expect(owner.send.mock.calls[0]![0]).toEqual(fixtureResultMessage(mode !== "cleanup"));
  });
});
