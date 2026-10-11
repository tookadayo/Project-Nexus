import Fastify from "fastify";
import { readLegalCandidate } from "./legal-candidates";
import {
  readConfirmedLegalContacts,
  type LegalContactsLoader,
} from "./legal-contacts";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  OperatorAuth,
  operatorAudit,
  operatorPolicy,
} from "../../../packages/security/src/operator-auth";
import { BetaOperator } from "../../../packages/security/src/beta-operator";
import { sql, type Database } from "../../../packages/db/src/index";
import { isDomainError } from "../../../packages/shared/src/index";
import { BETA_ACTIVE_MAX } from "../../../packages/config/src/hosted-beta";
import {
  OfficialPublications,
  type LegalCandidateLoader,
} from "../../../packages/operations/src/publication";

export function operatorBoundary(
  headers: Record<string, string | string[] | undefined>,
  origin: string,
  method: string,
  remoteAddress: string,
) {
  const url = new URL(origin);
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress) &&
    headers.host === url.host &&
    Object.keys(headers).every(
      (key) =>
        !key.toLowerCase().startsWith("x-forwarded-") &&
        !["forwarded", "x-real-ip"].includes(key.toLowerCase()),
    ) &&
    (!headers.origin || headers.origin === origin) &&
    (!headers["sec-fetch-site"] ||
      headers["sec-fetch-site"] === "same-origin" ||
      headers["sec-fetch-site"] === "none") &&
    (method === "GET" ||
      method === "HEAD" ||
      (method === "POST" && headers.origin === origin))
  );
}
function cookie(header: string | undefined, name: string) {
  return header
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function createOperatorServer(
  db: Database,
  auth: OperatorAuth,
  beta: BetaOperator,
  origin = "http://127.0.0.1:3210",
  options: {
    readLegalCandidate?: LegalCandidateLoader;
    readConfirmedLegalContacts?: LegalContactsLoader;
  } = {},
) {
  const url = new URL(origin);
  if (
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("OPERATOR_LOOPBACK_REQUIRED");
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 16384 });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Robots-Tag", "noindex, nofollow, noarchive")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (!operatorBoundary(req.headers, origin, req.method, req.ip))
      return reply.code(403).send({ error: "LOCAL_REQUEST_REQUIRED" });
  });
  app.setErrorHandler(async (error, _req, reply) => {
    const code = isDomainError(error)
      ? error.code
      : error instanceof z.ZodError
        ? "INVALID_REQUEST"
        : "OPERATOR_UNAVAILABLE";
    // Never pass request bodies, password guesses or exception text to audit.
    if (!["OPERATOR_LOGIN_REQUIRED", "CSRF_REQUIRED"].includes(code))
      await operatorAudit(db, "REQUEST", "FAILED").catch(() => {
        process.stderr.write("Operator failure audit unavailable.\n");
      });
    return reply
      .code(
        isDomainError(error)
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 503,
      )
      .send({ error: code });
  });
  const sid = (req: { headers: { cookie?: string } }) =>
    cookie(req.headers.cookie, "nexus_operator");
  const authorize = async (
    req: { headers: { cookie?: string; "x-csrf-token"?: string | string[] } },
    write = false,
  ) =>
    auth.read(
      sid(req),
      typeof req.headers["x-csrf-token"] === "string"
        ? req.headers["x-csrf-token"]
        : undefined,
      write,
    );
  app.get("/", async (_req, reply) =>
    reply
      .type("text/html")
      .send(
        await readFile(
          new URL("../public/index.html", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/operator-ui.js", async (_req, reply) =>
    reply
      .type("text/javascript")
      .send(
        await readFile(
          new URL("../public/operator-ui.js", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/operator-ui.css", async (_req, reply) =>
    reply
      .type("text/css")
      .send(
        await readFile(
          new URL("../public/operator-ui.css", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/operator/session", async (req, reply) => {
    if (sid(req)) {
      try {
        return { authenticated: true, ...(await authorize(req)) };
      } catch (error) {
        if (!isDomainError(error) || error.code !== "OPERATOR_LOGIN_REQUIRED")
          throw error;
      }
    }
    const { seed, csrf } = await auth.bootstrap();
    reply.header(
      "Set-Cookie",
      `nexus_operator_bootstrap=${seed}; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=600`,
    );
    return { authenticated: false, csrf };
  });
  app.post<{ Body: { password: string } }>(
    "/operator/session",
    async (req, reply) => {
      await auth.verifyBootstrap(
        cookie(req.headers.cookie, "nexus_operator_bootstrap"),
        typeof req.headers["x-csrf-token"] === "string"
          ? req.headers["x-csrf-token"]
          : undefined,
      );
      const password = z
        .object({ password: z.string().min(1).max(1024) })
        .strict()
        .parse(req.body).password;
      const result = await auth.login(password);
      if (sid(req)) await auth.logout(sid(req)!);
      reply.header("Set-Cookie", [
        `nexus_operator=${result.value}; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=${operatorPolicy().absoluteSeconds}`,
        "nexus_operator_bootstrap=; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=0",
      ]);
      return { authenticated: true, csrf: result.csrf };
    },
  );
  app.post("/operator/logout", async (req, reply) => {
    await authorize(req, true);
    await auth.logout(sid(req)!);
    reply.header(
      "Set-Cookie",
      "nexus_operator=; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=0",
    );
    return { ok: true };
  });
  app.get("/operator/guilds", async (req) => {
    await authorize(req);
    return { guilds: await beta.list(), maximum: BETA_ACTIVE_MAX };
  });
  app.get<{ Params: { guildId: string } }>(
    "/operator/guilds/:guildId",
    async (req) => {
      await authorize(req);
      return beta.detail(
        z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(req.params.guildId),
      );
    },
  );
  app.post("/operator/guilds", async (req) => {
    await authorize(req, true);
    return { invitation: await beta.change(req.body) };
  });
  app.get("/operator/overview", async (req) => {
    await authorize(req);
    return {
      work: (
        await sql`SELECT count(*) FILTER(WHERE status='QUEUED')::int AS waiting,count(*) FILTER(WHERE status IN ('RUNNING','PREPARING','FINALIZING'))::int AS running FROM analysis_runs`.execute(
          db,
        )
      ).rows[0],
      deletion: (
        await sql`SELECT count(*) FILTER(WHERE state IN ('PENDING','ERASED'))::int AS pending,count(*) FILTER(WHERE state IN ('PENDING','ERASED') AND (last_error IS NOT NULL OR attempts>=5 OR requested_at<now()-interval '1 day'))::int AS needs_attention FROM beta_deletion_jobs`.execute(
          db,
        )
      ).rows[0],
      needsAttention: (
        await sql`SELECT guild_id FROM beta_deletion_jobs WHERE state IN ('PENDING','ERASED') AND (last_error IS NOT NULL OR attempts>=5 OR requested_at<clock_timestamp()-interval '1 day') ORDER BY requested_at LIMIT 20`.execute(
          db,
        )
      ).rows,
    };
  });
  app.get("/operator/audit", async (req) => {
    await authorize(req);
    return {
      events: (
        await sql`SELECT request_id,action,guild_id,result,reason,occurred_at FROM operator_audit ORDER BY occurred_at DESC LIMIT 100`.execute(
          db,
        )
      ).rows,
    };
  });
  app.get("/operator/sessions", async (req) => {
    await authorize(req);
    return {
      sessions: (
        await sql`SELECT created_at,last_used_at,expires_at,revoked_at FROM operator_sessions ORDER BY created_at DESC LIMIT 30`.execute(
          db,
        )
      ).rows,
    };
  });
  const publications = new OfficialPublications(
    db,
    options.readLegalCandidate ?? readLegalCandidate,
  );

  app.get("/publication-document.css", async (_req, reply) =>
    reply
      .type("text/css")
      .send(
        await readFile(
          new URL(
            "../../../packages/presentation/src/publication-document.css",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
  );
  app.get("/operator/publications", async (req) => {
    await authorize(req);
    return { items: await publications.list() };
  });
  app.get<{ Params: { id: string } }>(
    "/operator/publications/:id",
    async (req) => {
      await authorize(req);
      return publications.detail(req.params.id);
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { revision?: string; locale?: string };
  }>("/operator/publications/:id/preview", async (req) => {
    await authorize(req);
    const query = z
      .object({
        revision: z.coerce.number().int().nonnegative(),
        locale: z.enum(["ja", "en"]).default("ja"),
      })
      .strict()
      .parse(req.query);
    return publications.preview(req.params.id, query.revision, query.locale);
  });
  app.post("/operator/publications", { bodyLimit: 262144 }, async (req) => {
    await authorize(req, true);
    return publications.change(req.body);
  });
  app.get("/operator/legal", async (req) => {
    await authorize(req);
    return {
      ...(await publications.legal()),
      confirmedContacts: await (
        options.readConfirmedLegalContacts ?? readConfirmedLegalContacts
      )(),
    };
  });
  app.post("/operator/legal", { bodyLimit: 262144 }, async (req) => {
    await authorize(req, true);
    return publications.saveLegal(req.body);
  });
  app.get<{
    Params: { document: string; locale: string };
    Querystring: { revision?: string };
  }>("/operator/legal/:document/:locale", async (req) => {
    await authorize(req);
    const revision = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(req.query.revision);
    return publications.legalPreview(
      req.params.document,
      req.params.locale,
      revision,
    );
  });
  return app;
}
