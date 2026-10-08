import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";

let infra: Awaited<ReturnType<typeof infrastructure>>, admin: Database;
beforeAll(async () => {
  infra = await infrastructure();
  admin = connect(infra.databaseUrl);
});
afterAll(async () => {
  await admin?.destroy();
  await infra?.stop();
});
async function isolated(run: (db: Database) => Promise<void>) {
  const schema = "hardening_" + randomUUID().replaceAll("-", "");
  await sql.raw(`CREATE SCHEMA ${schema}`).execute(admin);
  const url = new URL(infra.databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = connect(url.toString());
  try {
    await run(db);
  } finally {
    await db.destroy();
    await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(admin);
  }
}
for (const from of [34, 37, 38, null])
  it(`${from ?? "fresh database"} -> latest preserves identities and applies 039 exactly once`, async () => {
    await isolated(async (db) => {
      const s = { organizationId: randomUUID(), guildId: "911111111111111111" };
      if (from) {
        await migrate(db, { throughVersion: from });
        await ensureGuild(db, s);
        await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key) VALUES(${s.organizationId}::uuid,${s.guildId},'STARTER')`.execute(
          db,
        );
        if (from >= 37) {
          const provider = from === 37 ? "EXTERNAL" : "EXTERNAL_LEGACY",
            account = randomUUID();
          await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${account}::uuid,${s.organizationId}::uuid)`.execute(
            db,
          );
          await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext) VALUES(${randomUUID()}::uuid,${account}::uuid,${provider},'old-customer-digest','old-customer-ciphertext')`.execute(
            db,
          );
          await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,status,provider_event_at,provider_event_key) VALUES(${randomUUID()}::uuid,${account}::uuid,${s.organizationId}::uuid,${provider},'old-subscription-digest','old-subscription-ciphertext','GROWTH','ACTIVE',now(),'old-event-key')`.execute(
            db,
          );
          await sql`INSERT INTO billing_audit_log(id,organization_id,guild_id,action,metadata) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'historical.fixture','{"provider":"EXTERNAL","digest":"original"}')`.execute(
            db,
          );
        }
        if (from === 38) {
          await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,provider_offering_id) VALUES(${randomUUID()}::uuid,'GROWTH',2,'DISCORD',true,'historical-sku')`.execute(
            db,
          );
          await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest,lease_token,lease_until) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'STRIPE','CHANGE','old-request-digest','old-input-digest',${randomUUID()}::uuid,now()+interval '1 minute')`.execute(
            db,
          );
        }
      }
      await migrate(db);
      await migrate(db);
      expect(
        (
          await sql<{
            n: number;
          }>`SELECT count(*)::integer AS n FROM schema_migrations`.execute(db)
        ).rows[0]!.n,
      ).toBe(50);
      if (from)
        expect(
          (
            await sql<{
              plan_key: string;
            }>`SELECT plan_key FROM guild_subscriptions WHERE guild_id=${s.guildId}`.execute(
              db,
            )
          ).rows[0]!.plan_key,
        ).toBe("STARTER");
      if (from && from >= 37) {
        expect(
          (
            await sql`SELECT provider,reference_digest,reference_ciphertext FROM billing_subscriptions`.execute(
              db,
            )
          ).rows[0],
        ).toEqual({
          provider: "EXTERNAL_LEGACY",
          reference_digest: "old-subscription-digest",
          reference_ciphertext: "old-subscription-ciphertext",
        });
        expect(
          (
            await sql`SELECT provider,reference_digest,reference_ciphertext,reference_guild_id FROM billing_provider_customers`.execute(
              db,
            )
          ).rows[0],
        ).toEqual({
          provider: "EXTERNAL_LEGACY",
          reference_digest: "old-customer-digest",
          reference_ciphertext: "old-customer-ciphertext",
          reference_guild_id: null,
        });
        expect(
          (
            await sql<{
              metadata: unknown;
            }>`SELECT metadata FROM billing_audit_log`.execute(db)
          ).rows[0]!.metadata,
        ).toEqual({ provider: "EXTERNAL", digest: "original" });
      }
      if (from === 38) {
        expect(
          (
            await sql`SELECT state,request_digest,input_digest FROM billing_operations`.execute(
              db,
            )
          ).rows[0],
        ).toEqual({
          state: "RECONCILE_REQUIRED",
          request_digest: "old-request-digest",
          input_digest: "old-input-digest",
        });
        await expect(
          sql`UPDATE billing_offerings SET final_price_minor=42`.execute(db),
        ).rejects.toThrow("BILLING_OFFERING_IMMUTABLE");
      }
    });
  });
