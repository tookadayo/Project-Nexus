import EmbeddedPostgres from "embedded-postgres";
import Fastify from "fastify";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import {
  connect,
  migrate,
  sql,
  ensureGuild,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import {
  BillingService,
  StripeBillingProvider,
} from "../../packages/settings/src/billing";
import Stripe from "../../packages/settings/node_modules/stripe/esm/stripe.esm.node.js";
const port = Number(process.env.NEXUS_CHECKOUT_API_PORT ?? 3161),
  web = Number(process.env.NEXUS_CHECKOUT_WEB_PORT ?? 3160),
  user = "911111111111111111",
  other = "911111111111111112";
const ids = [
    "931111111111112111",
    "931111111111112112",
    "931111111111112113",
    "931111111111112114",
  ],
  offering = "11111111-1111-4111-8111-111111111119";
await mkdir(".local", { recursive: true });
const dir = await mkdtemp(resolve(".local/pg-checkout-e2e-"));
const pgPort = await new Promise<number>((done) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const a = s.address();
    if (!a || typeof a === "string") throw new Error("PORT");
    s.close(() => done(a.port));
  });
});
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "nexus",
  password: "nexus",
  port: pgPort,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
await pg.initialise();
await pg.start();
const databaseUrl = `postgresql://nexus:nexus@127.0.0.1:${pgPort}/postgres`,
  db = connect(databaseUrl),
  vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
await migrate(db);
await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${offering}::uuid,'GROWTH',2,'STRIPE',true,'USD',4900,'prod_fixture_growth','price_fixture_growth','EXCLUSIVE')`.execute(
  db,
);
for (const guildId of ids) await ensureGuild(db, scopeForGuild(guildId));
await writeFile(".local/checkout-e2e.json", JSON.stringify({ databaseUrl }));
const owners = new Map(ids.map((id, i) => [id, i < 2 ? user : other])),
  installed = new Set([ids[0], ids[2], ids[3]]),
  sessions = new Map<string, Record<string, unknown>>(),
  subscriptions = new Map<string, Record<string, unknown>>(),
  idempotency = new Map<string, string>();
let checkoutCalls = 0;
const price = {
  id: "price_fixture_growth",
  object: "price",
  product: "prod_fixture_growth",
  active: true,
  livemode: false,
  currency: "usd",
  unit_amount: 4900,
  type: "recurring",
  billing_scheme: "per_unit",
  transform_quantity: null,
  tax_behavior: "exclusive",
  recurring: {
    interval: "month",
    interval_count: 1,
    usage_type: "licensed",
    trial_period_days: null,
  },
};
const app = Fastify({ logger: false });
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", `http://127.0.0.1:${web}`);
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return reply.code(204).send();
});
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, body, done) => done(null, new URLSearchParams(String(body))),
);
app.get("/health", async () => ({ ok: true }));
app.post("/fixture/discord/oauth2/token", async (request) => ({
  access_token: `checkout-oauth-${(request.body as URLSearchParams).get("code") === "other-user" ? other : user}`,
  expires_in: 3600,
  scope: "identify guilds",
}));
app.get("/fixture/discord/users/@me", async (request) => ({
  id: request.headers.authorization?.split("-").at(-1) ?? user,
}));
app.get("/fixture/discord/users/@me/guilds", async (req) =>
  req.headers.authorization?.startsWith("Bot ")
    ? ids.filter((id) => installed.has(id)).map((id) => ({ id }))
    : ids.map((id, i) => ({
        id,
        name: [
          "Owner community with a long descriptive server name",
          "Install community",
          "Administrator community",
          "Manage Server community",
        ][i],
        owner: i < 2,
        permissions: i === 2 ? "8" : i === 3 ? "32" : "0",
      })),
);
app.get("/fixture/discord/guilds/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  return installed.has(id)
    ? {
        id,
        name: "Owner community with a long descriptive server name",
        owner_id: owners.get(id),
      }
    : reply.code(404).send({});
});
app.get("/fixture/discord/guilds/:id/roles", async (req) => {
  const { id } = req.params as { id: string };
  return [
    {
      id,
      permissions: id === ids[2] ? "8" : id === ids[3] ? "32" : "0",
      position: 0,
      managed: false,
    },
  ];
});
app.get("/fixture/discord/guilds/:id/members/:user", async (req, reply) => {
  const { id } = req.params as { id: string };
  return installed.has(id)
    ? { roles: [], joined_at: "2026-01-01T00:00:00Z", user: { bot: false } }
    : reply.code(404).send({});
});
app.post("/fixture/owner", async (req) => {
  const { guildId, ownerId } = req.body as { guildId: string; ownerId: string };
  owners.set(guildId, ownerId);
  return { ok: true };
});
app.post("/fixture/install", async () => {
  installed.add(ids[1]);
  return { ok: true };
});
app.get("/fixture/stripe/v1/prices/:id", async () => price);
app.get("/fixture/stripe/v1/products/:id", async () => ({
  id: "prod_fixture_growth",
  active: true,
  livemode: false,
}));
app.post("/fixture/stripe/v1/customers", async (req) => ({
  id:
    "cus_fixture_" +
    String((req.body as URLSearchParams).get("metadata[nexus_operation]")),
  livemode: false,
}));
app.get("/fixture/stripe/v1/customers/:id", async (req) => ({
  id: (req.params as { id: string }).id,
  livemode: false,
}));
app.get("/fixture/stripe/v1/subscriptions", async (req) => ({
  object: "list",
  has_more: false,
  data: [...subscriptions.values()].filter(
    (s) => s.customer === (req.query as { customer: string }).customer,
  ),
}));
app.get("/fixture/stripe/v1/subscriptions/:id", async (req) =>
  subscriptions.get((req.params as { id: string }).id),
);
app.get("/fixture/stripe/v1/billing_portal/configurations/:id", async () => ({
  id: "bpc_fixture",
  active: true,
  livemode: false,
  features: {
    subscription_update: { enabled: false },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
  },
}));
app.post("/fixture/stripe/v1/billing_portal/sessions", async () => ({
  url: "https://billing.stripe.com/p/session/fixture",
}));
app.post("/fixture/stripe/v1/checkout/sessions", async (req) => {
  const body = req.body as URLSearchParams,
    key = req.headers["idempotency-key"] as string;
  if (idempotency.has(key)) return sessions.get(idempotency.get(key)!);
  const id = "cs_fixture_" + String(++checkoutCalls),
    session = {
      id,
      object: "checkout.session",
      livemode: false,
      mode: "subscription",
      status: "open",
      client_secret: id + "_secret_fixture",
      expires_at: Number(body.get("expires_at")),
      customer: body.get("customer"),
      client_reference_id: body.get("client_reference_id"),
      url: "https://checkout.stripe.com/c/pay/" + id,
      return_url: body.get("return_url"),
    };
  sessions.set(id, session);
  idempotency.set(key, id);
  return session;
});
app.get("/fixture/stripe/v1/checkout/sessions/:id", async (req) =>
  sessions.get((req.params as { id: string }).id),
);
app.post("/fixture/stripe/v1/checkout/sessions/:id/expire", async (req) => {
  const session = sessions.get((req.params as { id: string }).id)!;
  session.status = "expired";
  return session;
});
const env = {
  NODE_ENV: "development" as const,
  NEXUS_STRIPE_ENABLED: "true",
  NEXUS_STRIPE_MODE: "SANDBOX",
  STRIPE_SECRET_KEY: "sk_test_fixture_checkout",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_checkout",
  NEXUS_WEB_URL: `http://127.0.0.1:${web}`,
  NEXUS_BILLING_DEVELOPER_COUNTRY: "JP",
};
const sdk = new Stripe(env.STRIPE_SECRET_KEY, {
  host: "127.0.0.1",
  port,
  protocol: "http",
});
const transport = Stripe.createNodeHttpClient(),
  makeRequest = transport.makeRequest.bind(transport);
