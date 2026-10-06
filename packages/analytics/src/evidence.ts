import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import type { Settings } from "../../settings/src/index";
import {
  metricEvidence,
  type CoverageState,
  type MetricEvidence,
} from "../../shared/src/metric-evidence";
import {
  measurementDefinition,
  visibilityChannelTypes,
} from "../../shared/src/measurement-definitions";
import {
  currentRecipe,
  recipeWindowAttributions,
  type RecipeVersion,
} from "../../settings/src/recipes";
import {
  integrationHealth,
  collectionEpochs,
} from "../../lifecycle/src/observation";
export async function evidenceContext(tx: Tx, s: Scope, from: Date, to: Date) {
  const [health, epochs, gaps, safety, recipe, recipeVersions, unknownEntries] =
    await Promise.all([
      integrationHealth(tx, s, to),
      collectionEpochs(tx, s, from, to),
      sql<{
        started_at: Date;
        ended_at: Date | null;
      }>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from}) `.execute(
        tx,
      ),
      sql<{
        occurred_at: Date;
      }>`SELECT occurred_at FROM adaptive_facts WHERE ${tenant(s)} AND kind='safety.context' AND occurred_at>=${from} AND occurred_at<${to}`.execute(
        tx,
      ),
      currentRecipe(tx, s),
      recipeWindowAttributions(tx, s, from, to),
      sql<{
        joined_at: Date;
      }>`SELECT joined_at FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} AND joined_at<${to} AND (screening_observed_at IS NULL OR guest_observed_at IS NULL OR GREATEST(screening_observed_at,guest_observed_at)>${to})`.execute(
        tx,
      ),
    ]);
  return {
    health,
    epochs,
    gap: gaps.rows.length > 0,
    gaps: gaps.rows,
    safetyTimes: safety.rows.map((r) => r.occurred_at),
    safety: safety.rows.length > 0,
    from,
    to,
    recipe,
    recipeVersions: recipeVersions.map((r) => r.id),
    definitionVersions: [
      ...new Set(recipeVersions.map((r) => r.definition_version)),
    ],
    unknownJoins: unknownEntries.rows.map((r) => r.joined_at),
  };
}
export type EvidenceContext = Omit<
  Awaited<ReturnType<typeof evidenceContext>>,
  | "recipe"
  | "recipeVersions"
  | "gaps"
  | "safetyTimes"
  | "unknownJoins"
  | "definitionVersions"
> & {
  recipe?: RecipeVersion | null;
  recipeVersions?: (string | null)[];
  gaps?: { started_at: Date; ended_at: Date | null }[];
  safetyTimes?: Date[];
  unknownJoins?: Date[];
  definitionVersions?: string[];
};
export function metricCoverage(
  required: string[],
  snapshot: CapabilitySnapshot | null,
  cfg: Settings,
  context: EvidenceContext,
) {
  const reasons: string[] = [],
    states: CoverageState[] = [];
  if (context.health.gateway !== "CONNECTED") {
    reasons.push("GATEWAY_" + context.health.gateway);
    states.push("UNKNOWN");
  }
  if (required.includes("members") && context.unknownJoins?.length) {
    reasons.push("MEMBER_ELIGIBILITY_UNOBSERVED");
    states.push("PARTIAL");
  }
  if (context.gap) {
    reasons.push("COLLECTION_GAP");
    states.push("PARTIAL");
  }
  if (
    !context.epochs.length ||
    Date.parse(context.epochs[0]!.startedAt) > context.from.getTime()
  ) {
    reasons.push("COLLECTION_STARTED_IN_WINDOW");
    states.push("LOWER_BOUND");
  }
  let observedThrough = context.from.getTime();
  for (const epoch of context.epochs) {
    if (
      Date.parse(epoch.startedAt) > observedThrough &&
      observedThrough > context.from.getTime()
    ) {
      reasons.push("COLLECTION_GAP");
      states.push("PARTIAL");
    }
    observedThrough = Math.max(
      observedThrough,
      epoch.endedAt ? Date.parse(epoch.endedAt) : context.to.getTime(),
    );
  }
  if (context.epochs.length && observedThrough < context.to.getTime()) {
    reasons.push("COLLECTION_GAP");
    states.push("PARTIAL");
  }
  if (
    required.some((s) => s.endsWith("Visibility")) &&
    context.epochs.some(
      (e) =>
        ["PERMISSION_CHANGED", "CAPABILITY_CHANGED"].includes(e.startReason) &&
        Date.parse(e.startedAt) > context.from.getTime(),
    )
  ) {
    reasons.push("OBSERVATION_SCOPE_CHANGED");
    states.push("PARTIAL");
  }
  for (const key of required) {
    if (key in context.health.intents) {
      const state =
        context.health.intents[key as keyof typeof context.health.intents];
      if (state !== "AVAILABLE") {
        reasons.push("INTENT_" + key.toUpperCase() + "_" + state);
        states.push("UNKNOWN");
      }
      continue;
    }
    if (!key.endsWith("Visibility")) continue;
    if (
      !snapshot ||
      !context.health.capabilityFresh ||
      snapshot.coverage.coverageState === "UNKNOWN"
    ) {
      reasons.push("CAPABILITY_DISCOVERY_STALE_OR_UNKNOWN");
      states.push("UNKNOWN");
      continue;
    }
    const types = visibilityChannelTypes(key);
    const channels = snapshot.channels.filter(
      (c) =>
        types.includes(c.type) &&
        (cfg.analysisScope.mode === "all" ||
          (cfg.analysisScope.mode === "include") ===
            cfg.analysisScope.channelIds.includes(c.id)),
    );
    if (channels.some((c) => !c.observable)) {
      reasons.push("VIEW_CHANNEL_MISSING");
      states.push("PARTIAL");
    }
    // A known include scope can be complete even when the server census is unknown.
    if (
      cfg.analysisScope.mode === "include" &&
      cfg.analysisScope.channelIds.some(
        (id) => !snapshot.channels.some((c) => c.id === id && c.observable),
      )
    ) {
      reasons.push("SELECTED_CHANNEL_NOT_OBSERVABLE");
      states.push("PARTIAL");
    }
    if (
      cfg.analysisScope.mode !== "include" &&
      snapshot.coverage.totalState !== "KNOWN"
    ) {
      reasons.push(
        "SERVER_CHANNEL_TOTAL_" + (snapshot.coverage.totalState ?? "UNKNOWN"),
      );
      states.push("LOWER_BOUND");
    }
    if (key === "threadVisibility") {
      reasons.push("PRIVATE_THREAD_VISIBILITY_PARTIAL");
      states.push("PARTIAL");
    }
  }
  const state: CoverageState = states.includes("UNKNOWN")
    ? "UNKNOWN"
    : states.includes("PARTIAL")
      ? "PARTIAL"
      : states.includes("LOWER_BOUND")
        ? "LOWER_BOUND"
        : "COMPLETE";
  return { state, reasons: [...new Set(reasons)] };
}
export function buildMetricEvidence(
  key: string,
  input: {
    value: number | null;
    numerator: number | null;
    denominator: number | null;
    sample: number;
    definition: string;
    collecting?: boolean;
    requiredSurfaces?: string[];
    definitionVersion?: string;
    minimumSample?: number;
    semanticsKnown?: boolean;
    semanticsReasons?: string[];
  },
  snapshot: CapabilitySnapshot | null,
  cfg: Settings,
  context: EvidenceContext,
): MetricEvidence {
  const definition = measurementDefinition(key),
    required = input.requiredSurfaces ?? definition.surfaces,
    coverage = metricCoverage(required, snapshot, cfg, context);
  const capabilityChanges =
    required.some((s) => s.endsWith("Visibility")) &&
    context.epochs.some((e) =>
      ["PERMISSION_CHANGED", "CAPABILITY_CHANGED"].includes(e.startReason),
    );
  const mixedRecipe = Boolean(
    context.recipe &&
    context.recipeVersions?.some((id) => id !== context.recipe!.id),
  );
  const sensitive =
    key.startsWith("journey.") ||
    key.startsWith("journey:") ||
    [
      "voiceCopresence",
      "lfgThenVoice",
      "resolvedPosts",
      "cohort.connection",
      "cohort.retention",
    ].includes(key);
  const legacyReply =
    (key === "directReplies" ||
      key === "cohort.reply" ||
      key.includes("reply-distribution")) &&
    context.definitionVersions?.some((v) => v !== "observation-v3");
  return metricEvidence({
    metricKey: key,
    available:
      input.semanticsKnown !== false &&
      !(
        required.includes("members") &&
        context.unknownJoins?.length &&
        input.sample === 0
      ) &&
      !(mixedRecipe && sensitive) &&
      !legacyReply,
    definitionVersions: context.definitionVersions,
    recipeVersionIds: context.recipeVersions?.filter(
      (id): id is string => id !== null,
    ),
    definitionVersion:
      (input.definitionVersion ?? definition.version) +
      (mixedRecipe
        ? "@mixed"
        : context.recipe?.definition
          ? "@" + context.recipe.id
          : ""),
    definition: input.definition,
    value: input.value,
    numerator: input.numerator,
    denominator: input.denominator,
    sampleSize: input.sample,
    coverageState: input.semanticsKnown === false ? "UNKNOWN" : coverage.state,
    requiredSurfaces: required,
    evidenceSources: definition.sources,
    coverageReasons: [...coverage.reasons, ...(input.semanticsReasons ?? [])],
    windowStart: context.from.toISOString(),
    windowEnd: context.to.toISOString(),
    collectionEpochIds: context.epochs.map((e) => e.id),
    collecting: input.collecting,
    minimumSample: input.minimumSample,
    comparisonBlockers: [
      ...(input.semanticsReasons ?? []),
      ...(legacyReply ? ["LEGACY_REPLY_SEMANTICS_UNKNOWN"] : []),
      ...(coverage.reasons.includes("COLLECTION_GAP")
        ? ["COLLECTION_GAP"]
        : []),
      ...(context.epochs.some(
        (e) =>
          ["GATEWAY_GAP", "PROCESS_RESTART", "INTENT_UNAVAILABLE"].includes(
            e.startReason,
          ) && Date.parse(e.startedAt) > context.from.getTime(),
      )
        ? ["COLLECTION_GAP"]
        : []),
      ...(context.safety ? ["SAFETY_CONTEXT"] : []),
      ...(capabilityChanges ? ["OBSERVATION_SCOPE_CHANGED"] : []),
      ...("recipe" in context && !context.recipe?.definition
        ? ["RECIPE_CONFIRMATION_REQUIRED"]
        : []),
      ...(context.recipe &&
      context.recipeVersions?.some((id) => id !== context.recipe!.id)
        ? ["RECIPE_CHANGED_OR_LEGACY"]
        : []),
    ],
  });
}

export function evidenceWindow(
  context: EvidenceContext,
  from: Date,
  to: Date,
): EvidenceContext {
  return {
    ...context,
    from,
    to,
    unknownJoins: context.unknownJoins?.filter((at) => at >= from && at < to),
    epochs: context.epochs.filter(
      (e) =>
        Date.parse(e.startedAt) < to.getTime() &&
        (!e.endedAt || Date.parse(e.endedAt) > from.getTime()),
    ),
    gap: context.gaps
      ? context.gaps.some(
          (g) => g.started_at < to && (!g.ended_at || g.ended_at > from),
        )
      : context.gap,
    safety: context.safetyTimes
      ? context.safetyTimes.some((at) => at >= from && at < to)
      : context.safety,
  };
}
