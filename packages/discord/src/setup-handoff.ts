import {
  ButtonStyle,
  ComponentType,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { webOrigin } from "../../config/src/web-origin";
import { discordSetupUrl } from "./install";

/** Shared by a genuine installation notice and the retired Discord setup UI. */
export function setupHandoff(
  guildId: string,
  complete = false,
  origin = webOrigin(),
): RESTPostAPIChannelMessageJSONBody {
  return {
    content: complete
      ? "NEXUSの設定はWebで管理します。ログイン後、現在の権限を確認してダッシュボードを開きます。\n\nManage NEXUS on the web. Sign in to verify your current permissions and open the dashboard."
      : "NEXUSの設定はWebで行います。サーバーを管理できる方は、下のボタンからログインして初期設定を進めてください。Webで現在の管理権限とBotの導入状態を確認します。既存の設定は保持されます。\n\nSet up NEXUS on the web. If you manage this server, use the button below to sign in and finish setup. We check your current management permissions and bot installation on the web. Existing settings are preserved.",
    allowed_mentions: { parse: [], replied_user: false },
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: complete
              ? "ダッシュボードを開く / Open Dashboard"
              : "Webで設定する / Open Web Setup",
            url: discordSetupUrl(origin, guildId, complete),
          },
        ],
      },
    ],
  };
}

/** Deliberately bounded list: lifecycle stop, revoke and deletion stay available. */
export function legacySetupAction(action: string, value?: unknown) {
  if (
    [
      "enabled",
      "onboardingEnabled",
      "helperEnabled",
      "controlHelperToggle",
      "controlWeeklyToggle",
    ].includes(action) &&
    value === false
  )
    return false;
  if (action === "enabled") return true;
  return (
    action.startsWith("setupWizard") ||
    [
      "setup",
      "setupHome",
      "setupNext",
      "controlReviewSetup",
      "recommendedSetup",
      "controlNotificationSave",
      "controlSummaryField",
      "controlGoalPurpose",
      "controlScope",
      "controlScopeChannels",
      "controlManagers",
      "controlManagersConfirm",
      "controlCancelManagers",
      "controlClearManagers",
      "controlClearHelpers",
      "controlSkipTeam",
      "controlSkipNotifications",
      "controlSkipGoals",
      "controlScopeDefault",
      "controlKeepSettings",
      "controlHelpers",
      "controlHelperChannel",
      "controlAlertDelay",
      "controlHelperToggle",
      "controlGoal",
      "controlGoalPreset",
      "controlGoalChannel",
      "controlWeeklyChannel",
      "controlWeeklyDay",
      "controlWeeklyHour",
      "controlTimezone",
      "controlWeeklyToggle",
      "template",
      "startChannel",
      "adminNotificationChannel",
      "helperChannel",
      "helperEnabled",
      "uiLanguage",
      "onboardingEnabled",
      "mapOption",
      "mapRole",
      "editNode",
      "editNodeOpen",
      "editNodeSave",
      "rollback",
      "configPublish",
      "rolloutPreview",
      "rolloutConfirm",
      "modePreview",
      "modeConfirm",
    ].includes(action)
  );
}
