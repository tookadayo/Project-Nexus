import { z } from "zod";
import type { BillingProviderKind } from "./domain";
import { plans } from "../plan-registry";

// No code, provider payload, or customer identifier crosses this contract.
// Alpha.7 payment discounts never combine with provider or NEXUS trials.
export const promotionCheckoutContextSchema = z
  .object({
    reservationId: z.uuid(),
    campaignId: z.uuid(),
    offeringId: z.uuid(),
    provider: z.literal("STRIPE"),
    planKey: z.enum(plans),
    planRevision: z.number().int().positive(),
    billingInterval: z.enum(["MONTH", "YEAR"]),
    billingIntervalCount: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    unitAmountMinor: z.number().int().nonnegative(),
    taxBehavior: z.literal("EXCLUSIVE"),
    discountType: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.number().int().positive(),
    finalPreTaxAmountMinor: z.number().int().nonnegative(),
    providerTrial: z.literal(false),
  })
  .strict();
export type PromotionCheckoutContext = z.infer<
  typeof promotionCheckoutContextSchema
>;
export const commercialDiscountEvidenceSchema = promotionCheckoutContextSchema
  .omit({ campaignId: true })
  .extend({ discountApplied: z.literal(true) })
  .strict();
export type CommercialDiscountEvidence = z.infer<
  typeof commercialDiscountEvidenceSchema
>;
export function matchesPromotionCommercialEvidence(
  context: PromotionCheckoutContext,
  input: unknown,
) {
  const parsed = commercialDiscountEvidenceSchema.safeParse(input);
  if (!parsed.success) return false;
  return Object.entries(context).every(
    ([key, value]) =>
      key === "campaignId" ||
      parsed.data[key as keyof CommercialDiscountEvidence] === value,
  );
}
export type BasePricePolicyInput = {
  provider: BillingProviderKind;
  basePriceMinor: number | null;
  discordFinalPriceMinor: number | null;
  discordOfferingSupported: boolean;
  parityReviewed: boolean;
  parityObligation?: boolean | null;
  baseCurrency?: string | null;
  discordCurrency?: string | null;
};
export function basePriceCompatibility(input: BasePricePolicyInput) {
  if (
    input.basePriceMinor === null ||
    !Number.isSafeInteger(input.basePriceMinor) ||
    input.basePriceMinor < 0
  )
    return { allowed: false, reason: "OFFERING_PRICE_UNVERIFIED" };
  const parity = input.discordOfferingSupported
    ? true
    : input.parityObligation === undefined
      ? false
      : input.parityObligation;
  if (parity === null)
    return { allowed: false, reason: "OFFERING_POLICY_REVIEW_REQUIRED" };
  if (
    parity &&
    (!input.parityReviewed ||
      input.discordFinalPriceMinor === null ||
      !Number.isSafeInteger(input.discordFinalPriceMinor) ||
      input.discordFinalPriceMinor < 0)
  )
    return { allowed: false, reason: "DISCORD_PRICE_PARITY_UNVERIFIED" };
  if (
    parity &&
    (!input.baseCurrency || input.baseCurrency !== input.discordCurrency)
  )
    return { allowed: false, reason: "DISCORD_PRICE_CURRENCY_UNVERIFIED" };
  if (parity && input.discordFinalPriceMinor! > input.basePriceMinor)
    return { allowed: false, reason: "DISCORD_PRICE_PARITY_REJECTED" };
  return { allowed: true, reason: null };
}
export type DiscountPolicyInput = {
  provider: BillingProviderKind;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  basePriceMinor: number | null;
  discordFinalPriceMinor: number | null;
  discordOfferingSupported: boolean;
  parityReviewed: boolean;
  parityObligation?: boolean | null;
  baseCurrency?: string | null;
  discordCurrency?: string | null;
};
export function discountCompatibility(input: DiscountPolicyInput) {
  if (
    !Number.isInteger(input.discountValue) ||
    input.discountValue <= 0 ||
    (input.discountType === "PERCENT" && input.discountValue > 100)
  )
    return {
      allowed: false,
      reason: "INVALID_DISCOUNT",
      finalPriceMinor: null,
    };
  if (
    input.basePriceMinor === null ||
    !Number.isSafeInteger(input.basePriceMinor) ||
    input.basePriceMinor < 0
  )
    return {
      allowed: false,
      reason: "OFFERING_PRICE_UNVERIFIED",
      finalPriceMinor: null,
    };
  const finalPriceMinor = Math.max(
    0,
    input.discountType === "PERCENT"
      ? Math.round((input.basePriceMinor * (100 - input.discountValue)) / 100)
      : input.basePriceMinor - input.discountValue,
  );
  if (input.provider === "DISCORD")
    return {
      allowed: false,
      reason: "DISCORD_DISCOUNT_NOT_IMPLEMENTED",
      finalPriceMinor,
    };
  const parity = input.discordOfferingSupported
    ? true
    : input.parityObligation === undefined
      ? false
      : input.parityObligation;
  if (parity === null)
    return {
      allowed: false,
      reason: "DISCOUNT_POLICY_REVIEW_REQUIRED",
      finalPriceMinor,
    };
  if (
    parity &&
    (!input.parityReviewed ||
      input.discordFinalPriceMinor === null ||
      !Number.isSafeInteger(input.discordFinalPriceMinor) ||
      input.discordFinalPriceMinor < 0)
  )
    return {
      allowed: false,
      reason: "DISCORD_PRICE_PARITY_UNVERIFIED",
      finalPriceMinor,
    };
  if (
    parity &&
    (!input.baseCurrency || input.baseCurrency !== input.discordCurrency)
  )
    return {
      allowed: false,
      reason: "DISCORD_PRICE_CURRENCY_UNVERIFIED",
      finalPriceMinor,
    };
  if (parity && input.discordFinalPriceMinor! > finalPriceMinor)
    return {
      allowed: false,
      reason: "DISCORD_PRICE_PARITY_REJECTED",
      finalPriceMinor,
    };
  return { allowed: true, reason: null, finalPriceMinor };
}
