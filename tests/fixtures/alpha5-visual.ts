import { metricEvidence } from "../../packages/shared/src/metric-evidence";
import { measurementDefinition } from "../../packages/shared/src/measurement-definitions";
import { journeyNames } from "../../packages/shared/src/operations-copy";
import { representativeUi } from "./community-profiles";
import type { ControlData } from "../../packages/discord-panels/src/views/control";
export const visualStates = [
  "HEALTHY",
  "ATTENTION",
  "NO_DATA",
  "COLLECTING",
  "PARTIAL",
  "UNKNOWN",
  "INTENT_UNAVAILABLE",
  "DISCORD_UNAVAILABLE",
] as const;
export function alpha5Visual(
  index: number,
  state: (typeof visualStates)[number],
) {
  const model = structuredClone(representativeUi(index));
  const unavailable = [
    "UNKNOWN",
    "INTENT_UNAVAILABLE",
    "DISCORD_UNAVAILABLE",
  ].includes(state);
  const denominator = state === "NO_DATA" ? 0 : state === "COLLECTING" ? 2 : 37;
  const coverage =
    state === "UNKNOWN"
      ? "UNKNOWN"
      : state === "PARTIAL"
        ? "PARTIAL"
        : "COMPLETE";
  for (const metric of model.metrics) {
    const definition = measurementDefinition(metric.key);
    metric.count = unavailable ? null : state === "NO_DATA" ? null : 24;
    metric.sample = denominator;
    metric.denominator = unavailable ? null : denominator;
    metric.state = unavailable
      ? "UNKNOWN"
      : state === "COLLECTING"
        ? "PENDING"
        : state === "PARTIAL"
          ? "PARTIAL"
          : "OBSERVED";
    metric.evidence = metricEvidence({
      metricKey: metric.key,
      definitionVersion: definition.version,
      definition: "Synthetic fixture observations; no live Discord data.",
      value: metric.count,
      numerator: metric.count,
      denominator: metric.denominator,
      sampleSize: denominator,
      coverageState: coverage,
      requiredSurfaces: definition.surfaces,
      evidenceSources: ["synthetic-fixture"],
      coverageReasons:
        coverage === "COMPLETE"
          ? []
          : [
              coverage === "PARTIAL"
                ? "PRIVATE_THREADS_PARTIAL"
                : "CHANNEL_TOTAL_UNKNOWN",
            ],
      windowStart: model.window.from,
      windowEnd: model.window.through,
      collectionEpochIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      available: !unavailable,
      collecting: state === "COLLECTING",
    });
  }
  model.eligible = denominator;
  model.journeys = {
    recipeId: model.recipe!.id,
    transitions: model.recipe!.definition!.transitions.map((row) => ({
      ...row,
      fromLabel: journeyNames[row.from],
      toLabel: journeyNames[row.to],
      evidence: metricEvidence({
        metricKey: `journey.${row.from}.${row.to}`,
        definitionVersion: model.recipe!.definitionVersion,
        definition: "Synthetic aggregate transition fixture.",
        value: denominator ? 24 / 37 : null,
        numerator: denominator ? 24 : 0,
        denominator,
        sampleSize: denominator,
        coverageState: coverage,
        requiredSurfaces: ["GUILD_MEMBERS"],
        evidenceSources: ["synthetic-fixture"],
        coverageReasons: [],
        windowStart: model.window.from,
        windowEnd: model.window.through,
        collectionEpochIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        available: !unavailable,
        collecting: state === "COLLECTING",
      }),
    })),
  };
  if (state === "INTENT_UNAVAILABLE") {
    model.integration!.intents.members = "UNAVAILABLE";
    model.integration!.severe = true;
  }
  if (state === "DISCORD_UNAVAILABLE") {
    model.integration!.gateway = "DISCONNECTED";
    model.integration!.rest = "UNAVAILABLE";
    model.integration!.severe = true;
  }
  if (state === "UNKNOWN") {
    model.capabilities!.coverage.totalState = "UNKNOWN";
    model.capabilities!.coverage.knownTotalChannels = null;
    model.capabilities!.coverage.coverageState = "UNKNOWN";
    model.capabilities!.coverage.ratio = null;
  }
  const count =
    state === "ATTENTION" ? (model.volume === "HIGH_VOLUME" ? 47 : 1) : 0;
  const attention = count
    ? [
        {
          channelId: "944444444444444445",
          messageId: "944444444444444446",
          url: "https://discord.com/channels/911111111111111111/944444444444444445/944444444444444446",
          waitingMinutes: 41,
          status: "OPEN",
          surface: index === 2 ? "FORUM_POST" : "TEXT",
          purpose:
            index === 2
              ? "SUPPORT"
              : index === 1
                ? "LFG"
                : "GENERAL_CONVERSATION",
          type:
            index === 2
              ? "FORUM_SUPPORT"
              : index === 1
                ? "LFG_RESPONSE"
                : "TEXT_NEWCOMER",
          evidence: model.metrics[0]?.evidence,
        },
      ]
    : [];
  const community = {
    adaptive: model,
    daily: {
      ready: !unavailable,
      attentionCount: unavailable ? null : count,
      todayJoined: unavailable ? null : 3,
      todayConnected: unavailable ? null : 2,
    },
    attention,
    operations: {
      openBacklog: count,
      oldestOpenAt: count ? "2026-10-01T23:19:00Z" : null,
      medianAcknowledgementSeconds: 420,
      medianResolutionSeconds: 840,
      p75ResolutionSeconds: 1860,
      acknowledgementSample: 37,
      resolutionSample: 37,
      itemsOpened: 74,
      itemsResolved: 37,
      snoozed: 0,
      surfaceBreakdown: count
        ? [{ type: "TEXT_NEWCOMER", surface: "TEXT", open: count }]
        : [],
    },
    analysis: { rules: { retainedFromDay: 7, retainedThroughDay: 14 } },
    weekly: {},
    dataReady: !unavailable,
  } as unknown as NonNullable<ControlData["community"]>;
  return { model, community };
}
