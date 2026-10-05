import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  basePriceCompatibility,
  commercialDiscountEvidenceSchema,
  discountCompatibility,
  matchesPromotionCommercialEvidence,
  promotionCheckoutContextSchema,
} from "../../packages/settings/src/billing/policy";

const context = () =>
  promotionCheckoutContextSchema.parse({
    reservationId: randomUUID(),
    campaignId: randomUUID(),
    offeringId: randomUUID(),
    provider: "STRIPE",
    planKey: "GROWTH",
    planRevision: 2,
    billingInterval: "MONTH",
    billingIntervalCount: 1,
    currency: "JPY",
    unitAmountMinor: 4900,
    taxBehavior: "EXCLUSIVE",
    discountType: "PERCENT",
    discountValue: 10,
    finalPreTaxAmountMinor: 4410,
    providerTrial: false,
  });

it("requires reviewed comparable normal and discounted final pre-tax prices", () => {
  const base = {
    provider: "STRIPE" as const,
    basePriceMinor: 4900,
    discordFinalPriceMinor: 4901,
    discordOfferingSupported: true,
    parityReviewed: true,
    parityObligation: true,
    baseCurrency: "JPY",
    discordCurrency: "JPY",
  };
  expect(basePriceCompatibility(base).reason).toBe(
    "DISCORD_PRICE_PARITY_REJECTED",
  );
  expect(
    basePriceCompatibility({ ...base, discordFinalPriceMinor: 4900 }).allowed,
  ).toBe(true);
  expect(
    basePriceCompatibility({ ...base, parityReviewed: false }).reason,
  ).toBe("DISCORD_PRICE_PARITY_UNVERIFIED");
  expect(
    basePriceCompatibility({ ...base, discordCurrency: "USD" }).reason,
  ).toBe("DISCORD_PRICE_CURRENCY_UNVERIFIED");
  expect(
    basePriceCompatibility({
      ...base,
      discordOfferingSupported: false,
      parityObligation: null,
    }).reason,
  ).toBe("OFFERING_POLICY_REVIEW_REQUIRED");
  expect(
    discountCompatibility({
      ...base,
      discountType: "PERCENT",
      discountValue: 10,
      discordFinalPriceMinor: 4411,
    }).reason,
  ).toBe("DISCORD_PRICE_PARITY_REJECTED");
});

it("matches reservation, Offering and every normalized commercial term", () => {
  const expected = context();
  const { campaignId, ...terms } = expected;
  expect(campaignId).toMatch(/^[0-9a-f-]+$/);
  const evidence = commercialDiscountEvidenceSchema.parse({
    ...terms,
    discountApplied: true,
  });
  expect(matchesPromotionCommercialEvidence(expected, evidence)).toBe(true);
  expect(matchesPromotionCommercialEvidence(expected, null)).toBe(false);
  for (const patch of [
    { reservationId: randomUUID() },
    { offeringId: randomUUID() },
    { finalPreTaxAmountMinor: 4409 },
    { discountValue: 20 },
    { currency: "USD" },
    { billingInterval: "YEAR" },
    { discountApplied: false },
    { providerTrial: true },
    { plaintextCode: "NXP-NEVER-PASS-A-CODE" },
  ])
    expect(
      matchesPromotionCommercialEvidence(expected, { ...evidence, ...patch }),
    ).toBe(false);
});

it("does not represent trial plus discount or unverified inclusive pre-tax amounts", () => {
  expect(
    promotionCheckoutContextSchema.safeParse({
      ...context(),
      providerTrial: true,
    }).success,
  ).toBe(false);
  expect(
    promotionCheckoutContextSchema.safeParse({
      ...context(),
      taxBehavior: "INCLUSIVE",
    }).success,
  ).toBe(false);
});
