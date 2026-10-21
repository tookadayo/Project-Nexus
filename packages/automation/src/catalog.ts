import type {
  ActionOperation,
  ExpressionOperator,
  Statement,
  ValueType,
} from "./types";

export interface BlockCatalogEntry {
  id: string;
  label: { ja: string; en: string };
  category:
    "start" | "control" | "value" | "time" | "message" | "discord" | "reuse";
  shape: "start" | "statement" | "value" | "condition" | "container";
  availability: "available" | "unavailable";
  reason?: { ja: string; en: string };
  statementKind?: Statement["kind"];
  operation?: ExpressionOperator | ActionOperation;
  aliases?: string[];
}
export interface ActionDefinition {
  operation: ActionOperation;
  inputs: Record<string, { type: ValueType; optional?: boolean }>;
  outputType?: ValueType;
  externalChange: boolean;
  requiresApproval: boolean;
  permission: string;
  reconciliation: "ownedMessage" | "targetState" | "none";
}
/** Registration describes a contract. A live adapter must still verify current authorization. */
export const ACTION_DEFINITIONS: Readonly<
  Record<ActionOperation, ActionDefinition>
> = {
  "discord.sendMessage": {
    operation: "discord.sendMessage",
    inputs: {
      channel: { type: "ChannelRef" },
      content: { type: "PlainText", optional: true },
      messageSpec: { type: "LegacyMessageSpec", optional: true },
    },
    outputType: "MessageRef",
    externalChange: true,
    requiresApproval: false,
    permission: "SEND_MESSAGES",
    reconciliation: "ownedMessage",
  },
  "discord.editOwnMessage": {
    operation: "discord.editOwnMessage",
    inputs: {
      message: { type: "MessageRef" },
      content: { type: "PlainText", optional: true },
      messageSpec: { type: "LegacyMessageSpec", optional: true },
    },
    outputType: "MessageRef",
    externalChange: true,
    requiresApproval: false,
    permission: "OWN_MESSAGE",
    reconciliation: "ownedMessage",
  },
  "discord.addRole": {
    operation: "discord.addRole",
    inputs: { member: { type: "MemberRef" }, role: { type: "RoleRef" } },
    externalChange: true,
    requiresApproval: true,
    permission: "MANAGE_ROLES_APPROVED_ALLOWLIST",
    reconciliation: "targetState",
  },
  "discord.removeRole": {
    operation: "discord.removeRole",
    inputs: { member: { type: "MemberRef" }, role: { type: "RoleRef" } },
    externalChange: true,
    requiresApproval: true,
    permission: "MANAGE_ROLES_APPROVED_ALLOWLIST",
    reconciliation: "targetState",
  },
  "discord.createChannel": {
    operation: "discord.createChannel",
    inputs: { name: { type: "PlainText" }, parent: { type: "ChannelRef" } },
    outputType: "ChannelRef",
    externalChange: true,
    requiresApproval: false,
    permission: "MANAGE_CHANNELS_LIMITED_SCOPE",
    reconciliation: "none",
  },
  "discord.createThread": {
    operation: "discord.createThread",
    inputs: { channel: { type: "ChannelRef" }, name: { type: "PlainText" } },
    outputType: "ThreadRef",
    externalChange: true,
    requiresApproval: false,
    permission: "CREATE_PUBLIC_THREADS",
    reconciliation: "none",
  },
  "nexus.readTicket": {
    operation: "nexus.readTicket",
    inputs: { ticket: { type: "TicketRef" } },
    outputType: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
    externalChange: false,
    requiresApproval: false,
    permission: "READ_TICKET",
    reconciliation: "none",
  },
};
const entry = (
  id: string,
  ja: string,
  en: string,
  category: BlockCatalogEntry["category"],
  shape: BlockCatalogEntry["shape"],
  extra: Partial<BlockCatalogEntry> = {},
): BlockCatalogEntry => ({
  id,
  label: { ja, en },
  category,
  shape,
  availability: "available",
  ...extra,
});
const disabled = (
  id: string,
  ja: string,
  en: string,
  category: BlockCatalogEntry["category"],
  reasonJa: string,
  reasonEn: string,
): BlockCatalogEntry =>
  entry(id, ja, en, category, "statement", {
    availability: "unavailable",
    reason: { ja: reasonJa, en: reasonEn },
  });
const notRegisteredJa =
  "この操作は現在利用できません。保存済みの内容は保持されます。";
const notRegisteredEn =
  "This operation is currently unavailable. Existing saved content is preserved.";
