import type { ProductData } from "./console";

export type HomeDataState =
  | "ready"
  | "partial"
  | "collecting"
  | "setup"
  | "unavailable"
  | "paused"
  | "expired";

/** Uses only values already authorized by the presentation endpoints. */
export function homeSummaryModel(
  data: ProductData,
  activeCount?: number | null,
) {
  const daily = data.community?.daily;
  const currentCount =
    activeCount === undefined ? daily?.attentionCount : activeCount;
  const attention =
    daily?.ready &&
    typeof currentCount === "number" &&
    Number.isInteger(currentCount) &&
    currentCount >= 0
      ? currentCount
      : null;
  const activity = daily?.ready
    ? {
        today: daily.todayJoined ?? null,
        yesterday: daily.yesterdayJoined ?? null,
        from: daily.from,
        timezone: daily.timezone,
      }
    : null;
  const records = [
    ...(data.results?.items ?? []).map((item) => ({
      id: "experiment:" + item.id,
      name: item.name,
      startedAt: item.timeline.startedAt,
      state: item.state,
      kind: "comparison" as const,
    })),
    ...(data.results?.simple ?? []).map((item) => ({
      id: "response:" + item.actionId,
      name: item.name,
      startedAt: item.startedAt,
      state: item.collecting ? ("collecting" as const) : ("available" as const),
      kind: "response" as const,
    })),
  ].sort((a, b) => {
    const at = (date: string | null) => {
      const time = date ? Date.parse(date) : NaN;
      return Number.isFinite(time) ? time : -Infinity;
    };
    return at(b.startedAt) - at(a.startedAt) || a.id.localeCompare(b.id);
  });
  const hasValues =
    attention !== null ||
    activity?.today != null ||
    activity?.yesterday != null ||
    data.home?.kpis.some((kpi) => kpi.current !== null) ||
    records.length > 0;
  const preparing = data.home?.setup.steps.some(
    (step) =>
      step.key === "measuring" &&
      !step.complete &&
      step.reason === "measurement_waiting",
  );
  const setupRequired =
    data.home?.setup.required &&
    data.home.setup.steps.some(
      (step) => step.key !== "measuring" && !step.complete,
    );
  let state: HomeDataState;
  if (data.betaState === "EXPIRED") state = "expired";
  else if (data.betaState === "PAUSED") state = "paused";
  else if (!hasValues && preparing) state = "collecting";
  else if (!hasValues && setupRequired) state = "setup";
  else if (!hasValues) state = "unavailable";
  else if (
    !data.home ||
    data.home.dataHealth.label !== "healthy" ||
    !daily?.ready ||
    attention === null ||
    activity?.today === null ||
    activity?.yesterday === null ||
    data.results === null ||
    data.integration?.health.severe ||
    setupRequired
  )
    state = "partial";
  else state = "ready";
  const primary =
    state === "paused" || state === "expired"
      ? "settings"
      : attention !== null
        ? attention > 0
          ? "attention"
          : "analysis"
        : "details";
  return {
    state,
    primary,
    attention,
    activity,
    records: records.slice(0, 3),
    recordCount: records.length,
  } as const;
}
