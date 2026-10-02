import { it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { ComponentType, MessageFlags } from "discord-api-types/v10";
import {
  billingPanel,
  promotionResultPanel,
  lockedFeaturePanel,
} from "../../packages/discord-panels/src/views/billing";
import { promotionModal } from "../../apps/interaction/src/billing-modal";
import {
  plans,
  planRegistry,
  canonicalFeatures,
  featureAvailability,
} from "../../packages/settings/src/plan-registry";
import {
  resolveEntitlements,
  featureDecision,
} from "../../packages/settings/src/billing";
import { verifyBillingHmac } from "../../packages/security/src/billing-signature";
import { visibleMetrics } from "../../packages/settings/src/metric-visibility";
import {
  observedSurfaceUsage,
  surfaceUsageKey,
  surfaceFor,
} from "../../packages/shared/src/community-model";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { representativeSource } from "../fixtures/community-profiles";
const issue = async (intent: Record<string, unknown>) =>
  "private:" + intent.action;
function checkLimits(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const item = node as {
    type?: number;
    label?: string;
    custom_id?: string;
    components?: unknown[];
  };
  if (item.label) expect(item.label.length).toBeLessThanOrEqual(80);
  if (item.custom_id) expect(item.custom_id.length).toBeLessThanOrEqual(100);
  if (item.type === ComponentType.ActionRow)
    expect(item.components!.length).toBeLessThanOrEqual(5);
  return (
    Number(item.type !== undefined) +
    (item.components ?? []).reduce<number>(
      (n, child) => n + checkLimits(child),
      0,
    )
  );
}
for (const locale of ["en", "ja"] as const)
  for (const plan of plans)
    it(`Components V2 ${plan} plan view is bounded and human-readable in ${locale}`, async () => {
      const view = await billingPanel(
        issue,
        {
          plan,
          used: 12,
          included: planRegistry[plan].limits.monthlyObservedMembers,
          softLimit: null,
          projected: 15,
          automaticOverageCharge: false,
          features: canonicalFeatures.filter(
            (key) =>
              planRegistry[plan].features.includes(key) &&
              featureAvailability[key] === "available",
          ),
          webUrl: "https://nexus.example",
          native: "NOT_CONFIGURED",
          canManage: true,
          subscriptions: [{ provider: "EXTERNAL_LEGACY", status: "PAST_DUE" }],
        },
        locale,
      );
      expect(view.flags).toBe(MessageFlags.IsComponentsV2);
      expect(checkLimits(view)).toBeLessThanOrEqual(40);
      const text = JSON.stringify(view);
      expect(text).toContain(plan);
      expect(text).toContain("EXTERNAL_LEGACY · PAST_DUE");
      expect(text).toContain(
        locale === "ja" ? "プロモーションコード" : "Promotion code",
      );
      expect(text).not.toContain("core_observation");
      expect(text).not.toContain("attention_automation");
      expect(text).not.toContain("discord.com/application-directory");
    });
it("only configured native billing exposes official purchase links, with grant/conflict/grace warnings", async () => {
  const base = {
    plan: "GROWTH",
    used: 250,
    included: 5000,
    softLimit: null,
    projected: 260,
    automaticOverageCharge: false,
    canManage: true,
    webUrl: "https://nexus.example",
    grants: [{ source: "PARTNER", endsAt: null }],
    conflict: true,
    grace: true,
  };
  const panel = await billingPanel(issue, {
    ...base,
    native: "AVAILABLE",
    nativeUrl:
      "https://discord.com/application-directory/111111111111111111/store",
  });
  const text = JSON.stringify(panel);
  expect(text).toContain("Upgrade in Discord");
  expect(text).toContain("Partner grant");
  expect(text).toContain("Billing conflict");
  expect(text).toContain("Billing grace");
  expect(checkLimits(panel)).toBeLessThanOrEqual(40);
  const manager = JSON.stringify(
    await billingPanel(issue, {
      ...base,
      native: "AVAILABLE",
      nativeUrl:
        "https://discord.com/application-directory/111111111111111111/store",
      canManage: false,
    }),
  );
  expect(manager).not.toContain("Upgrade in Discord");
  expect(manager).not.toContain("Promotion code");
});
it("promotion and lock panels contain clear results without campaign internals", async () => {
  for (const locale of ["en", "ja"] as const) {
    const success = await promotionResultPanel(
        issue,
        { plan: "GROWTH", benefitEnd: "2026-12-31T00:00:00Z" },
        locale,
      ),
      failure = await promotionResultPanel(issue, null, locale);
    expect(checkLimits(success)).toBeLessThanOrEqual(40);
    expect(JSON.stringify(success)).toContain("GROWTH");
    expect(JSON.stringify(failure)).toContain(
      locale === "ja"
        ? "このコードはこのサーバーでは利用できません"
        : "This code cannot be used for this server",
    );
    expect(JSON.stringify(failure)).not.toContain("campaign");
    const state = resolveEntitlements({ subscriptions: [], grants: [] });
    expect(
      JSON.stringify(
        await lockedFeaturePanel(
          issue,
          featureDecision(state, "attention_automation"),
          "attention_automation",
          locale,
        ),
      ),
    ).toContain("GROWTH");
    const modal = promotionModal("private:redeem", locale);
    expect(modal.components[0]!.components[0]!.max_length).toBe(128);
    expect(JSON.stringify(modal)).not.toContain("NXP-");
  }
});
it("billing signature helper rejects replay, mutation, malformed/oversized input and weak secrets", () => {
  const body = Buffer.from('{"safe":"fixture"}'),
    secret = "x".repeat(32),
    timestamp = "1790899200",
    now = Number(timestamp) * 1000,
    signature = createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(body)
      .digest("hex");
  expect(verifyBillingHmac(body, signature, timestamp, secret, now)).toBe(true);
  expect(
    verifyBillingHmac(body, signature, timestamp, secret, now + 300001),
  ).toBe(false);
  expect(
    verifyBillingHmac(
      Buffer.from("tampered"),
      signature,
      timestamp,
      secret,
      now,
    ),
  ).toBe(false);
  expect(verifyBillingHmac(body, "x", timestamp, secret, now)).toBe(false);
  expect(
    verifyBillingHmac(Buffer.alloc(65537), signature, timestamp, secret, now),
  ).toBe(false);
  expect(verifyBillingHmac(body, signature, timestamp, "weak", now)).toBe(
    false,
  );
});
it("Announcement activity uses the exact capability key; Forum and future channel types are tolerant", () => {
  const source = representativeSource(7),
    usage = observedSurfaceUsage([{ surface: "ANNOUNCEMENT", count: 3 }]);
  expect(usage).toEqual({ [surfaceUsageKey.ANNOUNCEMENT]: 3 });
  const snapshot = buildCapabilitySnapshot(source, new Date(), null, usage);
  expect(snapshot.capabilities.announcement?.status).toBe("OBSERVED");
  expect(snapshot.observedUsage).not.toHaveProperty("announcements");
  const forum = buildCapabilitySnapshot({
    ...source,
    features: [],
    channels: [
      {
        id: "111111111111111111",
        type: 15,
        parentId: null,
        observable: true,
        tagIds: [],
      },
    ],
  });
  expect(forum.capabilities.forum?.status).toBe("ENABLED");
  expect(surfaceFor(255)).toBe("UNKNOWN");
});
it("Free metric filtering preserves UNKNOWN/PARTIAL evidence and core counts without mutating computation", () => {
  const state = resolveEntitlements({ subscriptions: [], grants: [] }),
    metrics = {
      median_first_reply_latency: {
        value: 120,
        evidence: { value: 120, coverageState: "PARTIAL", sampleSize: 10 },
      },
      directReplies: {
        value: 22,
        evidence: { value: 22, coverageState: "PARTIAL", sampleSize: 22 },
      },
    },
    visible = visibleMetrics(metrics, state);
  expect(visible.median_first_reply_latency.value).toBeNull();
  expect(visible.median_first_reply_latency.evidence.coverageState).toBe(
    "PARTIAL",
  );
  expect(visible.directReplies.value).toBe(22);
  expect(metrics.median_first_reply_latency.value).toBe(120);
});