/** Candidate IDs remain searchable. An unavailable card never becomes executable by hiding its UI. */
export const AUTOMATION_CATALOG: readonly BlockCatalogEntry[] = [
  entry("TR01", "手動で開始", "Manual start", "start", "start"),
  entry("TR02", "予定時刻に開始", "Start on schedule", "start", "start"),
  disabled(
    "TR03",
    "フォームで受付",
    "Start from form",
    "start",
    notRegisteredJa,
    notRegisteredEn,
  ),
  entry("TR04", "ボタン操作で開始", "Start from interaction", "start", "start"),
  entry(
    "TR05",
    "受付の状態変化で開始",
    "Start from NEXUS event",
    "start",
    "start",
  ),
  disabled(
    "TR06",
    "投稿イベントで開始",
    "Start from message event",
    "start",
    "投稿イベントをきっかけにする機能は現在利用できません。本文は収集しません。",
    "Starting from a message event is currently unavailable. Message content is not collected.",
  ),
  disabled(
    "TR07",
    "Discordの状態変化で開始",
    "Start from Discord state change",
    "start",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "TR08",
    "集計期間終了で開始",
    "Start when window closes",
    "start",
    "新たな集計保持は今回の対象外です。",
    "New aggregate retention is outside this release.",
  ),
  entry("CT01", "条件で分ける", "Branch by condition", "control", "container", {
    statementKind: "branch",
  }),
  entry("CT02", "選択値で分ける", "Switch on choice", "control", "container", {
    statementKind: "switch",
  }),
  entry(
    "CT03",
    "決まった回数か一覧を繰り返す",
    "Repeat a count or list",
    "control",
    "container",
    { statementKind: "repeat" },
  ),
  entry("CT04", "時間を待つ", "Wait", "time", "statement", {
    statementKind: "wait",
  }),
  entry(
    "CT05",
    "操作や状態変化を待つ",
    "Await an event",
    "time",
    "container",
    { statementKind: "awaitEvent", aliases: ["受付", "状態変化", "イベント待機", "ticketUpdated", "await"] },
  ),
  entry("CT06", "正式な承認を待つ", "Await approval", "time", "container", {statementKind:"approval"}),
  entry(
    "CT07",
    "並列に進めて合流",
    "Run and join parallel branches",
    "control",
    "container",
    { statementKind: "parallel" },
  ),
  entry("CT08", "共通手順を呼ぶ", "Call a procedure", "reuse", "statement", {
    statementKind: "call",
  }),
  entry(
    "CT09",
    "手順の結果を返す",
    "Return procedure results",
    "reuse",
    "statement",
    { statementKind: "return" },
  ),
  entry("CT10", "実行を終える", "End run", "control", "statement", {
    statementKind: "end",
  }),
  entry(
    "CT11",
    "状態を有界に再確認",
    "Recheck state with bounds",
    "control",
    "container",
    { statementKind: "poll", aliases: ["受付", "有限", "再確認", "ticket", "bounded", "poll"] },
  ),
  disabled(
    "CT12",
    "同じ用途の間隔を空ける",
    "Apply a cooldown",
    "control",
    "実行をまたぐ可変状態は今回の対象外です。",
    "Mutable state across runs is outside this release.",
  ),
  entry(
    "CT13",
    "この繰り返しを抜けるか次へ進む",
    "Break or continue this loop",
    "control",
    "statement",
    { statementKind: "break" },
  ),
  entry(
    "CT14",
    "結果に応じて進む",
    "Branch on a result",
    "control",
    "container",
    { statementKind: "resultBranch", aliases: ["成功", "変換失敗", "未開始", "結果不明", "outcome", "parse result"] },
  ),
  entry(
    "CT15",
    "自作の値ブロックを使う",
    "Use a custom value block",
    "reuse",
    "value",
    { operation: "pure.call" },
  ),
  entry("DA01", "変数を宣言", "Declare a variable", "value", "statement", {
    statementKind: "declare",
  }),
  entry("DA02", "変数へ代入", "Assign a variable", "value", "statement", {
    statementKind: "assign",
  }),
  entry("DA03", "値を参照", "Read a value", "value", "value"),
  entry(
    "DA04",
    "一覧を作るまたは加工",
    "Build or transform a list",
    "value",
    "value",
    { operation: "list.build", aliases: ["合計", "平均", "差分", "5件ずつ"] },
  ),
  disabled(
    "DA05",
    "許可済み集計を読む",
    "Read an approved aggregate",
    "value",
    notRegisteredJa,
    notRegisteredEn,
  ),
  entry(
    "DA06",
    "項目をまとめた値を作るか更新",
    "Build or update a record",
    "value",
    "value",
    { operation: "record.build" },
  ),
  entry(
    "DA07",
    "任意項目の値を使う",
    "Use an optional value",
    "value",
    "value",
    { operation: "optional.default", statementKind: "optionalBranch", aliases: ["空なら", "未設定", "値あり", "present", "unset"] },
  ),
  entry("EX01", "数値を計算", "Calculate numbers", "value", "value", {
    operation: "number.add",
    aliases: ["足す", "引く", "割る", "掛ける"],
  }),
  entry("EX02", "値を比較", "Compare values", "value", "condition", {
    operation: "compare.equal",
  }),
  entry(
    "EX03",
    "条件を組み合わせる",
    "Combine conditions",
    "value",
    "condition",
    { operation: "condition.and" },
  ),
  entry("EX04", "案内文を作る", "Render text", "message", "value", {
    operation: "text.join",
  }),
  entry(
    "EX05",
    "文字を調べるか加工",
    "Inspect or transform text",
    "value",
    "value",
    { operation: "text.contains" },
  ),
  entry("EX06", "時間量を作る", "Build a duration", "time", "value", {
    operation: "duration.build",
  }),
  entry("EX07", "日付を組み立てる", "Compose a date", "time", "value", {
    operation: "date.compose",
  }),
  entry(
    "EX08",
    "日時を計算または表示",
    "Transform date and time",
    "time",
    "value",
    { operation: "date.addDays" },
  ),
  entry("EX09", "期間を組み立てる", "Build a range", "time", "value", {operation:"dateRange.build"}),
  entry(
    "EX10",
    "現在時刻を確認",
    "Read the current time",
    "time",
    "statement",
    { statementKind: "readClock" },
  ),
  entry(
    "EX11",
    "指定形式で値を変換",
    "Convert a value with a format",
    "value",
    "value",
    { operation: "value.parse", aliases: ["数値変換", "日付変換", "厳密", "decimal", "parse"] },
  ),
  entry(
    "EX12",
    "抽選結果を一度だけ決める",
    "Generate and keep a random result",
    "value",
    "statement",
    { statementKind: "random" },
  ),
  entry("MV01", "装飾した文章を作る", "Build rich text", "message", "value", {
    operation: "rich.text",
  }),
  entry("MV02", "Embedを作る", "Build an embed", "message", "value", {
    operation: "embed.build",
  }),
  entry(
    "MV03",
    "通常メッセージを作る",
    "Build a legacy message",
    "message",
    "value",
    { operation: "message.legacy" },
  ),
  disabled(
    "MV04",
    "V2メッセージを作る",
    "Build a V2 message",
    "message",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "MV05",
    "入力画面を作る",
    "Build a modal",
    "message",
    notRegisteredJa,
    notRegisteredEn,
  ),
  entry(
    "DO01",
    "受付の状態を読む",
    "Read ticket state",
    "discord",
    "statement",
    { statementKind: "action", operation: "nexus.readTicket" },
  ),
  entry("DO02", "メッセージを送る", "Send a message", "discord", "statement", {
    statementKind: "action",
    operation: "discord.sendMessage",
  }),
  entry(
    "DO03",
    "自分の投稿を編集",
    "Edit an owned message",
    "discord",
    "statement",
    { statementKind: "action", operation: "discord.editOwnMessage" },
  ),
  disabled(
    "DO04",
    "自分のリアクションを変更",
    "Change an owned reaction",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO05",
    "許可投稿の固定を変更",
    "Change a permitted pin",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  entry("DO06", "スレッドを作る", "Create a thread", "discord", "statement", {
    statementKind: "action",
    operation: "discord.createThread",
  }),
  disabled(
    "DO07",
    "スレッドの状態を変更",
    "Change thread state",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO08",
    "フォーラム投稿を作る",
    "Create a forum post",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  entry(
    "DO09",
    "許可ロールを変更",
    "Change an approved role",
    "discord",
    "statement",
    {
      statementKind: "action",
      operation: "discord.addRole",
    },
  ),
  disabled(
    "DO10",
    "自分の予定イベントを管理",
    "Manage an owned scheduled event",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO11",
    "Discord投票を扱う",
    "Manage a Discord poll",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO12",
    "操作へ応答する",
    "Respond to an interaction",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO13",
    "受付を作るか更新",
    "Create or update a ticket",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "DO14",
    "投稿本文や履歴を取得",
    "Retrieve message content or history",
    "discord",
    "本文・履歴の追加収集は今回の対象外です。",
    "Additional message content and history collection is outside this release.",
  ),
  entry(
    "GX01",
    "許可範囲にチャンネルを作る",
    "Create a channel in a permitted scope",
    "discord",
    "statement",
    { statementKind: "action", operation: "discord.createChannel" },
  ),
  disabled(
    "GX02",
    "ロール定義を管理",
    "Manage role definitions",
    "discord",
    "特権の付与や変更は今回の対象外です。",
    "Privilege definition changes are outside this release.",
  ),
  disabled(
    "GX03",
    "招待を管理",
    "Manage invites",
    "discord",
    notRegisteredJa,
    notRegisteredEn,
  ),
  disabled(
    "GX04",
    "モデレーションを実行",
    "Apply moderation",
    "discord",
    "BAN、キック、大量削除は提供しません。",
    "Ban, kick and bulk deletion are not provided.",
  ),
  disabled(
    "GX05",
    "メンバー一覧を取得",
    "Retrieve a member list",
    "discord",
    "全員名簿の追加収集は今回の対象外です。",
    "Additional member-directory collection is outside this release.",
  ),
];
export function searchAutomationCatalog(
  query: string,
  language: "ja" | "en" = "ja",
): BlockCatalogEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return AUTOMATION_CATALOG.filter((card) =>
    terms.every((term) =>
      [
        card.id,
        card.label[language],
        card.label.ja,
        card.label.en,
        ...(card.aliases ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
}
const validationJapanese: Record<string, string> = {
  SCHEMA: "入力の型や選択値が正しくありません。該当欄を確認してください。",
  DEFINITION_BYTES: "保存する定義の容量が上限を超えています。",
  DEFINITION_DEPTH: "手順や値の入れ子が深すぎます。",
  MISSING_INPUT: "値を入力するか、変数・計算を選んでください。",
  MISSING_TARGET_POLICY: "この操作に使える対象を選んでください。",
  TARGET_POLICY: "選択した操作範囲に含まれない対象です。",
  TARGET_DUPLICATE: "同じ対象が重複しています。",
  TYPE: "ここには指定された型の値が必要です。",
  COUNT: "件数には、許可された範囲の0以上の整数が必要です。",
  COUNT_FORMAT: "件数は半角の0以上の整数で入力してください。",
  DIVIDE_BY_ZERO: "0で割る計算はできません。",
  FINITE_NUMBER: "有限の数値を入力してください。",
  VARIABLE_SCOPE:
    "この場所では使えない値です。利用できる変数を選んでください。",
  VARIABLE_READONLY: "起点・引数・並列の親から受け取った値は変更できません。",
  VARIABLE_ID: "変数の識別子が重複しています。",
  BLOCK_ID: "ブロックの識別子が重複しています。",
  APPROVAL_REQUIRED:
    "このロール変更には、対象と内容を固定した正式な承認が必要です。",
  WAIT_LIMIT:
    "1回の待機は7日以内です。長期予定は予定起点として設定してください。",
  WAIT_INPUT: "待つ時間量か、再開する日時のどちらかを選んでください。",
  LOOP_BOUNDARY: "操作できるのは、直近の繰り返しだけです。",
  PROCEDURE_CYCLE: "共通手順を再帰的に呼び出すことはできません。",
  PURE_CYCLE: "自作の値ブロックを再帰的に呼び出すことはできません。",
  PURE_EFFECT: "この値ブロック内では、送信や現在時刻の取得は使えません。",
  STEP_BUDGET: "展開後の処理数が上限を超えます。回数や手順を見直してください。",
  ACTION_BUDGET:
    "外部への操作回数が上限を超えます。対象や繰り返しを見直してください。",
  STATEMENT_BUDGET: "定義に含まれる処理数が上限を超えています。",
  EXPRESSION_BUDGET: "計算の深さや要素数が上限を超えています。",
  SERVICE_VALUE:
    "通常の値から、正式な承認や外部操作の結果を作ることはできません。",
  REFERENCE_SCOPE: "このサーバーの許可された対象を選んでください。",
  DETACHED: "未接続のブロックをつなぐか、「今回は使わない」にしてください。",
  UNREACHABLE: "終了や移動の後にある、実行できない処理を確認してください。",
};
/** Localized safe guidance; the stable code and field association remain the same. */
export function automationValidationMessage(
  issue: { code: string; message: string },
  language: "ja" | "en",
): string {
  return language === "en"
    ? issue.message
    : (validationJapanese[issue.code] ??
        "この項目を確認してください。入力値は変更していません。");
}
