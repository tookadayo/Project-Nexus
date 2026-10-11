import {
  canonicalFeatures,
  featureAvailability,
  planRegistry,
  plans,
  type EntitlementFeature,
  type Plan,
} from "../../../../packages/settings/src/plan-registry";
import { featureCopy } from "../../../../packages/settings/src/plan-copy";
import type { SiteLocale } from "../public-ui";

export const publicFeatureCopy: Partial<
  Record<EntitlementFeature, readonly [string, string]>
> = {
  core_observation: ["Discordの主な活動を確認", "View core Discord activity"],
  voice_metrics: [
    "ボイスへの参加・同じチャンネルにいた記録",
    "Voice participation and co-presence records",
  ],
  coverage_health: [
    "集計の前提・取得範囲・接続状態",
    "Result context, data coverage and connection status",
  ],
  attention_escalation: ["担当者への対応依頼", "Request help from a responder"],
  improvement_tracking: [
    "運営で試したことの結果を比較",
    "Compare outcomes of changes",
  ],
  saved_views: ["表示と絞り込み条件を保存", "Save views and filters"],
  custom_activation: ["参加後の目標を設定", "Set goals for new members"],
  playbooks: ["運営の対応手順", "Community response guides"],
  attention_inbox: ["確認した内容と対応を記録", "Record findings and actions"],
  team_assignment: [
    "NEXUS内のチームへ担当を割当",
    "Assign work to teams in NEXUS",
  ],
};
export function publicFeatureLabel(
  feature: EntitlementFeature,
  locale: SiteLocale,
) {
  return (publicFeatureCopy[feature] ?? featureCopy[feature])[
    locale === "ja" ? 0 : 1
  ];
}
// Presentation ordering only. Each row still reads all five values directly
// from planRegistry. Never manufacture a staircase by changing entitlements.
const workflowOrder: EntitlementFeature[] = [
  "core_observation",
  "connection_metrics",
  "thread_forum_metrics",
  "reaction_poll_metrics",
  "voice_metrics",
  "event_metrics",
  "discord_charts",
  "coverage_health",
  "basic_attention",
  "fallback_onboarding",
  "hybrid_onboarding",
  "interventions",
  "intake_panels",
  "all_recipe_presets",
  "surface_breakdowns",
  "percentile_metrics",
  "advanced_journeys",
  "comparable_periods",
  "heatmaps",
  "custom_activation",
  "event_operations",
  "basic_improvement_tracking",
  "saved_views",
  "csv_export",
  "scheduled_digest",
  "custom_recipe",
  "attention_inbox",
  "attention_automation",
  "attention_escalation",
  "improvement_tracking",
  "playbooks",
  "scheduled_reports",
  "report_branding",
  "team_routing",
  "webhooks",
  "api",
  "multi_guild",
  "team_assignment",
  "approval_workflow",
  "automation_sandbox",
  "recurring_exports",
  "rbac",
  "audit_export",
  "advanced_api",
];
export const comparisonRows = canonicalFeatures
  .filter((feature) => featureAvailability[feature] === "available")
  .map((id) => {
    const values = plans.map((plan) =>
      planRegistry[plan].features.includes(id),
    );
    const first = values.indexOf(true);
    return {
      id,
      values,
      firstPlan: first === -1 ? null : plans[first]!,
      // Preserve a future exception instead of silently pretending it is monotonic.
      conditional: first < 0 || values.slice(first).some((value) => !value),
    };
  });
export const comparisonGroups = [
  ...plans.map((plan) => ({
    key: plan,
    rows: comparisonRows.filter(
      (row) => !row.conditional && row.firstPlan === plan,
    ),
  })),
  {
    key: "CONDITIONAL" as const,
    rows: comparisonRows.filter((row) => row.conditional),
  },
]
  .map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => {
      const rank = (id: EntitlementFeature) => {
        const index = workflowOrder.indexOf(id);
        return index < 0
          ? workflowOrder.length + canonicalFeatures.indexOf(id)
          : index;
      };
      return rank(a.id) - rank(b.id);
    }),
  }))
  .filter((group) => group.rows.length > 0);

type Availability = "included" | "excluded" | "planned" | "unknown";
export function AvailabilityMark({
  state,
  locale,
}: {
  state: Availability;
  locale: SiteLocale;
}) {
  const labels: Record<Availability, readonly [string, string]> = {
    included: ["利用可能", "Included"],
    excluded: ["対象外", "Not included"],
    planned: ["準備中", "Being prepared"],
    unknown: ["確認できません", "Unable to confirm"],
  };
  const label = labels[state][locale === "ja" ? 0 : 1];
  if (state === "planned" || state === "unknown")
    return <span className="comparison-state-text">{label}</span>;
  return (
    <span className={"comparison-mark comparison-mark-" + state}>
      <span aria-hidden="true">{state === "included" ? "✓" : "−"}</span>
      <span className="comparison-sr-only">{label}</span>
    </span>
  );
}
const groupLabels: Record<Plan | "CONDITIONAL", readonly [string, string]> = {
  FREE: ["すべてのプラン", "Every plan"],
  STARTER: ["Starterで追加", "Added with Starter"],
  GROWTH: ["Growthで追加", "Added with Growth"],
  SCALE: ["Scaleで追加", "Added with Scale"],
  ENTERPRISE: ["Enterpriseで追加", "Added with Enterprise"],
  CONDITIONAL: ["個別の提供条件", "Specific availability conditions"],
};
export function FeatureComparison({ locale }: { locale: SiteLocale }) {
  const language = locale === "ja" ? 0 : 1;
  return (
    <section
      className="site-section comparison-section"
      aria-labelledby="feature-comparison-title"
    >
      <h2 id="feature-comparison-title">
        {locale === "ja" ? "機能を比較する" : "Compare features"}
      </h2>
      <p className="comparison-hint" id="feature-comparison-hint">
        {locale === "ja"
          ? "表の中を横にスクロールして比較できます。キーボードでは表に移動し、左右の矢印キーを使えます。"
          : "Scroll within the table to compare plans. With a keyboard, focus the table and use the left and right arrow keys."}
      </p>
      <div
        className="comparison-scroll"
        tabIndex={0}
        role="region"
        aria-labelledby="feature-comparison-title"
        aria-describedby="feature-comparison-hint"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{locale === "ja" ? "機能" : "Feature"}</th>
              {plans.map((plan) => (
                <th scope="col" key={plan}>
                  {plan}
                </th>
              ))}
            </tr>
          </thead>
          {comparisonGroups.map((group) => (
            <tbody key={group.key} data-feature-group={group.key}>
              <tr className="comparison-group">
                <th scope="rowgroup">{groupLabels[group.key][language]}</th>
                {plans.map((plan) => (
                  <td
                    key={plan}
                    className="comparison-group-plan"
                    aria-hidden="true"
                  >
                    {plan}
                  </td>
                ))}
              </tr>
              {group.rows.map((row) => (
                <tr key={row.id} data-feature-id={row.id}>
                  <th scope="row">{publicFeatureLabel(row.id, locale)}</th>
                  {row.values.map((included, index) => (
                    <td
                      key={plans[index]}
                      data-plan={plans[index]}
                      data-included={String(included)}
                    >
                      <AvailabilityMark
                        state={included ? "included" : "excluded"}
                        locale={locale}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
