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
export const offeringAmount = (order: CheckoutOrder) =>
  new Intl.NumberFormat(order.locale, {
    style: "currency",
    currency: order.currency,
  }).format(order.amountMinor / 100);
