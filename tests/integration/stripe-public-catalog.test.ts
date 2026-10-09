import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { isolatedPostgres } from "../fixtures/postgres";
import { publicBillingCatalog } from "../../apps/web/app/billing/catalog";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", infra.databaseUrl);
  vi.stubEnv("NEXUS_STRIPE_ENABLED", "true");
  vi.stubEnv("NEXUS_STRIPE_MODE", "SANDBOX");
  vi.stubEnv("NEXUS_STRIPE_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXUS_STRIPE_PUBLIC_SALES_ENABLED", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic_catalog_fixture");
  await sql`UPDATE billing_offerings SET enabled=false`.execute(db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.destroy();
  await infra?.stop();
});
async function offering(patch: Record<string, unknown> = {}) {
  const id = randomUUID();
  const r = {
    id,
    plan_key: "STARTER",
    plan_revision: 2,
    provider: "STRIPE",
    provider_product_id: "prod_synthetic_" + id,
    provider_price_id: "price_synthetic_" + id,
    billing_interval: "MONTH",
    billing_interval_count: 1,
    currency: "USD",
    final_price_minor: 1587,
    tax_behavior: "EXCLUSIVE",
    enabled: true,
    ...patch,
  };
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,billing_interval,billing_interval_count,currency,final_price_minor,tax_behavior,enabled)
    VALUES(${r.id}::uuid,${r.plan_key},${r.plan_revision},${r.provider},${r.provider_product_id},${r.provider_price_id},${r.billing_interval},${r.billing_interval_count},${r.currency},${r.final_price_minor},${r.tax_behavior},${r.enabled})`.execute(
    db,
  );
  return id;
}
it("reads only enabled monthly USD subscriptions, without provider mappings in the public DTO", async () => {
  const id = await offering();
  await offering({ currency: "JPY" });
  await offering({ billing_interval: "YEAR" });
  await offering({ billing_interval_count: 3 });
  await offering({ enabled: false });
  await offering({ provider: "MANUAL" });
  await offering({ plan_key: "FREE" });
  await offering({ plan_key: "ENTERPRISE" });
  const result = await publicBillingCatalog();
  expect(result.status).toBe("READY");
  expect(result.offerings).toEqual([
    {
      id,
      plan_key: "STARTER",
      currency: "USD",
      final_price_minor: 1587,
      tax_behavior: "EXCLUSIVE",
    },
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /prod_synthetic|price_synthetic|sk_test|DATABASE_URL/,
  );
});
it("hides an ambiguous plan while keeping another unique plan available", async () => {
  await offering();
  await offering({ final_price_minor: 1675 });
  const growth = await offering({
    plan_key: "GROWTH",
    final_price_minor: 4923,
    tax_behavior: "INCLUSIVE",
  });
  const result = await publicBillingCatalog();
  expect(result.offerings.map((row) => row.id)).toEqual([growth]);
  expect(result.offerings[0]!.tax_behavior).toBe("INCLUSIVE");
});
it("reflects disabled mappings on the next read without a stale cached price", async () => {
  const id = await offering();
  expect((await publicBillingCatalog()).offerings).toHaveLength(1);
  await sql`UPDATE billing_offerings SET enabled=false WHERE id=${id}::uuid`.execute(
    db,
  );
  const result = await publicBillingCatalog();
  expect(result.status).toBe("EMPTY");
  expect(result.offerings).toEqual([]);
  expect(
    (
      await sql`SELECT id FROM billing_offerings WHERE id=${id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("public sales closure retains internal management capability but returns no prices", async () => {
  await offering();
  vi.stubEnv("NEXUS_STRIPE_PUBLIC_SALES_ENABLED", "false");
  const result = await publicBillingCatalog();
  expect(result.status).toBe("CLOSED");
  expect(result.offerings).toEqual([]);
  expect(result.launch.managementEnabled).toBe(true);
  expect(result.launch.checkoutEnabled).toBe(true);
});
it("returns an explicit unavailable state for missing or failed DB configuration without exposing an error", async () => {
  vi.stubEnv("DATABASE_URL", "");
  expect((await publicBillingCatalog()).status).toBe("UNAVAILABLE");
  const unreachable = new URL(infra.databaseUrl);
  unreachable.pathname = "/synthetic_database_does_not_exist";
  vi.stubEnv("DATABASE_URL", unreachable.toString());
  const result = await publicBillingCatalog();
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.offerings).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("synthetic_database");
});
