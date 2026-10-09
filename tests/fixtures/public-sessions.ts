import { randomBytes } from "node:crypto";
import type {
  OAuthTokens,
  PublicSession,
} from "../../packages/security/src/public-sessions";
// Route unit tests isolate storage. Durable expiry, encryption, refresh races and
// revocation are exercised against PostgreSQL in alpha12-sessions.test.ts.
const rows = new Map<string, PublicSession>();
export const memoryPublicSessions = {
  async create(userId: string, tokens: OAuthTokens, expiresIn: number) {
    const reference = randomBytes(32).toString("base64url");
    rows.set(reference, {
      userId,
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      reference,
    });
    return reference;
  },
  async read(value: string | undefined) {
    const session = value ? rows.get(value) : null;
    return session && session.expiresAt > Date.now() ? session : null;
  },
  async revoke(value: string | undefined) {
    if (value) rows.delete(value);
  },
  async revokeUser(userId: string) {
    for (const [reference, session] of rows)
      if (session.userId === userId) rows.delete(reference);
  },
  expire(value: string) {
    const session = rows.get(value);
    if (session) session.expiresAt = Date.now() - 1000;
  },
  reset() {
    rows.clear();
  },
};
