import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { sql, type Database } from "../../db/src/index";

const tokensSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    refreshToken: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type OAuthTokens = z.infer<typeof tokensSchema>;
export type PublicSession = {
  userId: string;
  accessToken: string;
  expiresAt: number;
  /** Server-only reference for revoking this session after provider rejection. */
  reference?: string;
};
type Row = {
  digest: string;
  user_ciphertext: string;
  token_ciphertext: string | null;
  access_expires_at: Date;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  generation: number;
  refresh_owner: string | null;
  refresh_until: Date | null;
};
export const publicSessionDigest = (value: string) =>
  createHash("sha256")
    .update("public-session:v1:" + value)
    .digest("hex");
export class PublicTokenCipher {
  private readonly key: Buffer;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error("PUBLIC_SESSION_KEY_REQUIRED");
    this.key = createHash("sha256")
      .update("public-oauth:v1:" + secret)
      .digest();
  }
  userDigest(userId: string) {
    return createHmac("sha256", this.key)
      .update("public-user:v1:" + userId)
      .digest("hex");
  }
  seal(digest: string, value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("public-oauth:v1:" + digest));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  open(digest: string, value: string) {
    const bytes = Buffer.from(value, "base64url"),
      cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from("public-oauth:v1:" + digest));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  }
}
export function publicSessionPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    idleSeconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(43200)
      .default(43200)
      .parse(env.NEXUS_PUBLIC_IDLE_SECONDS),
    absoluteSeconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(604800)
      .default(604800)
      .parse(env.NEXUS_PUBLIC_ABSOLUTE_SECONDS),
  };
}
export class PublicSessions {
  readonly cipher: PublicTokenCipher;
  constructor(
    private readonly db: Database,
    secret: string,
    private readonly refresh: (
      token: string,
    ) => Promise<OAuthTokens & { expiresIn: number }>,
    private readonly policy = publicSessionPolicy(),
  ) {
    this.cipher = new PublicTokenCipher(secret);
  }
  async create(userId: string, tokens: OAuthTokens, expiresIn: number) {
    z.string()
      .regex(/^\d{17,20}$/)
      .parse(userId);
    tokensSchema.parse(tokens);
    z.number().finite().positive().max(31536000).parse(expiresIn);
    const value = randomBytes(32).toString("base64url"),
      digest = publicSessionDigest(value);
    await sql`INSERT INTO public_oauth_sessions(digest,user_digest,user_ciphertext,token_ciphertext,access_expires_at,expires_at) VALUES(${digest},${this.cipher.userDigest(userId)},${this.cipher.seal(digest, userId)},${this.cipher.seal(digest, JSON.stringify(tokens))},clock_timestamp()+make_interval(secs=>${expiresIn}),clock_timestamp()+make_interval(secs=>${this.policy.absoluteSeconds}))`.execute(
      this.db,
    );
    return value;
  }
  async revoke(value: string | undefined) {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return;
    await sql`UPDATE public_oauth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),token_ciphertext=NULL,refresh_owner=NULL,refresh_until=NULL,generation=generation+1 WHERE digest=${publicSessionDigest(value)}`.execute(
      this.db,
    );
  }
  async revokeUser(userId: string) {
    z.string()
      .regex(/^\d{17,20}$/)
      .parse(userId);
    await sql`UPDATE public_oauth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),token_ciphertext=NULL,user_ciphertext='',refresh_owner=NULL,refresh_until=NULL,generation=generation+1 WHERE user_digest=${this.cipher.userDigest(userId)}`.execute(
      this.db,
    );
  }
  async read(value: string | undefined): Promise<PublicSession | null> {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const digest = publicSessionDigest(value);
    // Concurrent tabs/processes wait for one durable refresh owner. No external
    // request is retried: a lost response may already have rotated the provider token.
    for (let attempt = 0; attempt < 21; attempt++) {
      const selected = await this.db.transaction().execute(async (tx) => {
        const row = (
          await sql<Row>`SELECT * FROM public_oauth_sessions WHERE digest=${digest} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!row || row.revoked_at) return null;
        const now = Date.now();
        if (
          row.expires_at.getTime() <= now ||
          row.last_used_at.getTime() + this.policy.idleSeconds * 1000 <= now ||
          !row.token_ciphertext ||
          (row.refresh_until && row.refresh_until.getTime() <= now)
        ) {
          await sql`UPDATE public_oauth_sessions SET revoked_at=clock_timestamp(),token_ciphertext=NULL,refresh_owner=NULL,refresh_until=NULL WHERE digest=${digest}`.execute(
            tx,
          );
          return null;
        }
        if (row.refresh_owner) return { waiting: true as const };
        let tokens: OAuthTokens, userId: string;
        try {
          tokens = tokensSchema.parse(
            JSON.parse(this.cipher.open(digest, row.token_ciphertext)),
          );
          userId = z
            .string()
            .regex(/^\d{17,20}$/)
            .parse(this.cipher.open(digest, row.user_ciphertext));
        } catch {
          await sql`UPDATE public_oauth_sessions SET revoked_at=clock_timestamp(),token_ciphertext=NULL WHERE digest=${digest}`.execute(
            tx,
          );
          return null;
        }
        if (row.access_expires_at.getTime() > now + 30000) {
          await sql`UPDATE public_oauth_sessions SET last_used_at=clock_timestamp() WHERE digest=${digest}`.execute(
            tx,
          );
          return {
            session: {
              userId,
              accessToken: tokens.accessToken,
              expiresAt: row.access_expires_at.getTime(),
              reference: value,
            },
          };
        }
        if (!tokens.refreshToken) {
          await sql`UPDATE public_oauth_sessions SET revoked_at=clock_timestamp(),token_ciphertext=NULL WHERE digest=${digest}`.execute(
            tx,
          );
          return null;
        }
        const owner = randomUUID();
        await sql`UPDATE public_oauth_sessions SET refresh_owner=${owner}::uuid,refresh_until=clock_timestamp()+interval '20 seconds' WHERE digest=${digest}`.execute(
          tx,
        );
        return { owner, generation: row.generation, tokens, userId };
      });
      if (!selected) return null;
      if ("session" in selected) return selected.session ?? null;
      if ("waiting" in selected) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      try {
        const updated = await this.refresh(selected.tokens.refreshToken!);
        tokensSchema.parse({
          accessToken: updated.accessToken,
          refreshToken: updated.refreshToken,
        });
        z.number().finite().positive().max(31536000).parse(updated.expiresIn);
        // A rotation response must contain a new usable refresh token. Never keep
        // the old one when the provider result is incomplete.
        if (!updated.refreshToken) throw new Error("SESSION_EXPIRED");
        const result = await sql<{
          access_expires_at: Date;
        }>`UPDATE public_oauth_sessions SET token_ciphertext=${this.cipher.seal(digest, JSON.stringify({ accessToken: updated.accessToken, refreshToken: updated.refreshToken }))},access_expires_at=clock_timestamp()+make_interval(secs=>${updated.expiresIn}),generation=generation+1,refresh_owner=NULL,refresh_until=NULL,last_used_at=clock_timestamp() WHERE digest=${digest} AND generation=${selected.generation} AND refresh_owner=${selected.owner}::uuid AND refresh_until>clock_timestamp() AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_used_at>clock_timestamp()-make_interval(secs=>${this.policy.idleSeconds}) RETURNING access_expires_at`.execute(
          this.db,
        );
        return result.rows[0]
          ? {
              userId: selected.userId,
              accessToken: updated.accessToken,
              expiresAt: result.rows[0].access_expires_at.getTime(),
              reference: value,
            }
          : null;
      } catch {
        await sql`UPDATE public_oauth_sessions SET revoked_at=clock_timestamp(),token_ciphertext=NULL,refresh_owner=NULL,refresh_until=NULL WHERE digest=${digest} AND generation=${selected.generation} AND refresh_owner=${selected.owner}::uuid`.execute(
          this.db,
        );
        return null;
      }
    }
    return null;
  }
  async purge() {
    await sql`DELETE FROM public_oauth_sessions WHERE expires_at<clock_timestamp() OR revoked_at<clock_timestamp()-interval '1 day'`.execute(
      this.db,
    );
  }
}
