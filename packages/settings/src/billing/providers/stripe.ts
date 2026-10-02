import { UnconfiguredBillingProvider } from "./types";
import type { SubscriptionState } from "../domain";
export function stripeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: env.NEXUS_STRIPE_ENABLED === "true",
    capability: "NOT_CONFIGURED" as const,
  };
}
// Credentials never activate an unverified adapter. No SDK, network or fake sessions.
export class StripeBillingProvider extends UnconfiguredBillingProvider {
  constructor() {
    super("STRIPE");
  }
}
export function stripeSubscriptionState(
  status: string,
  cancelAtPeriodEnd = false,
): SubscriptionState {
  if (status === "trialing") return "TRIALING";
  if (status === "active")
    return cancelAtPeriodEnd ? "CANCEL_AT_PERIOD_END" : "ACTIVE";
  const states: Record<string, SubscriptionState> = {
    past_due: "PAST_DUE",
    paused: "SUSPENDED",
    unpaid: "SUSPENDED",
    incomplete: "INCOMPLETE",
    incomplete_expired: "EXPIRED",
    canceled: "CANCELED",
  };
  return states[status] ?? "UNKNOWN";
}
