export const observationIntents = [
  "members",
  "messages",
  "reactions",
  "polls",
  "voice",
  "scheduledEvents",
  "autoMod",
] as const;
export type ObservationIntent = (typeof observationIntents)[number];
export type Availability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type IntegrationHealth = {
  gateway: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
  lastGatewayAt: string | null;
  intents: Record<ObservationIntent, Availability>;
  rest: Availability;
  capabilityFresh: boolean;
  lastSuccessfulRefresh: string | null;
  lastRefreshFailure: string | null;
  lastErrorCategory: string | null;
  severe: boolean;
};
export type CollectionEpoch = {
  id: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  startReason: string;
  endReason: string | null;
  capabilitySnapshotId: string | null;
};
