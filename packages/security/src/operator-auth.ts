import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { z } from "zod";
import { sql, type Database, type Tx } from "../../db/src/index";
import { assert } from "../../shared/src/index";

const credentialsSchema = z
  .object({
    epoch: z.uuid(),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    csrfKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type OperatorCredentials = z.infer<typeof credentialsSchema>;
const derive = (
  password: string,
  salt: string,
  length: number,
  options: import("node:crypto").ScryptOptions,
) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, length, options, (error, hash) =>
      error ? reject(error) : resolve(hash),
    ),
  );
export const operatorDigest = (value: string) =>
  createHash("sha256")
    .update("operator:v1:" + value)
    .digest("hex");
export async function passwordCredentials(
  password: string,
): Promise<OperatorCredentials> {
  z.string().min(14).max(1024).parse(password);
  const salt = randomBytes(16).toString("hex"),
    hash = (await derive(password, salt, 32, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    })) as Buffer;
  return {
    epoch: randomUUID(),
    salt,
    hash: hash.toString("hex"),
    csrfKey: randomBytes(32).toString("hex"),
  };
}
export async function readOperatorCredentials(path: string) {
  const info = await lstat(path);
  assert(
    info.isFile() && !info.isSymbolicLink(),
    "OPERATOR_CREDENTIALS_UNSAFE",
    503,
  );
  if (process.platform === "win32")
    await new Promise<void>((resolve, reject) =>
      execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-File",
          fileURLToPath(
            new URL("../../../scripts/operator-acl.ps1", import.meta.url),
          ),
          "-Path",
          path,
          "-Verify",
        ],
        { timeout: 10000 },
        (error) =>
          error ? reject(new Error("OPERATOR_CREDENTIALS_UNSAFE")) : resolve(),
      ),
    );
  if (process.platform !== "win32")
    assert((info.mode & 0o077) === 0, "OPERATOR_CREDENTIALS_UNSAFE", 503);
  return credentialsSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
