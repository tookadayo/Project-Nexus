import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  connect,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import {
  PublicSessions,
  publicSessionDigest,
} from "../../packages/security/src/public-sessions";
import {
  OperatorAuth,
  passwordCredentials,
  operatorDigest,
} from "../../packages/security/src/operator-auth";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { createOperatorServer } from "../../apps/operator/src/server";
import { isolatedPostgres } from "../fixtures/postgres";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
const key = "synthetic-public-session-key-for-isolated-tests-only";
const user = "822222222222222222",
  other = "833333333333333333";
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("keeps opaque cookies and encrypted provider tokens across restarts; serializes refresh across processes", async () => {
  let calls = 0;
  const refresh = async (token: string) => {
    expect(token).toBe("synthetic-refresh-before");
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      accessToken: "synthetic-access-after",
      refreshToken: "synthetic-refresh-after",
      expiresIn: 3600,
    };
  };
  const a = new PublicSessions(db, key, refresh),
    b = new PublicSessions(db, key, refresh);
  const value = await a.create(
    user,
    {
      accessToken: "synthetic-access-before",
      refreshToken: "synthetic-refresh-before",
    },
    1,
  );
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).read(value)),
  );
  expect(calls).toBe(1);
  expect(
    results.every((result) => result?.accessToken === "synthetic-access-after"),
  ).toBe(true);
  const row = (
    await sql<{
      token_ciphertext: string;
      generation: number;
    }>`SELECT * FROM public_oauth_sessions WHERE digest=${publicSessionDigest(value)}`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.generation).toBe(1);
  expect(JSON.stringify(row)).not.toContain("synthetic-access");
  expect(JSON.stringify(row)).not.toContain("synthetic-refresh");
  expect(JSON.stringify(row)).not.toContain(user);
  expect((await new PublicSessions(db, key, refresh).read(value))?.userId).toBe(
    user,
  );
  expect(
    await a.read(value.slice(0, 42) + (value.endsWith("A") ? "B" : "A")),
  ).toBeNull();
  await b.revoke(value);
  expect(await a.read(value)).toBeNull();
});
it("rejects idle/absolute expiry, refresh failure and ambiguous refresh after a crash without retrying provider effects", async () => {
  let calls = 0;
  const sessions = new PublicSessions(db, key, async () => {
    calls++;
    throw new Error("synthetic-provider-error");
  });
  const expired = await sessions.create(
    user,
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    3600,
  );
  await sql`UPDATE public_oauth_sessions SET last_used_at=now()-interval '13 hours' WHERE digest=${publicSessionDigest(expired)}`.execute(
    db,
  );
  expect(await sessions.read(expired)).toBeNull();
  const absolute = await sessions.create(
    user,
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    3600,
  );
  await sql`UPDATE public_oauth_sessions SET expires_at=now()-interval '1 second' WHERE digest=${publicSessionDigest(absolute)}`.execute(
    db,
  );
  expect(await sessions.read(absolute)).toBeNull();
  const failed = await sessions.create(
    user,
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    1,
  );
  expect(await sessions.read(failed)).toBeNull();
  expect(await sessions.read(failed)).toBeNull();
  expect(calls).toBe(1);
  const crashed = await sessions.create(
    user,
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    1,
  );
  await sql`UPDATE public_oauth_sessions SET refresh_owner=${randomUUID()}::uuid,refresh_until=now()-interval '1 second' WHERE digest=${publicSessionDigest(crashed)}`.execute(
    db,
  );
  expect(await sessions.read(crashed)).toBeNull();
  expect(calls).toBe(1);
  const damaged = await sessions.create(
    user,
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    1,
  );
  await sql`UPDATE public_oauth_sessions SET token_ciphertext='synthetic-damaged-ciphertext' WHERE digest=${publicSessionDigest(damaged)}`.execute(
    db,
  );
  expect(await sessions.read(damaged)).toBeNull();
  expect(await sessions.read(damaged)).toBeNull();
  expect(calls).toBe(1);
});
it("never restores a revoked session with an old refresh completion and limits personal disconnect to its subject", async () => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    hold = new Promise<void>((resolve) => (release = resolve));
  const sessions = new PublicSessions(db, key, async () => {
    started();
    await hold;
    return {
      accessToken: "synthetic-new-access",
      refreshToken: "synthetic-new-refresh",
      expiresIn: 3600,
    };
  });
  const racing = await sessions.create(
      user,
      {
        accessToken: "synthetic-old-access",
        refreshToken: "synthetic-old-refresh",
      },
      1,
    ),
    read = sessions.read(racing);
  await ready;
  await sessions.revoke(racing);
  release();
  expect(await read).toBeNull();
  expect(await sessions.read(racing)).toBeNull();
  const a = await sessions.create(user, { accessToken: "synthetic-a" }, 3600),
    b = await sessions.create(user, { accessToken: "synthetic-b" }, 3600),
    c = await sessions.create(other, { accessToken: "synthetic-other" }, 3600);
  await sessions.revokeUser(user);
  expect(await sessions.read(a)).toBeNull();
  expect(await sessions.read(b)).toBeNull();
  expect((await sessions.read(c))?.userId).toBe(other);
  const rows = (
    await sql<{
      user_ciphertext: string;
      token_ciphertext: string | null;
    }>`SELECT user_ciphertext,token_ciphertext FROM public_oauth_sessions WHERE user_digest=${sessions.cipher.userDigest(user)}`.execute(
      db,
    )
  ).rows;
  expect(
    rows.every(
      (row) => row.token_ciphertext === null && row.user_ciphertext === "",
    ),
  ).toBe(true);
});
it("separates operator authentication, checks Host/Origin/CSRF, expires/logout/resets sessions and bounds account login attempts", async () => {
  let credentials = await passwordCredentials(
    "synthetic-operator-password-test-only",
  );
  const auth = new OperatorAuth(db, async () => credentials),
    beta = new BetaOperator(db, async (id) => ({
      name: id,
      present: true,
      canObserve: true,
      checkedAt: Date.now(),
    }));
  const app = createOperatorServer(db, auth, beta),
    headers = { host: "127.0.0.1:3210" },
    origin = { ...headers, origin: "http://127.0.0.1:3210" };
  expect(
    (
      await app.inject({
        url: "/operator/guilds",
        headers: {
          ...headers,
          cookie: "nexus_session=synthetic-public-cookie",
        },
      })
    ).statusCode,
  ).toBe(401);
  for (const extra of [
    { host: "evil.example" },
    { "x-forwarded-host": "127.0.0.1:3210" },
    { origin: "https://evil.example" },
  ])
    expect(
      (
        await app.inject({
          url: "/operator/session",
          headers: { ...headers, ...extra },
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await app.inject({
        url: "/operator/session",
        headers,
        remoteAddress: "192.0.2.1",
      })
    ).statusCode,
  ).toBe(403);
  const bootstrap = await app.inject({ url: "/operator/session", headers });
  const seed = String(bootstrap.headers["set-cookie"]).split(";")[0]!;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/operator/session",
        headers: { ...origin, cookie: seed },
        payload: { password: "synthetic-operator-password-test-only" },
      })
    ).statusCode,
  ).toBe(403);
  const login = await app.inject({
    method: "POST",
    url: "/operator/session",
    headers: { ...origin, cookie: seed, "x-csrf-token": bootstrap.json().csrf },
    payload: { password: "synthetic-operator-password-test-only" },
  });
  expect(login.statusCode).toBe(200);
  const cookies = login.headers["set-cookie"] as string[],
    sessionCookie = cookies[0]!.split(";")[0]!,
    value = sessionCookie.split("=")[1]!,
    csrf = login.json().csrf;
  expect(sessionCookie).not.toContain("password");
  expect(cookies[0]).toContain("HttpOnly");
  expect(cookies[0]).toContain("SameSite=Strict");
  expect(cookies[0]).toContain("Path=/operator");
  expect(cookies[0]).not.toContain("Domain=");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/operator/logout",
        headers: { ...origin, cookie: sessionCookie },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/operator/logout",
        headers: { ...origin, cookie: sessionCookie, "x-csrf-token": csrf },
      })
    ).statusCode,
  ).toBe(200);
  await expect(auth.read(value)).rejects.toThrow("OPERATOR_LOGIN_REQUIRED");
  const reset = await auth.login("synthetic-operator-password-test-only");
  credentials = await passwordCredentials(
    "synthetic-replaced-operator-password-test-only",
  );
  await expect(auth.read(reset.value)).rejects.toThrow(
    "OPERATOR_LOGIN_REQUIRED",
  );
  const expired = await auth.login(
    "synthetic-replaced-operator-password-test-only",
  );
  await sql`UPDATE operator_sessions SET last_used_at=now()-interval '16 minutes' WHERE digest=${operatorDigest(expired.value)}`.execute(
    db,
  );
  await expect(auth.read(expired.value)).rejects.toThrow(
    "OPERATOR_LOGIN_REQUIRED",
  );
  const absolute = await auth.login(
    "synthetic-replaced-operator-password-test-only",
  );
  await sql`UPDATE operator_sessions SET expires_at=now()-interval '1 second' WHERE digest=${operatorDigest(absolute.value)}`.execute(
    db,
  );
  await expect(auth.read(absolute.value)).rejects.toThrow(
    "OPERATOR_LOGIN_REQUIRED",
  );
  for (let i = 0; i < 6; i++)
    await expect(auth.login("synthetic-wrong-password")).rejects.toThrow(
      "OPERATOR_LOGIN_REQUIRED",
    );
  expect(
    (
      await sql<{
        failures: number;
      }>`SELECT failures FROM operator_login_budget`.execute(db)
    ).rows[0]!.failures,
  ).toBe(5);
  const audit = JSON.stringify(
    (await sql`SELECT * FROM operator_audit`.execute(db)).rows,
  );
  expect(audit).toContain("LOGIN_THROTTLED");
  expect(audit).not.toContain("synthetic-wrong");
  expect(audit).not.toContain(credentials.hash);
  await app.close();
});
