import { expect, it } from "vitest";
import {
  buildMetricEvidence,
  metricCoverage,
  type EvidenceContext,
} from "../../packages/analytics/src/evidence";
import { settingsSchema } from "../../packages/settings/src/index";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { representativeSource } from "../fixtures/community-profiles";
import { observationIntents } from "../../packages/shared/src/integration-health";
const cfg = settingsSchema.parse({}),
  from = new Date("2026-10-01T00:00:00Z"),
  to = new Date("2026-10-02T00:00:00Z");
function context(): EvidenceContext {
  return {
    health: {
      gateway: "CONNECTED",
      lastGatewayAt: to.toISOString(),
      intents: Object.fromEntries(
        observationIntents.map((k) => [k, "AVAILABLE"]),
      ) as EvidenceContext["health"]["intents"],
      rest: "AVAILABLE",
      capabilityFresh: true,
      lastSuccessfulRefresh: to.toISOString(),
      lastRefreshFailure: null,
      lastErrorCategory: null,
      severe: false,
    },
    epochs: [
      {
        id: "epoch",
        source: "GATEWAY",
        startedAt: from.toISOString(),
        endedAt: null,
        startReason: "GATEWAY_CONNECTED",
        endReason: null,
        capabilitySnapshotId: null,
      },
    ],
    gap: false,
    safety: false,
    from,
    to,
  };
}
it("does not propagate private thread limitations into voice or direct reply coverage", () => {
  const snapshot = buildCapabilitySnapshot(representativeSource(1), to),
    c = context();
  expect(
    metricCoverage(["voice", "voiceVisibility"], snapshot, cfg, c).state,
  ).toBe("COMPLETE");
  expect(
    metricCoverage(["messages", "textVisibility"], snapshot, cfg, c).state,
  ).toBe("COMPLETE");
  expect(
    metricCoverage(["messages", "threadVisibility"], snapshot, cfg, c).reasons,
  ).toContain("PRIVATE_THREAD_VISIBILITY_PARTIAL");
});
it("does not use old channel totals after channel obfuscation rollout", () => {
  const old = buildCapabilitySnapshot(representativeSource(0), to),
    source = representativeSource(0);
  source.channels = [];
  const after = buildCapabilitySnapshot(
    source,
    new Date("2026-11-16T00:00:01Z"),
    old,
  );
  expect(after.coverage.totalState).toBe("LOWER_BOUND");
  expect(after.coverage.knownTotalChannels).toBeNull();
  expect(after.coverage.ratio).toBeNull();
  expect(after.coverage.observableChannels).toBe(0);
});
it("supports early omitted-channel testing and unavailable REST without a fabricated denominator", () => {
  const source = representativeSource(1);
  source.channelCensus = "VISIBLE_ONLY";
  expect(buildCapabilitySnapshot(source, to).coverage.totalState).toBe(
    "LOWER_BOUND",
  );
  source.endpointStatus.channels = "UNAVAILABLE";
  const m = buildCapabilitySnapshot(source, to);
  expect(m.coverage.totalState).toBe("UNKNOWN");
  expect(m.coverage.ratio).toBeNull();
});
it("can measure a known include scope without claiming a complete guild census", () => {
  const source = representativeSource(1);
  source.channelCensus = "VISIBLE_ONLY";
  const snapshot = buildCapabilitySnapshot(source, to),
    selected = settingsSchema.parse({
      analysisScope: { mode: "include", channelIds: [source.channels[1]!.id] },
    });
  expect(
    metricCoverage(["voice", "voiceVisibility"], snapshot, selected, context())
      .state,
  ).toBe("COMPLETE");
  expect(
    metricCoverage(["voice", "voiceVisibility"], snapshot, cfg, context())
      .state,
  ).toBe("LOWER_BOUND");
});
it.each(["UNKNOWN", "UNAVAILABLE"] as const)(
  "makes missing member intent %s instead of zero",
  (state) => {
    const c = context();
    c.health.intents.members = state;
    const m = buildMetricEvidence(
      "new_members",
      {
        value: 0,
        numerator: 0,
        denominator: 0,
        sample: 0,
        definition: "Observed eligible joins",
      },
      null,
      cfg,
      c,
    );
    expect(m.observationState).toBe("UNKNOWN");
    expect(m.value).toBeNull();
    expect(m.denominator).toBeNull();
    expect(m.comparable).toBe(false);
  },
);
it("finds collection holes even when an explicit gap marker was not retained", () => {
  const c = context();
  c.epochs = [
    { ...c.epochs[0]!, endedAt: "2026-10-01T01:00:00Z" },
    { ...c.epochs[0]!, id: "later", startedAt: "2026-10-01T01:05:00Z" },
  ];
  const m = buildMetricEvidence(
    "new_members",
    {
      value: 10,
      numerator: 10,
      denominator: 10,
      sample: 10,
      definition: "Observed eligible joins",
    },
    null,
    cfg,
    c,
  );
  expect(m.comparisonBlockers).toContain("COLLECTION_GAP");
  expect(m.coverageState).toBe("PARTIAL");
});
it("blocks ordinary comparisons during incident context", () => {
  const c = context();
  c.safety = true;
  const m = buildMetricEvidence(
    "new_members",
    {
      value: 10,
      numerator: 10,
      denominator: 10,
      sample: 10,
      definition: "Observed joins",
    },
    null,
    cfg,
    c,
  );
  expect(m.value).toBe(10);
  expect(m.comparisonBlockers).toContain("SAFETY_CONTEXT");
  expect(m.comparable).toBe(false);
});