transport.makeRequest = (host, p, path, ...args) =>
  makeRequest(host, p, "/fixture/stripe" + path, ...args);
const providerClient = new Stripe(env.STRIPE_SECRET_KEY, {
  host: "127.0.0.1",
  port,
  protocol: "http",
  httpClient: transport,
});
const provider = new StripeBillingProvider({ env, client: providerClient }),
  billing = new BillingService(db, vault);
app.post("/fixture/payment", async (req) => {
  const { clientSecret } = req.body as { clientSecret: string },
    session = [...sessions.values()].find(
      (s) => s.client_secret === clientSecret,
    )!;
  session.status = "complete";
  session.subscription = "sub_fixture_" + session.id;
  const now = Math.floor(Date.now() / 1000),
    sub = {
      id: session.subscription,
      object: "subscription",
      livemode: false,
      customer: session.customer,
      metadata: {},
      status: "active",
      cancel_at_period_end: false,
      pending_update: null,
      schedule: null,
      discounts: [],
      latest_invoice: null,
      trial_start: null,
      items: {
        object: "list",
        has_more: false,
        data: [
          {
            id: "si_fixture",
            price,
            quantity: 1,
            current_period_start: now,
            current_period_end: now + 86400,
          },
        ],
      },
    };
  subscriptions.set(String(sub.id), sub);
  return { ok: true };
});
app.post("/fixture/webhook", async (_req) => {
  const session = [...sessions.values()].find((s) => s.status === "complete")!;
  const body = JSON.stringify({
      id: "evt_fixture_" + session.id,
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session },
    }),
    signature = sdk.webhooks.generateTestHeaderString({
      payload: body,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });
  const response = await fetch(
    `http://127.0.0.1:${web}/billing/webhooks/stripe`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signature,
      },
      body,
    },
  );
  return { status: response.status, body: await response.json() };
});
app.post("/fixture/reconcile", async () => {
  for (const guildId of ids) {
    try {
      await billing.reconcileLatest(scopeForGuild(guildId), provider);
    } catch {
      /* Unpurchased scopes have no trusted binding. */
    }
  }
  for (let i = 0; i < 30; i++) if (!(await billing.projectOne())) break;
  return { ok: true };
});
app.post("/fixture/higher-grant", async (req) => {
  const scope = scopeForGuild(ids[0]!),
    enabled = (req.body as { enabled: boolean }).enabled,
    grantId = "11111111-1111-4111-8111-111111111120";
  if (enabled)
    await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,reason) VALUES(${grantId}::uuid,${scope.organizationId}::uuid,${scope.guildId},'PARTNER','SCALE','Checkout confirmation regression fixture')`.execute(
      db,
    );
  else
    await sql`UPDATE entitlement_grants SET revoked_at=now() WHERE id=${grantId}::uuid AND organization_id=${scope.organizationId}::uuid AND guild_id=${scope.guildId}`.execute(
      db,
    );
  return { plan: (await billing.status(scope)).plan };
});
app.get("/fixture/count", async () => ({ checkoutCalls }));
await app.listen({ host: "127.0.0.1", port });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  await db.destroy();
  await pg.stop();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
