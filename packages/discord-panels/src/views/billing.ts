import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { formatNumber } from "../formatting";
import type { UiLocale } from "../i18n/index";
import {
  actionRow,
  callout,
  divider,
  footer,
  metricGrid,
  nexusPanel,
  type Panel,
  type ActionRow,
} from "../primitives";
import type { Issue } from "../types";
import { featureCopy, planCopy } from "../../../settings/src/plan-copy";
import type {
  Plan,
  EntitlementFeature,
} from "../../../settings/src/plan-registry";
import type { NativeBillingCapability } from "../../../settings/src/billing";
import type {
  EntitlementDecision,
  EntitlementSubscription,
} from "../../../settings/src/billing";
export type BillingView = {
  plan: string;
  used: number;
  included: number | null;
  softLimit: number | null;
  projected: number;
  automaticOverageCharge: boolean;
  source?: string;
  subscriptions?: Pick<EntitlementSubscription, "provider" | "status">[];
  periodEnd?: string | null;
  grants?: { source: string; endsAt: string | null }[];
  features?: EntitlementFeature[];
  conflict?: boolean;
  grace?: boolean;
  native?: NativeBillingCapability;
  nativeUrl?: string | null;
  webUrl?: string | null;
  canManage?: boolean;
};
const label = (locale: UiLocale, ja: string, en: string) =>
  locale === "ja" ? ja : en;
