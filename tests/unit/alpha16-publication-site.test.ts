import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOfficialStatic, contactUnavailable, effectivePublicPricing, officialDemoSeries, officialStaticInputSchema, PUBLIC_SITE_CONTENT_VERSION, publicPricingSnapshotSchema, type PublicPricingSnapshot } from "../../packages/presentation/src/alpha16-publication";

const observedAt = "2026-10-16T12:00:00.000Z", validUntil = "2026-10-16T12:05:00.000Z";
// Synthetic fixture prices and origins only. No deployment or real catalog.
const pricing: PublicPricingSnapshot = { schemaVersion: 1, snapshotVersion: 3, source: "NEXUS_BILLING_CATALOG", approval: "APPROVED_PUBLIC", observedAt, validUntil, status: "READY",
  offerings: [{ id: "11111111-1111-4111-8111-111111111111", plan_key: "STARTER", currency: "USD", final_price_minor: 12345, tax_behavior: "INCLUSIVE" }] };
const base = () => ({ schemaVersion: 1, generation: 4, generatedAt: observedAt, officialOrigin: "https://www.nexus.example", appOrigin: "https://app.nexus.example", announcements: [], status: null, legal: [], contact: contactUnavailable });

describe("alpha16 complete official static surface", () => {
  it("creates bilingual product/demo/pricing/top and explicit copy/release versions without Next or DB input", () => {
    const release = { version: "fixture-release", publishedAt: observedAt, approval: "APPROVED_PUBLIC" };
    const result = buildOfficialStatic({ ...base(), release, pricing }, Date.parse(observedAt));
    for (const path of ["index.html", "en/index.html", "product/index.html", "en/product/index.html", "demo/index.html", "en/demo/index.html", "pricing/index.html", "en/pricing/index.html", "version.json"]) expect(result.files[path], path).toBeDefined();
    expect(result.files["en/product/index.html"]).toContain('<html lang="en">');
    expect(result.files["product/index.html"]).toContain('href="/en/product/"');
    expect(result.files["en/demo/index.html"]).toContain('href="/demo/"');
    expect(JSON.parse(result.files["version.json"]!)).toMatchObject({ generation: 4, contentVersion: PUBLIC_SITE_CONTENT_VERSION, release, pricingSnapshotVersion: 3 });
    expect(result.readiness.enabled).toBe(false);
    for (const file of result.manifest.files) expect(createHash("sha256").update(result.files[file.path]!).digest("hex")).toBe(file.sha256);
  });
  it("keeps demo data deterministic, distinguishes missing from zero and offers no analysis/save action", () => {
    expect(officialDemoSeries(7)).toHaveLength(7); expect(officialDemoSeries(30)).toHaveLength(30);
    expect(officialDemoSeries(7)[2]?.value).toBeNull(); expect(officialDemoSeries(7)[3]?.value).toBe(0);
    expect(officialDemoSeries(7)).toEqual(officialDemoSeries(7));
    const result = buildOfficialStatic(base(), Date.parse(observedAt));
    expect(result.files["demo/index.html"]).toContain("不明（欠測）");
    expect(result.files["en/demo/index.html"]).toContain("Unknown (missing data)");
    const demo = Object.entries(result.files).find(([path]) => /^assets\/demo-.+\.js$/.test(path))![1];
    for (const forbidden of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "cookie"]) expect(demo).not.toContain(forbidden);
    expect(demo).toContain("selector.value='7'");
    expect(result.files["demo/index.html"]).not.toContain("<form");
  });
  it("never reads credentials or treats a static snapshot as checkout authority", () => {
    const result = buildOfficialStatic({ ...base(), pricing }, Date.parse(observedAt));
    expect(result.files["pricing/index.html"]).toContain("https://app.nexus.example/pricing");
    expect(result.files["pricing/index.html"]).not.toContain("12345");
    expect(result.files["pricing/index.html"]).toContain("<noscript>");
    expect(result.files["pricing/index.html"]).not.toContain("<form");
    const script = Object.entries(result.files).find(([path]) => /^assets\/pricing-.+\.js$/.test(path))![1];
    expect(script).toContain("Date.now()<Date.parse(snapshot.validUntil)");
    expect(script).toContain("list.replaceChildren()");
    expect(script).not.toContain("fetch(");
    expect(JSON.parse(result.files["pricing/snapshot.json"]!)).toEqual(pricing);
  });
  it("fails closed for expired/future/missing catalogs and removes their price payloads from generated output", () => {
    expect(effectivePublicPricing(pricing, Date.parse(observedAt)).state).toBe("READY");
    expect(effectivePublicPricing(pricing, Date.parse(validUntil))).toMatchObject({ state: "STALE", offerings: [] });
    expect(effectivePublicPricing(pricing, Date.parse(observedAt) - 1).offerings).toEqual([]);
    expect(effectivePublicPricing(null, Date.parse(observedAt)).state).toBe("UNAVAILABLE");
    for (const now of [Date.parse(observedAt) - 1, Date.parse(validUntil)]) {
      const result = buildOfficialStatic({ ...base(), pricing }, now);
      expect(JSON.parse(result.files["pricing/snapshot.json"]!).offerings).toEqual([]);
      expect(Object.values(result.files).join("\n")).not.toContain("12345");
    }
    const absent = buildOfficialStatic(base(), Date.parse(observedAt));
    expect(absent.files["pricing/index.html"]).toContain("現在の価格は確認できません");
    expect(JSON.parse(absent.files["version.json"]!).release).toBeNull();
  });
  it("rejects draft releases, provider secrets, ambiguous mappings and noncanonical price sources", () => {
    expect(officialStaticInputSchema.safeParse({ ...base(), release: { version: "fixture", publishedAt: observedAt, approval: "DRAFT" } }).success).toBe(false);
    expect(publicPricingSnapshotSchema.safeParse({ ...pricing, source: "PLAN_REGISTRY_ESTIMATE" }).success).toBe(false);
    expect(publicPricingSnapshotSchema.safeParse({ ...pricing, offerings: [{ ...pricing.offerings[0], provider_price_id: "fixture-private-id" }] }).success).toBe(false);
    expect(publicPricingSnapshotSchema.safeParse({ ...pricing, offerings: [...pricing.offerings, ...pricing.offerings] }).success).toBe(false);
    expect(publicPricingSnapshotSchema.safeParse({ ...pricing, validUntil: observedAt }).success).toBe(false);
    expect(publicPricingSnapshotSchema.safeParse({ ...pricing, status: "CLOSED" }).success).toBe(false);
  });
  it("polls only the independent public status file and keeps failed or expired reads unknown", () => {
    const result = buildOfficialStatic(base(), Date.parse(observedAt));
    const script = Object.entries(result.files).find(([path]) => /^assets\/status-.+\.js$/.test(path))![1];
    expect(script).toContain("fetch('/status/status.json'");
    expect(script).toContain("credentials:'omit'");
    expect(script).toContain("catch{snapshot=null}");
    expect(script).not.toContain("app.nexus.example");
    expect(result.files["status/index.html"]).toContain("data-status-generated");
  });
});
