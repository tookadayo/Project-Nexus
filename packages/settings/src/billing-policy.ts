import type { BillingProviderKind } from "./billing-domain";
export type DiscountPolicyInput = {
  provider: BillingProviderKind;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  basePriceMinor: number | null;
  discordFinalPriceMinor: number | null;
  discordOfferingSupported: boolean;
  parityReviewed: boolean;
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
  if (input.basePriceMinor === null)
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
  if (
    input.discordOfferingSupported &&
    (!input.parityReviewed || input.discordFinalPriceMinor === null)
  )
    return {
      allowed: false,
      reason: "DISCORD_PRICE_PARITY_UNVERIFIED",
      finalPriceMinor,
    };
  if (
    input.discordOfferingSupported &&
    (!input.baseCurrency || input.baseCurrency !== input.discordCurrency)
  )
    return {
      allowed: false,
      reason: "DISCORD_PRICE_CURRENCY_UNVERIFIED",
      finalPriceMinor,
    };
  if (
    input.discordOfferingSupported &&
    input.discordFinalPriceMinor! > finalPriceMinor
  )
    return {
      allowed: false,
      reason: "DISCORD_PRICE_PARITY_REJECTED",
      finalPriceMinor,
    };
  return { allowed: true, reason: null, finalPriceMinor };
}
