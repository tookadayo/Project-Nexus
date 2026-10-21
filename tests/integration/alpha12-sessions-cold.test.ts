import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { rm, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, migrate, sql, type Database } from "../../packages/db/src/index";
import { PublicSessions, publicSessionDigest } from "../../packages/security/src/public-sessions";
import { isolatedPostgres } from "../fixtures/postgres";

// Deliberately retains the original cold eight-reader regression. No pool
// prewarming, skip, expected-failure marker or timeout relaxation is used here.
// The unchanged 500 ms limit applies to EACH acquisition, not the whole burst.
// This is Windows native embedded PG 18.4 beta evidence; it neither measures
// nor certifies the planned production Linux PostgreSQL 18.6 container.
let infra: Awaited<ReturnType<typeof isolatedPostgres>> | undefined, db: Database;
const key = "synthetic-public-session-key-for-isolated-tests-only";
const user = "822222222222222222";
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  if (!infra) return;
  await infra.stop();
  // Delete only this stopped fixture's resolved direct child of .local.
  const root = await realpath(resolve(".local")), directory = await realpath(infra.directory);
  if (dirname(directory).toLowerCase() !== root.toLowerCase() || !basename(directory).startsWith("pg-alpha12-"))
    throw new Error("COLD_FIXTURE_CLEANUP_PATH_UNSAFE");
  // On Windows the fixture package force-terminates its owned child and can
  // leave a stale PID file. Require pg_ctl's read-only status=3 instead; never
  // interpret a PID file as authority to stop an unrelated process.
  const require = createRequire(import.meta.url);
  const embeddedRequire = createRequire(require.resolve("embedded-postgres"));
  const binaries = await import(pathToFileURL(embeddedRequire.resolve(
    `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`,
  )).href) as { pg_ctl: string };
  const pgCtl = await realpath(binaries.pg_ctl);
  const status = await new Promise<number>((accept, reject) => {
    execFile(pgCtl, ["status", "-D", directory], { timeout: 5000, windowsHide: true }, (error) => {
      if (!error) accept(0);
      else if (typeof error.code === "number") accept(error.code);
      else reject(error);
    });
  });
  if (status !== 3) throw new Error("COLD_FIXTURE_POSTGRES_NOT_STOPPED");
  await rm(directory, { recursive: true, force: true });
  const remaining = await stat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (remaining) throw new Error("COLD_FIXTURE_CLEANUP_INCOMPLETE");
  process.stdout.write("COLD_SESSION_FIXTURE_STOPPED_AND_REMOVED\n");
});
it("keeps the original cold eight-reader encrypted refresh regression at max10 and 500ms per acquire", async () => {
  let calls = 0;
  const refresh = async (token: string) => {
    expect(token).toBe("synthetic-refresh-before");
    calls++;
    await new Promise((done) => setTimeout(done, 10));
    return { accessToken: "synthetic-access-after", refreshToken: "synthetic-refresh-after", expiresIn: 3600 };
  };
  const a = new PublicSessions(db, key, refresh), b = new PublicSessions(db, key, refresh);
  const value = await a.create(user, {
    accessToken: "synthetic-access-before", refreshToken: "synthetic-refresh-before",
  }, 1);
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const started = performance.now();
  // Observe every request before asserting so timeout failure cannot leave
  // unobserved work running into cleanup or the next test.
  const observed = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) => (index % 2 ? a : b).read(value)),
  );
  const errors = observed.filter((result) => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : "UNKNOWN_FIXTURE_ERROR");
  process.stdout.write("COLD_SESSION_POOL_OUTCOMES=" + JSON.stringify({
    requests: 8, fulfilled: observed.filter((result) => result.status === "fulfilled").length,
    rejected: errors.length, elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    perAcquireDeadlineMs: 500, poolMax: 10, errors,
  }) + "\n");
  // A cold timeout remains a visible regression failure in default integration.
  expect(errors).toEqual([]);
  const results = observed.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  expect(calls).toBe(1);
  expect(results.every((result) => result?.accessToken === "synthetic-access-after")).toBe(true);
  const row = (await sql<{ token_ciphertext: string; generation: number }>`SELECT * FROM public_oauth_sessions WHERE digest=${publicSessionDigest(value)}`.execute(db)).rows[0]!;
  expect(row.generation).toBe(1);
  expect(JSON.stringify(row)).not.toContain("synthetic-access");
  expect(JSON.stringify(row)).not.toContain("synthetic-refresh");
  expect(JSON.stringify(row)).not.toContain(user);
  expect((await new PublicSessions(db, key, refresh).read(value))?.userId).toBe(user);
  expect(await a.read(value.slice(0, 42) + (value.endsWith("A") ? "B" : "A"))).toBeNull();
  await b.revoke(value);
  expect(await a.read(value)).toBeNull();
});