function linkRow(specs: { label: string; url: string }[]): ActionRow {
  return {
    type: ComponentType.ActionRow,
    components: specs.map((spec) => ({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: spec.label,
      url: spec.url,
    })),
  };
}
export async function billingPanel(
  issue: Issue,
  view: BillingView,
  locale: UiLocale = "en",
): Promise<Panel> {
  const l = (ja: string, en: string) => label(locale, ja, en),
    available = view.features ?? [
      "core_observation",
      "coverage_health",
      "connection_metrics",
    ];
  const priority: EntitlementFeature[] = [
    "attention_automation",
    "attention_escalation",
    "custom_recipe",
    "improvement_tracking",
    "surface_breakdowns",
    "percentile_metrics",
    "advanced_journeys",
    "scheduled_digest",
    "core_observation",
    "connection_metrics",
    "coverage_health",
  ];
  const features = priority
    .filter((key) => available.includes(key))
    .slice(0, 8);
  const rows: ActionRow[] = [];
  if (view.webUrl) {
    const url = new URL(view.webUrl);
    rows.push(
      linkRow([
        {
          label: l("プランを比較", "Compare plans"),
          url: new URL("/billing/plans", url).toString(),
        },
        {label:l("自分が管理している支払い", "My payments"),url:new URL("/billing/payments",url).toString()},
      ]),
    );
  }
  if (view.canManage !== false)
    rows.push(
      await actionRow(issue, [
        {
          label: l("プロモーションコード", "Promotion code"),
          action: "billingPromotionOpen",
        },
      ]),
    );
  if (view.canManage !== false && view.native === "AVAILABLE" && view.nativeUrl)
    rows.push(
      linkRow([
        {
          label: l("Discordでアップグレード", "Upgrade in Discord"),
          url: view.nativeUrl,
        },
      ]),
    );
  else if (view.webUrl)
    rows.push(
      linkRow([
        {
          label: l("Webでプランを見る", "View plans on Web"),
          url: new URL("/billing/plans", view.webUrl).toString(),
        },
      ]),
    );
  return nexusPanel({
    title: l("NEXUS · プラン", "NEXUS · Plans"),
    subtitle:
      planCopy[view.plan as Plan]?.purpose[locale === "ja" ? 0 : 1] ??
      l("サーバーの利用状況", "Server usage"),
    children: [
      divider(),
      metricGrid([
        { label: l("現在のプラン", "Current plan"), value: view.plan },
        {
          label: l("支払い状態", "Billing state"),
          value:
            view.subscriptions
              ?.slice(0, 5)
              .map((row) => `${row.provider} · ${row.status}`)
              .join(" / ") || l("契約なし", "No subscription"),
        },
        {
          label: l("次回更新／終了", "Renewal / end"),
          value: view.periodEnd
            ? `<t:${Math.floor(new Date(view.periodEnd).getTime() / 1000)}:D>`
            : l("未確定", "Not confirmed"),
        },
        {
          label: l("利用状況", "Usage"),
          value: `${formatNumber(view.used, locale)} / ${view.included === null ? l("個別", "Custom") : formatNumber(view.included, locale)}`,
        },
      ]),
      ...(view.grants ?? [])
        .slice(0, 5)
        .map((grant) =>
          callout(
            grant.source === "PARTNER"
              ? l("パートナー特典", "Partner grant")
              : grant.source === "DEBUG"
                ? l("開発用特典", "Development grant")
                : l("利用特典", "Benefit"),
            grant.endsAt
              ? `${l("有効期限", "Valid until")} <t:${Math.floor(new Date(grant.endsAt).getTime() / 1000)}:D>`
              : l("取消まで有効", "Until revoked"),
          ),
        ),
      ...(view.conflict
        ? [
            callout(
              l("支払い元が重複しています", "Billing conflict"),
              l(
                "契約の確認が必要です。現在は上位の有効プランを維持しています。",
                "Review overlapping subscriptions. The higher valid plan applies temporarily.",
              ),
            ),
          ]
        : []),
      ...(view.grace
        ? [
            callout(
              l("支払い状態を確認中", "Billing grace"),
              l(
                "最後に確認できたプランを一定期間維持しています。",
                "Last known good access is preserved for a bounded grace period.",
              ),
            ),
          ]
        : []),
      divider(),
      callout(
        l("利用できる主な機能", "Main available features"),
        features
          .map((key) => "• " + featureCopy[key][locale === "ja" ? 0 : 1])
          .join("\n"),
      ),
      footer(
        l(
          "利用枠は現在、運用上の目安です。自動の超過課金はありません。測定根拠・プライバシー・削除は全プラン共通です。",
          "Usage is currently a soft allowance, without automatic overage charges. Evidence, privacy and deletion are included in every plan.",
        ),
      ),
    ],
    rows,
  });
}
export async function promotionResultPanel(
  issue: Issue,
  result: { plan: Plan; benefitEnd: string | null } | null,
  locale: UiLocale = "en",
) {
  const l = (ja: string, en: string) => label(locale, ja, en);
  return nexusPanel({
    title: l("NEXUS · プロモーション", "NEXUS · Promotion"),
    children: [
      callout(
        result
          ? l(`${result.plan}を利用できます`, `${result.plan} is available`)
          : l(
              "このコードはこのサーバーでは利用できません",
              "This code cannot be used for this server",
            ),
        result
          ? result.benefitEnd
            ? `${l("有効期限", "Valid until")} <t:${Math.floor(new Date(result.benefitEnd).getTime() / 1000)}:D>`
            : l("取消まで有効", "Until revoked")
          : l(
              "コードと現在の支払い権限を確認してください。",
              "Check the code and your current billing authority.",
            ),
      ),
    ],
    rows: [
      await actionRow(issue, [
        { label: l("プランに戻る", "Back to plan"), action: "billing" },
      ]),
    ],
  });
}
export async function lockedFeaturePanel(
  issue: Issue,
  decision: EntitlementDecision,
  feature: EntitlementFeature,
  locale: UiLocale = "en",
) {
  const l = (ja: string, en: string) => label(locale, ja, en),
    name = featureCopy[feature][locale === "ja" ? 0 : 1];
  return nexusPanel({
    title: l("NEXUS · 機能の利用条件", "NEXUS · Feature availability"),
    children: [
      callout(
        name,
        decision.reason === "FEATURE_PLANNED"
          ? l("この機能は準備中です。", "This feature is planned.")
          : `${l("現在のプラン", "Current plan")}: ${decision.effectivePlan}\n${l("必要なプラン", "Required plan")}: ${decision.requiredPlan}\n${l("アップグレード後に利用できます", "Available after upgrade")}: ${name}`,
      ),
    ],
    rows: [
      await actionRow(issue, [
        { label: l("プランを見る", "View plans"), action: "billing" },
        { label: l("戻る", "Back"), action: "settings" },
      ]),
    ],
  });
}
