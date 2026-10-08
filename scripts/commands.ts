import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} from "discord.js";
const commands = [
  [
    "panel",
    "Open the NEXUS control panel",
    "パネル",
    "コミュニティ管理パネルを開きます",
  ],
  [
    "personalize",
    "Choose what you want to see",
    "自分の設定",
    "参加時の設定を選びます",
  ],
  [
    "privacy",
    "View privacy settings and request deletion",
    "プライバシー",
    "プライバシー設定の確認と削除依頼を行います",
  ],
  [
    "status",
    "Check connection and permissions",
    "状態",
    "接続と権限を確認します",
  ],
  [
    "plan",
    "View this server’s plan and billing",
    "プラン",
    "サーバーのプランと支払いを確認します",
  ],
  [
    "link",
    "Verify this server for the Web screen",
    "接続",
    "このサーバーのWeb接続を検証します",
  ],
  [
    "unlink",
    "Disconnect the Web screen after confirmation",
    "接続解除",
    "確認後にWeb画面の接続を解除します",
  ],
] as const;
export function buildNexusCommand() {
  const command = new SlashCommandBuilder()
    .setName("nexus")
    .setDescription("Understand and improve your community")
    .setDescriptionLocalizations({
      ja: "コミュニティの状況を確認し、改善します",
    })
    .setContexts(0)
    .setIntegrationTypes(0);
  for (const [name, description, jaName, jaDescription] of commands)
    command.addSubcommand((sub) =>
      sub
        .setName(name)
        .setNameLocalizations({ ja: jaName })
        .setDescription(description)
        .setDescriptionLocalizations({ ja: jaDescription }),
    );
  command.addSubcommand((sub) =>
    sub
      .setName("overview")
      .setDescription("Open the NEXUS Home")
      .setDescriptionLocalizations({
        ja: "サーバーの状況とデータの有無を確認",
      }),
  );
  for (const name of ["chart", "compare"] as const)
    command.addSubcommand((sub) =>
      sub
        .setName(name)
        .setDescriptionLocalizations({ja:name==="chart"?"確認できた活動のグラフを表示します":"確認できた活動を期間ごとに比べます"})
        .setDescription(
          name === "chart"
            ? "Show an aggregate community chart"
            : "Compare aggregate community periods",
        )
        .addStringOption((option) =>
          option
            .setName("metric")
            .setDescription("Activity to show")
            .setDescriptionLocalizations({ja:"表示する活動"})
            .addChoices(
              ...["reply", "forum", "voice", "event", "reaction", "poll"].map(
                (value) => ({ name: ({reply:"Posts and replies",forum:"Forum posts",voice:"Voice co-presence",event:"Events",reaction:"Reactions",poll:"Poll participants"} as Record<string,string>)[value]!,name_localizations:{ja:({reply:"投稿と返信",forum:"フォーラム投稿",voice:"ボイス同席",event:"イベント",reaction:"リアクション",poll:"投票人数"} as Record<string,string>)[value]!}, value }),
              ),
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("days")
            .setDescription("Completed UTC days")
            .setDescriptionLocalizations({ja:"UTCで完了済みの日数"})
            .addChoices(
              { name: "7 days", name_localizations:{ja:"7日間"}, value: 7 },
              { name: "30 days", name_localizations:{ja:"30日間"}, value: 30 },
              { name: "90 days", name_localizations:{ja:"90日間"}, value: 90 },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("visibility")
            .setDescription("Private reply or authorized channel publication")
            .setDescriptionLocalizations({ja:"自分だけに表示、または権限を確認してチャンネルへ送信"})
            .addChoices(
              { name: "Only me", name_localizations:{ja:"自分だけ"}, value: "private" },
              { name: "Send to this channel", name_localizations:{ja:"このチャンネルへ送る"}, value: "channel" },
            ),
        ),
    );
  for (const name of ["support-health", "newcomer-flow"] as const)
    command.addSubcommand((sub) =>
      sub
        .setName(name)
        .setDescription("Open a configured saved team report")
        .setDescriptionLocalizations({ja:name==="support-health"?"設定した質問受付の状況を確認します":"新しい参加者の活動を確認します"}),
    );
  return command;
}
export function buildNexusCommands() {
  const context = (
    name: string,
    type: ApplicationCommandType.User | ApplicationCommandType.Message,
    ja: string,
  ) =>
    new ContextMenuCommandBuilder()
      .setName(name)
      .setNameLocalizations({ ja })
      .setType(type)
      .setDefaultMemberPermissions(null)
      .setContexts(0)
      .setIntegrationTypes(0);
  return [
    buildNexusCommand(),
    context(
      "NEXUS: Add to Attention",
      ApplicationCommandType.Message,
      "NEXUS: 対応対象に追加",
    ),
    context(
      "NEXUS: Mark Resolved",
      ApplicationCommandType.Message,
      "NEXUS: 対応済みにする",
    ),
    context(
      "NEXUS: Explain Detection",
      ApplicationCommandType.Message,
      "NEXUS: この投稿の判定を見る",
    ),
    context(
      "NEXUS: New Member Status",
      ApplicationCommandType.User,
      "NEXUS: 新規メンバー状態を見る",
    ),
  ];
}
