import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildProcess } from "node:child_process";

export const fixtureStopMessage = { kind: "NEXUS_SYNTHETIC_FIXTURE_STOP", version: 1 } as const;
export const fixtureResultMessage = (ok: boolean) => ({ kind: "NEXUS_SYNTHETIC_FIXTURE_RESULT", version: 1, ok } as const);
export function isFixtureStopMessage(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value).length === 2 &&
    "kind" in value && value.kind === fixtureStopMessage.kind && "version" in value && value.version === 1);
}
export function isFixtureResultMessage(value: unknown): value is ReturnType<typeof fixtureResultMessage> {
  return Boolean(value && typeof value === "object" && Object.keys(value).length === 3 && "kind" in value &&
    value.kind === "NEXUS_SYNTHETIC_FIXTURE_RESULT" && "version" in value && value.version === 1 && "ok" in value && typeof value.ok === "boolean");
}

/** A socket must disappear on the server too, not just leave pg-pool's list. */
export async function drainFixtureClients(readCount: () => Promise<number>, pause: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await readCount() === 0) return;
    await pause(20);
  }
  throw new Error("TEST_DATABASE_CLIENTS_STILL_CONNECTED");
}
/** Only called for the native cluster created by this fixture, never a provider. */
export async function waitForOwnedDatabaseClients(databaseUrl: string) {
  const observer = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000,
    query_timeout: 1000, application_name: "nexus-verification-shutdown" });
  try {
    await observer.connect();
    await drainFixtureClients(async () => {
      const result = await observer.query<{ connections: number }>("SELECT count(*)::integer AS connections FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()");
      return result.rows[0]!.connections;
    }, delay);
  } finally { await observer.end(); }
}

/** Every stage is attempted once; failure stays visible and CLOSED is not issued. */
export function fixtureShutdown(stages: {
  closeFixture: () => Promise<unknown>; closeApi: () => Promise<unknown>; destroyDatabase: () => Promise<unknown>;
  drainDatabase?: () => Promise<unknown>; stopDatabase?: () => Promise<unknown>; markClosed: () => Promise<unknown>;
}) {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    const failures: unknown[] = [];
    for (const stage of [stages.closeFixture, stages.closeApi, stages.destroyDatabase, stages.drainDatabase, stages.stopDatabase]) {
      if (stage) try { await stage(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "TEST_FIXTURE_SHUTDOWN_FAILED");
    await stages.markClosed();
  })();
}

/** IPC shutdown avoids the vendor's signal hook. Direct signals remain a
 * best-effort legacy path; a managed parent's disappearance is always failure. */
export function installFixtureShutdown(stop: () => Promise<void>, owner: NodeJS.Process = process) {
  let pending: Promise<void> | undefined, disconnecting = false;
  const finish = () => pending ??= (async () => {
    let ok = false;
    try { await stop(); ok = true; }
    catch { owner.stderr.write("TEST_FIXTURE_SHUTDOWN_FAILED\n"); owner.exitCode = 1; }
    try {
      if (owner.connected && owner.send) {
        await new Promise<void>((accept, reject) => owner.send!(fixtureResultMessage(ok), error => error ? reject(error) : accept()));
      }
    } catch { owner.stderr.write("TEST_FIXTURE_RESULT_SEND_FAILED\n"); owner.exitCode = 1; }
    finally {
      owner.off("message", message); owner.off("disconnect", disconnected);
      owner.off("SIGINT", signal); owner.off("SIGTERM", signal);
      disconnecting = true;
      if (owner.connected) owner.disconnect();
    }
  })();
  const signal = () => { void finish(); };
  const message = (value: unknown) => { if (isFixtureStopMessage(value)) void finish(); };
  const disconnected = () => {
    if (disconnecting) return;
    owner.exitCode = 1; owner.stderr.write("TEST_FIXTURE_PARENT_DISCONNECTED\n"); void finish();
  };
  owner.on("message", message); owner.on("disconnect", disconnected);
  owner.on("SIGINT", signal); owner.on("SIGTERM", signal);
  return finish;
}

type Signals = Pick<NodeJS.Process, "on" | "off">;
/** The caller creates a detached POSIX group containing only its fixture/PG.
 * Normal shutdown sends IPC, not a signal that embedded-postgres intercepts. */
export async function superviseFixtureOwner(child: ChildProcess, signals: Signals, forceOwnedStop: () => Promise<void>) {
  let requested = false, failed = false, forced = false, completion: boolean | undefined, forceFailure: Error | undefined, forcedCleanup: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined, forceTimer: ReturnType<typeof setTimeout> | undefined;
  let accept!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  let rejectStop!: (error: Error) => void;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done => { accept = done; });
  const unconfirmed = new Promise<never>((_accept, reject) => { rejectStop = reject; });
  const force = () => {
    failed = true;
    if (forced) return;
    forced = true;
    // Resolve a failed/unconfirmed force within the existing outer 15s budget.
    // A detached child is not covered by Playwright killing the runner group.
    forceTimer = setTimeout(() => rejectStop(new Error("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED")), 3000);
    forcedCleanup = forceOwnedStop().catch(error => {
      forceFailure = new Error("TEST_OWNED_FIXTURE_STOP_UNCONFIRMED", { cause: error }); rejectStop(forceFailure);
    });
  };
  const stop = () => {
    if (requested) return;
    requested = true;
    timer = setTimeout(force, 10000);
    if (!child.connected) { force(); return; }
    try { child.send(fixtureStopMessage, error => { if (error) force(); }); }
    catch { force(); }
  };
  const disconnected = () => { failed = true; stop(); };
  const error = () => { failed = true; stop(); };
  const close = (code: number | null, signal: NodeJS.Signals | null) => {
    if (!requested || completion !== true || code !== 0 || signal) { failed = true; force(); }
    accept({ code, signal });
  };
  const message = (value: unknown) => {
    if (!isFixtureResultMessage(value)) return;
    if (!requested || completion !== undefined) { failed = true; force(); return; }
    completion = value.ok;
    if (!value.ok) failed = true;
  };
  child.on("message", message);
  child.once("error", error); child.once("close", close);
  signals.on("SIGINT", stop); signals.on("SIGTERM", stop); signals.on("disconnect", disconnected);
  try {
    const exit = await Promise.race([closed, unconfirmed]);
    await Promise.race([forcedCleanup ?? Promise.resolve(), unconfirmed]);
    if (forceFailure) throw forceFailure;
    return failed || exit.code !== 0 || exit.signal ? 1 : 0;
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    signals.off("SIGINT", stop); signals.off("SIGTERM", stop); signals.off("disconnect", disconnected);
    child.off("error", error); child.off("close", close);
    child.off("message", message);
  }
}
