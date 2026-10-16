"use client";
import type {LifecycleExecutionPreview, LifecyclePreviewReplay} from "../../../../packages/presentation/src/lifecycle-preview";

const reasons: Record<string, [string, string]> = {
  PREVIEW_ANALYZE_PERMISSION_REQUIRED: ["Analyzing saved member observations requires your existing Analyze permission. Configuration comparison remains available.", "保存済み観測の評価には、既存の分析権限が必要です。設定の差分は引き続き確認できます。"],
  PREVIEW_PLAN_UNAVAILABLE: ["This configuration is outside the current plan.", "この設定は現在のプランの対象外です。"],
  DOMAIN_HAS_NO_EXECUTION_EVALUATOR: ["This settings domain supports comparison only; it has no lifecycle execution evaluator.", "この設定分野には実行評価器がないため、差分の比較だけを表示します。"],
  PREVIEW_SAVED_SOURCE_CHANGED: ["The saved inputs or current configuration changed. Start a new preview; the prior result has not been overwritten.", "保存済み入力や現在の設定が変わりました。新しく評価してください。以前の結果を同じ入力の結果として上書きしていません。"],
  PREVIEW_COMPLEXITY_LIMIT: ["This saved definition exceeds the bounded preview size.", "この保存済み定義は、事前評価できる大きさを超えています。"],
  LIVE_FEATURE_DISABLED_SIMULATION_ONLY: ["The live feature is disabled. The following is a read-only simulation.", "稼働中の機能は無効です。以下は読み取り専用の模擬評価です。"],
  NO_ELIGIBLE_SAVED_SOURCE: ["There are no eligible saved observations. This is not a zero success rate.", "条件に合う保存済み観測がありません。成功率が0という意味ではありません。"],
  EPISODE_SAMPLE_TRUNCATED: ["Only the latest 25 eligible participation episodes are included.", "対象は、条件に合う最近の参加記録25件までです。"],
  MATURE_OBSERVABLE_ASSIGNED_OUTCOMES_UNAVAILABLE: ["Mature, fully observed outcomes for saved assignments are unavailable.", "保存済み割当に対する、観測期間を満たした結果が不足しています。"],
  TRIGGER_ORIGIN_NOT_RECONSTRUCTED: ["Saved trigger observations do not prove their origin. Eligibility, approval and queue decisions remain unknown.", "保存済みのきっかけの観測からは、発信元を確認できません。対応対象・承認・受付の可否は未確認です。"],
  PROPOSED_ASSIGNMENTS_NOT_SAVED: ["Potential assignments are calculated only. Existing assignments keep their saved variants.", "仮の割当は計算だけです。既存の割当は保存済みの組を維持します。"],
  GUARDRAIL_AND_DELIVERY_OUTCOMES_NOT_SIMULATED: ["Delivery and all experiment safeguards cannot be reconstructed. Statistical support is withheld.", "配信や実験のすべての安全条件は再現できません。統計的な支持判定は出しません。"],
  EXPERIMENT_NOT_RUNNING_SIMULATION_ONLY: ["The saved experiment is paused or stopped. Potential assignments below are hypothetical only.", "保存済み実験は一時停止または終了しています。以下の仮の割当は計算上の候補だけです。"],
};
const states: Record<string, [string, string]> = {
  NOT_ELIGIBLE: ["Conditions not met", "条件に該当せず"], UNKNOWN_TRIGGER_NOT_OBSERVED: ["No matching trigger is available to establish eligibility", "対応対象と判断できるきっかけの観測なし"],
  UNKNOWN_CONDITION_EVIDENCE: ["Condition evidence is missing or unknown", "条件の根拠が不足・未確認"], UNKNOWN_TRIGGER_ORIGIN: ["Trigger origin is unknown", "きっかけの発信元が未確認"],
  UNKNOWN_TRIGGER_DELAY: ["Trigger delay has not elapsed", "きっかけからの待機時間が未経過"], UNKNOWN_TRIGGER_EVIDENCE: ["Trigger observation is unavailable", "きっかけの観測が不足・未確認"],
};
export function LifecyclePreviewResults({value, locale, busy, replay}: {value: LifecycleExecutionPreview; locale: "ja" | "en"; busy: boolean; replay: (input: LifecyclePreviewReplay) => void}) {
  const ja = locale === "ja", text = (en: string, japanese: string) => ja ? japanese : en;
  const reason = (code: string) => reasons[code]?.[ja ? 1 : 0] ?? text("This prerequisite remains unverified.", "この前提条件は未確認です。");
  return <section><h3>{text("Saved-source execution preview", "保存済みデータによる実行の事前評価")}</h3>
    <p>{text("No Run, assignment, action, result or usage is saved. Discord, roles, billing, publication and live settings are unchanged.", "Run・割当・操作・結果・利用回数は保存しません。Discord・ロール・課金・公開・稼働設定は変更されません。")}</p>
    {value.reasonCodes.length > 0 && <ul>{value.reasonCodes.map(code => <li key={code}>{reason(code)}</li>)}</ul>}
    {value.available && <>
      <p>{text("Eligible saved episodes in this sample", "この評価に含む参加記録")}: {value.sample.episodes} / {value.sample.maxEpisodes} · {text("Facts per episode", "参加記録ごとの観測上限")}: {value.sample.maxFactsPerEpisode}</p>
      {value.sample.factsTruncated && <p role="status">{text("Some observations exceeded the read limit. Missing evidence remains unknown.", "観測が読取上限を超えた対象があります。足りない根拠は未確認として扱います。")}</p>}
      <table><thead><tr><th>{text("Definition", "定義")}</th><th>{text("Matched", "条件に該当")}</th><th>{text("Not matched", "条件に該当せず")}</th><th>{text("Unknown", "未確認")}</th></tr></thead><tbody>{([value.before, value.after] as const).map((side, index) => side && <tr key={index}><th>{index === 0 ? text("Currently published", "現在の公開版") : text("Selected revision", "選択した版")}</th><td>{side.outcomes.matched}</td><td>{side.outcomes.notMatched}</td><td>{side.outcomes.unknown}</td></tr>)}</tbody></table>
      {([value.before, value.after] as const).map((side, index) => side && <div key={index}><h4>{index === 0 ? text("Currently published", "現在の公開版") : text("Selected revision", "選択した版")}</h4>
        {side.liveControlState && <p>{text("Saved experiment state", "保存済み実験の状態")}: {side.liveControlState === "running" ? text("Running", "稼働中") : side.liveControlState === "paused" ? text("Paused", "一時停止") : side.liveControlState === "stopped" ? text("Stopped", "終了") : text("Unknown", "未確認")}</p>}
        {side.proposedStates && <ul>{Object.entries(side.proposedStates).map(([key, count]) => <li key={key}>{states[key]?.[ja ? 1 : 0] ?? key}: {count}</li>)}</ul>}
        {side.variants && <p>{text("Potential / saved assignment groups", "仮の割当・保存済みの組")}: {text("Control", "比較組")} {side.variants.control}, {text("Treatment", "対応組")} {side.variants.treatment}, {text("Unknown", "未確認")} {side.variants.unknown} · {text("Saved assignments retained", "保存済み割当を維持")} {side.variants.savedAssignments}</p>}
        {side.statistics && <p>{text("Descriptive rates for mature saved assignments only", "観測期間を満たした保存済み割当の参考値")}: {text("Control", "比較組")} {side.statistics.controlRate === null ? text("Unknown", "未確認") : `${(side.statistics.controlRate * 100).toFixed(1)}%`} ({side.statistics.controlN}) / {text("Treatment", "対応組")} {side.statistics.treatmentRate === null ? text("Unknown", "未確認") : `${(side.statistics.treatmentRate * 100).toFixed(1)}%`} ({side.statistics.treatmentN})</p>}
        {side.reasonCodes.length > 0 && <ul>{side.reasonCodes.map(code => <li key={code}>{reason(code)}</li>)}</ul>}
      </div>)}
    </>}
    <p>{text("This bounded sample is not a population forecast or a causal estimate. Historical role state, trigger origin, delivery and live target safety cannot be fully reconstructed.", "件数を制限した標本であり、全体の予測や因果効果を示しません。過去のロール状態、きっかけの発信元、配信、実行時の対象の安全性は完全には再現できません。")}</p>
    <p>{text("The input fingerprint identifies the saved values read for this evaluation. Incoming observations are not frozen into a new global snapshot.", "入力の照合値は、この評価で読み取った保存済みの値を表します。観測の取り込みを止めたり、新しい全体スナップショットを保存したりはしません。")}</p>
    {value.input && <><p>{text("Evaluation time", "評価時刻")}: <time>{value.input.asOf}</time> · {text("Settings revision", "設定版")}: {value.input.settingsRevision}</p>
      <details><summary>{text("Input fingerprint", "入力の照合値")}</summary><code>{value.input.sourceHash}</code><p>{text("Replay requires the same saved input fingerprint. Changed or removed observations make replay unavailable; the inputs are not retained by this preview.", "同じ入力での再評価には保存済みデータの照合値が一致する必要があります。観測の変更・削除後は再評価できません。この画面では入力を追加保存しません。")}</p></details>
      <button disabled={busy} onClick={() => replay({asOf: value.input!.asOf, sourceHash: value.input!.sourceHash})}>{text("Re-evaluate the same saved inputs", "同じ保存済み入力で再評価")}</button></>}
  </section>;
}
