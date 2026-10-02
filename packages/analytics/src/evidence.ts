import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import type { Settings } from "../../settings/src/index";
import {
  metricEvidence,
  type CoverageState,
  type MetricEvidence,
} from "../../shared/src/metric-evidence";
import { measurementDefinition } from "../../shared/src/measurement-definitions";
import {
  currentRecipe,
  recipeWindowVersions,
  type RecipeVersion,
} from "../../settings/src/recipes";
import {
  integrationHealth,
  collectionEpochs,
} from "../../lifecycle/src/observation";
export async function evidenceContext(tx: Tx, s: Scope, from: Date, to: Date) {
  const [health, epochs, gaps, safety, recipe, recipeVersions] =
    await Promise.all([
      integrationHealth(tx, s, to),
      collectionEpochs(tx, s, from, to),
      sql`SELECT id FROM telemetry_health WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from}) LIMIT 1`.execute(
        tx,
      ),
      sql`SELECT id FROM adaptive_facts WHERE ${tenant(s)} AND kind='safety.context' AND occurred_at>=${from} AND occurred_at<${to} LIMIT 1`.execute(
        tx,
      ),
      currentRecipe(tx, s),
      recipeWindowVersions(tx, s, from, to),
    ]);
  return {
    health,
    epochs,
    gap: gaps.rows.length > 0,
    safety: safety.rows.length > 0,
    from,
    to,
    recipe,
    recipeVersions,
  };
}
export type EvidenceContext = Omit<
  Awaited<ReturnType<typeof evidenceContext>>,
  "recipe" | "recipeVersions"
> & { recipe?: RecipeVersion | null; recipeVersions?: (string | null)[] };
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
    const types =
      key === "voiceVisibility"
        ? [2, 13]
        : key === "stageVisibility"
          ? [13]
          : key === "forumVisibility"
            ? [15]
            : key === "mediaVisibility"
              ? [16]
              : [0, 5, 15, 16];
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
  return metricEvidence({
    metricKey: key,
    definitionVersion:
      (input.definitionVersion ?? definition.version) +
      (context.recipe?.definition ? "@" + context.recipe.id : ""),
    definition: input.definition,
    value: input.value,
    numerator: input.numerator,
    denominator: input.denominator,
    sampleSize: input.sample,
    coverageState: coverage.state,
    requiredSurfaces: required,
    evidenceSources: definition.sources,
    coverageReasons: coverage.reasons,
    windowStart: context.from.toISOString(),
    windowEnd: context.to.toISOString(),
    collectionEpochIds: context.epochs.map((e) => e.id),
    collecting: input.collecting,
    minimumSample: input.minimumSample,
    comparisonBlockers: [
      ...(coverage.reasons.includes("COLLECTION_GAP")
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