export async function operatorAudit(
  tx: Tx,
  action: string,
  result: "SUCCEEDED" | "DENIED" | "FAILED",
  options: {
    requestId?: string;
    guildId?: string;
    reason?: string;
    before?: unknown;
    after?: unknown;
  } = {},
) {
  await sql`INSERT INTO operator_audit(id,request_id,action,guild_id,result,reason,before_state,after_state) VALUES(${randomUUID()}::uuid,${options.requestId ?? randomUUID()}::uuid,${action},${options.guildId ?? null},${result},${options.reason ?? ""},${JSON.stringify(options.before ?? null)}::jsonb,${JSON.stringify(options.after ?? null)}::jsonb)`.execute(
    tx,
  );
}
export function operatorPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    idleSeconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(900)
      .parse(env.NEXUS_OPERATOR_IDLE_SECONDS),
    absoluteSeconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(28800)
      .default(28800)
      .parse(env.NEXUS_OPERATOR_ABSOLUTE_SECONDS),
    failureWindowSeconds: z.coerce
      .number()
      .int()
      .min(900)
      .max(86400)
      .default(900)
      .parse(env.NEXUS_OPERATOR_FAILURE_WINDOW_SECONDS),
    maxFailures: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(5)
      .parse(env.NEXUS_OPERATOR_MAX_FAILURES),
  };
}
export class OperatorAuth {
  constructor(
    private readonly db: Database,
    private readonly credentials: () => Promise<OperatorCredentials>,
    private readonly policy = operatorPolicy(),
  ) {}
  private csrf(credentials: OperatorCredentials, value: string) {
    return createHmac("sha256", Buffer.from(credentials.csrfKey, "hex"))
      .update("operator-csrf:v1:" + value)
      .digest("base64url");
  }
  async bootstrap() {
    const credentials = await this.credentials(),
      seed = Date.now() + "." + randomBytes(32).toString("base64url");
    return { seed, csrf: this.csrf(credentials, seed) };
  }
  async verifyBootstrap(seed: string | undefined, csrf: string | undefined) {
    const credentials = await this.credentials();
    assert(
      seed &&
        /^\d{13}\.[A-Za-z0-9_-]{43}$/.test(seed) &&
        Number(seed.split(".")[0]) <= Date.now() &&
        Number(seed.split(".")[0]) > Date.now() - 600000 &&
        this.equal(csrf, this.csrf(credentials, seed)),
      "CSRF_REQUIRED",
      403,
    );
  }
  private equal(value: string | undefined, expected: string) {
    const a = Buffer.from(value ?? ""),
      b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async login(password: string) {
    z.string().min(1).max(1024).parse(password);
    const credentials = await this.credentials();
    const result = await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(763213)`.execute(tx);
      await sql`INSERT INTO operator_login_budget(account,window_start,failures) VALUES('operator',clock_timestamp(),0) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      await sql`UPDATE operator_login_budget SET window_start=clock_timestamp(),failures=0 WHERE account='operator' AND window_start<=clock_timestamp()-make_interval(secs=>${this.policy.failureWindowSeconds})`.execute(
        tx,
      );
      const budget = (
        await sql<{
          failures: number;
        }>`SELECT failures FROM operator_login_budget WHERE account='operator' FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      if (budget.failures >= this.policy.maxFailures) {
        await operatorAudit(tx, "LOGIN_THROTTLED", "DENIED");
        return null;
      }
      const hash = (await derive(password, credentials.salt, 32, {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      })) as Buffer;
      if (!timingSafeEqual(hash, Buffer.from(credentials.hash, "hex"))) {
        await sql`UPDATE operator_login_budget SET failures=failures+1 WHERE account='operator'`.execute(
          tx,
        );
        await operatorAudit(tx, "LOGIN", "DENIED");
        return null;
      }
      // Re-read after hashing so a concurrent OS-local reset never issues a
      // session from the replaced credentials.
      if ((await this.credentials()).epoch !== credentials.epoch) {
        await operatorAudit(tx, "LOGIN", "DENIED");
        return null;
      }
      await sql`UPDATE operator_login_budget SET failures=0 WHERE account='operator'`.execute(
        tx,
      );
      const value = randomBytes(32).toString("base64url"),
        csrf = this.csrf(credentials, value);
      await sql`INSERT INTO operator_sessions(digest,credential_epoch,csrf_digest,expires_at) VALUES(${operatorDigest(value)},${credentials.epoch}::uuid,${operatorDigest(csrf)},clock_timestamp()+make_interval(secs=>${this.policy.absoluteSeconds}))`.execute(
        tx,
      );
      await operatorAudit(tx, "LOGIN", "SUCCEEDED");
      return { value, csrf };
    });
    assert(result, "OPERATOR_LOGIN_REQUIRED", 401);
    return result;
  }
  async read(value: string | undefined, csrf?: string, write = false) {
    assert(
      value && /^[A-Za-z0-9_-]{43}$/.test(value),
      "OPERATOR_LOGIN_REQUIRED",
      401,
    );
    const credentials = await this.credentials(),
      expected = this.csrf(credentials, value);
    return this.db
      .transaction()
      .execute(async (tx) => {
        const row = (
          await sql<{
            credential_epoch: string;
            csrf_digest: string;
            expires_at: Date;
            last_used_at: Date;
            revoked_at: Date | null;
          }>`SELECT * FROM operator_sessions WHERE digest=${operatorDigest(value)} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        const valid =
          row &&
          !row.revoked_at &&
          row.credential_epoch === credentials.epoch &&
          row.expires_at.getTime() > Date.now() &&
          row.last_used_at.getTime() + this.policy.idleSeconds * 1000 >
            Date.now();
        if (!valid) {
          if (row && !row.revoked_at) {
            await sql`UPDATE operator_sessions SET revoked_at=clock_timestamp() WHERE digest=${operatorDigest(value)}`.execute(
              tx,
            );
            await operatorAudit(tx, "SESSION_EXPIRED", "SUCCEEDED");
          }
          return null;
        }
        assert(
          !write ||
            (this.equal(csrf, expected) &&
              row.csrf_digest === operatorDigest(expected)),
          "CSRF_REQUIRED",
          403,
        );
        await sql`UPDATE operator_sessions SET last_used_at=clock_timestamp() WHERE digest=${operatorDigest(value)}`.execute(
          tx,
        );
        return { csrf: expected };
      })
      .then((result) => {
        assert(result, "OPERATOR_LOGIN_REQUIRED", 401);
        return result;
      });
  }
  async logout(value: string) {
    await this.db.transaction().execute(async (tx) => {
      await sql`UPDATE operator_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE digest=${operatorDigest(value)}`.execute(
        tx,
      );
      await operatorAudit(tx, "LOGOUT", "SUCCEEDED");
    });
  }
  async revokeAll() {
    await this.db.transaction().execute(async (tx) => {
      await sql`UPDATE operator_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())`.execute(
        tx,
      );
      await operatorAudit(tx, "PASSWORD_RESET", "SUCCEEDED");
    });
  }
}
