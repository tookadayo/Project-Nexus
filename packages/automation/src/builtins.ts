import type { EvaluatedValue, VariableDeclaration } from "./types";

/** Registered Run metadata, supplied by the runtime rather than by user input. */
export const RUN_STARTED_AT_ID = "run.startedAt";

export function runBuiltinDeclarations(
  locale: "ja" | "en" = "ja",
): VariableDeclaration[] {
  return [{
    id: RUN_STARTED_AT_ID,
    name: locale === "ja" ? "この実行の開始時刻" : "Run start time",
    type: "Instant",
    description: locale === "ja"
      ? "実行を開始した固定日時です。待機・再開でも変わりません。"
      : "The fixed instant this run started. Waiting and resuming do not change it.",
  }];
}

/** The caller must use the persisted Run.started_at, never the current clock. */
export function runBuiltinValues(
  guildId: string,
  startedAt: string,
): Record<string, EvaluatedValue> {
  return {
    [RUN_STARTED_AT_ID]: {
      type: "Instant",
      value: startedAt,
      provenance: [{ source: "service", guildId, resumable: true }],
    },
  };
}
