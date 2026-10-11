import type {
  ChartMetric,
  OperationalFilter,
} from "../../../packages/analytics/src/chart-spec";
import type { NexusRole } from "../../../packages/operations/src/policy";

type Label = { ja: string; en: string };
export const metricLabels: Record<ChartMetric, Label> = {
  reply: { ja: "直接の返信", en: "Direct replies" },
  forum: { ja: "フォーラムの初回返信", en: "Forum first responses" },
  voice: { ja: "条件を満たすボイス同席", en: "Qualified voice co-presence" },
  event: {
    ja: "イベント参加登録（出席ではありません）",
    en: "Event signups (not attendance)",
  },
  reaction: { ja: "リアクションへの参加", en: "Reaction participation" },
  poll: { ja: "投票への参加", en: "Poll participation" },
};
export const surfaceLabels: Record<OperationalFilter["surface"], Label> = {
  ALL: { ja: "すべて", en: "All" },
  TEXT: { ja: "テキスト", en: "Text" },
  FORUM: { ja: "フォーラム", en: "Forum" },
  VOICE: { ja: "ボイス", en: "Voice" },
  EVENT: { ja: "イベント", en: "Event" },
};
export const nexusRoleLabels: Record<NexusRole, Label> = {
  OWNER: { ja: "所有者", en: "Owner" },
  ADMIN: { ja: "管理者", en: "Administrator" },
  OPERATOR: { ja: "運営担当", en: "Operator" },
  ANALYST: { ja: "分析担当", en: "Analyst" },
  VIEWER: { ja: "閲覧者", en: "Viewer" },
};
export function nexusRoleLabel(role: string, locale: "ja" | "en") {
  return Object.hasOwn(nexusRoleLabels, role)
    ? nexusRoleLabels[role as NexusRole][locale]
    : locale === "ja"
      ? "権限を確認できません"
      : "Role unavailable";
}
