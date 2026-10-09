export type CheckoutOrder = {
  offeringId: string;
  plan: string;
  guildId: string;
  guildName: string;
  currency: string;
  amountMinor: number;
  locale: "ja" | "en";
  sandbox: boolean;
};
/** The current public Checkout contract supports monthly USD prices only. */
export const offeringAmount = (
  order: Pick<CheckoutOrder, "locale" | "currency" | "amountMinor">,
) =>
  new Intl.NumberFormat(order.locale, {
    style: "currency",
    currency: order.currency,
    currencyDisplay: "code",
  }).format(order.amountMinor / 100);

export function offeringTaxLabel(
  taxBehavior: "INCLUSIVE" | "EXCLUSIVE",
  locale: "ja" | "en",
) {
  return taxBehavior === "INCLUSIVE"
    ? locale === "ja"
      ? "税込"
      : "Tax inclusive"
    : locale === "ja"
      ? "税別"
      : "Tax exclusive";
}