it("rejects all enabled commercial identity mutations, including after disable, while allowing operational review", async () => {
  await isolated(async (db) => {
    await migrate(db);
    const id = randomUUID();
    await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,provider_offering_id,billing_interval,currency,final_price_minor,tax_behavior,enabled) VALUES(${id}::uuid,'GROWTH',2,'STRIPE','fixture-product','fixture-price','fixture-neutral','MONTH','JPY',1000,'EXCLUSIVE',true)`.execute(
      db,
    );
    for (const change of [
      "plan_key='STARTER'",
      "plan_revision=3",
      "provider='DISCORD'",
      "provider_product_id='changed'",
      "provider_price_id='changed'",
      "provider_offering_id='changed'",
      "billing_interval='YEAR'",
      "billing_interval_count=2",
      "currency='USD'",
      "final_price_minor=999",
      "tax_behavior='INCLUSIVE'",
    ]) {
      await expect(
        sql
          .raw(`UPDATE billing_offerings SET ${change} WHERE id='${id}'`)
          .execute(db),
      ).rejects.toThrow("BILLING_OFFERING_IMMUTABLE");
    }
    await sql`UPDATE billing_offerings SET enabled=false,parity_reviewed_at=now(),commercial_locked=false WHERE id=${id}::uuid`.execute(
      db,
    );
    const results = await Promise.allSettled([
      sql`UPDATE billing_offerings SET final_price_minor=0 WHERE id=${id}::uuid`.execute(
        db,
      ),
      sql`UPDATE billing_offerings SET provider_price_id='concurrent' WHERE id=${id}::uuid`.execute(
        db,
      ),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(
      (
        await sql<{
          commercial_locked: boolean;
        }>`SELECT commercial_locked FROM billing_offerings WHERE id=${id}::uuid`.execute(
          db,
        )
      ).rows[0]!.commercial_locked,
    ).toBe(true);
  });
});
it("requires complete Stripe commercial mapping at the database enable boundary", async () => {
  await isolated(async (db) => {
    await migrate(db);
    const id = randomUUID();
    await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider) VALUES(${id}::uuid,'GROWTH',2,'STRIPE')`.execute(
      db,
    );
    await expect(
      sql`UPDATE billing_offerings SET enabled=true WHERE id=${id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow("stripe_enabled_commercial_mapping");
    await sql`UPDATE billing_offerings SET provider_product_id='fixture-product',provider_price_id='fixture-price',currency='JPY',final_price_minor=1000,tax_behavior='EXCLUSIVE',enabled=true WHERE id=${id}::uuid`.execute(
      db,
    );
  });
});

it("concurrent guild commercial uses of one Offering do not upgrade shared locks or deadlock", async () => {
  await isolated(async (db) => {
    await migrate(db);
    const id = randomUUID(),
      organizationId = randomUUID();
    const scopes = ["911111111111111112", "911111111111111113"].map(
      (guildId) => ({ organizationId, guildId }),
    );
    for (const scope of scopes) await ensureGuild(db, scope);
    await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled) VALUES(${id}::uuid,'GROWTH',2,'DISCORD',true)`.execute(
      db,
    );
    let readers = 0,
      release!: () => void;
    const bothReading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.all(
      scopes.map((scope) =>
        db.transaction().execute(async (tx) => {
          await sql`SELECT id FROM billing_offerings WHERE id=${id}::uuid FOR SHARE`.execute(
            tx,
          );
          if (++readers === 2) release();
          await bothReading;
          await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest,offering_id) VALUES(${randomUUID()}::uuid,${organizationId}::uuid,${scope.guildId},'DISCORD','CHECKOUT',${randomUUID()},'trusted-test-input',${id}::uuid)`.execute(
            tx,
          );
          return true;
        }),
      ),
    );
    expect(results).toEqual([true, true]);
  });
});
