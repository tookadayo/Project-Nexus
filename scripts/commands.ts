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
    "Verify this server for the Web Dashboard",
    "接続",
    "このサーバーのWeb接続を検証します",
  ],
  [
    "unlink",
    "Disconnect the Web Dashboard after confirmation",
    "接続解除",
    "確認後にWeb Dashboardの接続を解除します",
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
      .setDescription("Community snapshot and observation coverage")
      .setDescriptionLocalizations({
        ja: "コミュニティの観測とCoverageを確認",
      }),
  );
  for (const name of ["chart", "compare"] as const)
    command.addSubcommand((sub) =>
      sub
        .setName(name)
        .setDescription(
          name === "chart"
            ? "Show an aggregate community chart"
            : "Compare aggregate community periods",
        )
        .addStringOption((option) =>
          option
            .setName("metric")
            .setDescription("Observed community surface")
            .addChoices(
              ...["reply", "forum", "voice", "event", "reaction", "poll"].map(
                (value) => ({ name: value, value }),
              ),
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("days")
            .setDescription("Completed UTC days")
            .addChoices(
              { name: "7 days", value: 7 },
              { name: "30 days", value: 30 },
              { name: "90 days", value: 90 },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("visibility")
            .setDescription("Private reply or authorized channel publication")
            .addChoices(
              { name: "private", value: "private" },
              { name: "channel", value: "channel" },
            ),
        ),
    );
  for (const name of ["support-health", "newcomer-flow"] as const)
    command.addSubcommand((sub) =>
      sub
        .setName(name)
        .setDescription("Open a configured saved operational report"),
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
