import type {
  ActionOperation,
  ExpressionOperator,
  FlowDefinition,
  Statement,
  ValueInput,
  ValueType,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import { runBuiltinDeclarations } from "../../../../packages/automation/src/builtins";
import { registeredPairFields } from "../../../../packages/automation/src/registered-pairs";
import { ACTION_DEFINITIONS } from "../../../../packages/automation/src/catalog";
import { typeEquals } from "../../../../packages/automation/src/expression";

export type Locale = "ja" | "en";
export const words = (locale: Locale, ja: string, en: string) =>
  locale === "ja" ? ja : en;
export const missing = (type: ValueType): ValueInput => ({
  kind: "missing",
  type,
});
export const uid = () => crypto.randomUUID();
/** Saved configuration only. Callers must not pass simulation or run values. */
export function flowDefinitionDifferences(
  before: FlowDefinition,
  after: FlowDefinition,
): {
  changes: { path: string; before: string; after: string }[];
  omitted: boolean;
} {
  const changes: { path: string; before: string; after: string }[] = [];
  let omitted = false;
  const label = (value: unknown) =>
    value === undefined ? "—" : (JSON.stringify(value) ?? "—").slice(0, 300);
  const compare = (a: unknown, b: unknown, path: string) => {
    if (omitted || JSON.stringify(a) === JSON.stringify(b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        compare(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        );
        if (omitted) break;
      }
    } else if (changes.length < 100) {
      changes.push({ path, before: label(a), after: label(b) });
    } else omitted = true;
  };
  compare(before, after, "");
  return { changes, omitted };
}
export const typeName = (type: ValueType, locale?: Locale): string => {
  if (typeof type === "string") {
    if (!locale) return type;
    if (type === "DateOnly")
      return words(locale, "日付（ISOカレンダー）", "Date (ISO calendar)");
    if (type === "LocalTime")
      return words(
        locale,
        "現地時刻・分（従来型）",
        "Local time · minutes (legacy)",
      );
    if (type === "Instant")
      return words(locale, "時点（UTC）", "Instant (UTC)");
    if (type === "InstantRange")
      return words(
        locale,
        "時点の範囲（従来型・空不可）",
        "Instant range (legacy, nonempty)",
      );
    if (type === "LocalTimeWindowSpec")
      return words(
        locale,
        "地域の時間窓（翌日を明示）",
        "Local time window (explicit end day)",
      );
    return type;
  }
  if (type.kind === "LocalTime")
    return locale === "ja"
      ? `現地時刻・${type.precision === "second" ? "秒" : "分"}（精度指定）`
      : `Local time · ${type.precision === "second" ? "seconds" : "minutes"} (explicit precision)`;
  if (type.kind === "InstantRange")
    return locale === "ja"
      ? "時点の範囲（空区間も表現）"
      : "Instant range (empty allowed)";
  if (type.kind === "List") return `List<${typeName(type.element, locale)}>`;
  if (
    type.kind === "Optional" ||
    type.kind === "ParseResult" ||
    type.kind === "OperationOutcome"
  )
    return `${type.kind === "ParseResult" ? (locale === "ja" ? "読み取り結果" : "Parsed result") : type.kind === "OperationOutcome" ? (locale === "ja" ? "操作の結果" : "Operation result") : type.kind}<${typeName(type.value, locale)}>`;
  if (type.kind === "Record") {
    const pair = registeredPairFields(type);
    if (pair)
      return `${locale === "ja" ? "組" : "Pair"}<${typeName(pair.first, locale)},${typeName(pair.second, locale)}>`;
    const names: Record<string, [string, string]> = {
      "nexus.group.v1": ["グループ", "Group"],
      "nexus.find-match.v1": [
        "見つかった項目と位置",
        "Found item and position",
      ],
      "nexus.iteration-result.v1": ["各回の結果", "Iteration result"],
      "nexus.ticket.status.v1": ["受付の状態", "Ticket state"],
      MinMaxValue: ["最小値と最大値", "Minimum and maximum"],
    };
    const name =
      names[type.schemaId]?.[locale === "ja" ? 0 : 1] ??
      (locale === "ja" ? "登録された記録" : "Registered record");
    return type.typeArgs?.length
      ? `${name}<${type.typeArgs.map((item) => typeName(item, locale)).join(",")}>`
      : name;
  }
  return locale
    ? `${words(locale, "選択値", "Choice")}${type.schemaRevision ? words(locale, ` · 版${type.schemaRevision}`, ` · revision ${type.schemaRevision}`) : ""}`
    : "Enum";
};
export const procedureArea = (id: string, revision: number) =>
  `procedure:${id}@${revision}`;
export const matchesProcedureArea = (
  area: string,
  procedure: { id: string; revision: number },
) =>
  area === procedureArea(procedure.id, procedure.revision) ||
  area === `procedure:${procedure.id}`;
export const sameType = (a: ValueType, b: ValueType) => typeEquals(a, b);

export type StatementKind = Statement["kind"];
export interface PaletteCard {
  id: string;
  ja: string;
  en: string;
  category: "control" | "value" | "discord" | "time" | "reuse";
  kind: StatementKind;
  operation?: ActionOperation;
  mode?: "integer" | "sample" | "shuffle";
  aliases: string;
  unavailable?: boolean;
}
export const PALETTE: PaletteCard[] = [
  {
    id: "endBranch",
    ja: "この並列の枝を終える",
    en: "End this parallel branch",
    category: "control",
    kind: "endBranch",
    aliases: "stop branch 終了 並列 枝",
  },
  {
    id: "endRun",
    ja: "子手順と並列を含め、この実行を終える",
    en: "End this run, including child and parallel steps",
    category: "control",
    kind: "endRun",
    aliases: "stop run all 終了 実行 全体",
  },
  {
    id: "searchBranch",
    ja: "検索で見つかったときだけ位置を使う",
    en: "Use a position only when a search finds it",
    category: "control",
    kind: "searchBranch",
    aliases: "find index search 検索 位置 見つかった not_found",
  },
  {
    id: "while",
    ja: "条件が成立する間、上限つきで繰り返す",
    en: "Repeat while true, with bounds",
    category: "control",
    kind: "boundedLoop",
    aliases: "while 条件 反復 ループ 上限",
  },
  {
    id: "until",
    ja: "条件が成立するまで、上限つきで繰り返す",
    en: "Repeat until true, with bounds",
    category: "control",
    kind: "boundedLoop",
    aliases: "until 条件 反復 ループ 上限",
  },
  {
    id: "approval",
    ja: "後続のロール操作の正式な承認を待つ",
    en: "Await formal approval for a later role action",
    category: "control",
    kind: "approval",
    aliases: "承認 待機 ロール formal approval role",
  },
  {
    id: "resultBranch",
    ja: "読み取り・操作の結果で分ける",
    en: "Branch on a typed result",
    category: "control",
    kind: "resultBranch",
    aliases: "成功 失敗 未開始 結果不明 parse result outcome",
  },
  {
    id: "optionalBranch",
    ja: "値があるときとないときで分ける",
    en: "Branch on an optional value",
    category: "control",
    kind: "optionalBranch",
    aliases: "値 ある ない 未設定 optional present unset",
  },
  {
    id: "branch",
    ja: "条件で分ける",
    en: "Branch by condition",
    category: "control",
    kind: "branch",
    aliases: "もし if elif else それ以外でもし 条件 不明",
  },
  {
    id: "repeat",
    ja: "決まった回数繰り返す",
    en: "Repeat a count",
    category: "control",
    kind: "repeat",
    aliases: "ループ loop repeat 回数",
  },
  {
    id: "foreach",
    ja: "一覧の各項目を繰り返す",
    en: "Repeat a list",
    category: "control",
    kind: "repeat",
    aliases: "foreach 一覧 各項目",
  },
  {
    id: "wait",
    ja: "時間を待つ",
    en: "Wait",
    category: "time",
    kind: "wait",
    aliases: "分 時間 日 待機 wait duration",
  },
  {
    id: "poll",
    ja: "受付の状態を回数と期限つきで確認",
    en: "Recheck a ticket with bounds",
    category: "control",
    kind: "poll",
    aliases: "受付 状態 再確認 回数 期限 poll bounded ticket",
  },
  {
    id: "awaitEvent",
    ja: "同じ受付の更新を期限まで待つ",
    en: "Await an update to this ticket",
    category: "time",
    kind: "awaitEvent",
    aliases: "受付 更新 変化 待機 期限 event await ticket",
  },
  {
    id: "clock",
    ja: "今の時刻を確認",
    en: "Read the current time",
    category: "time",
    kind: "readClock",
    aliases: "時計 now 現在",
  },
  {
    id: "declare",
    ja: "変数を作る",
    en: "Create a variable",
    category: "value",
    kind: "declare",
    aliases: "宣言 名前 variable",
  },
  {
    id: "assign",
    ja: "変数に入れる",
    en: "Set a variable",
    category: "value",
    kind: "assign",
    aliases: "代入 set 変更",
  },
  {
    id: "integer",
    ja: "乱数を一度決める",
    en: "Generate an integer once",
    category: "value",
    kind: "random",
    mode: "integer",
    aliases: "抽選 random 乱数",
  },
  {
    id: "sample",
    ja: "重複なしで選ぶ",
    en: "Sample without replacement",
    category: "value",
    kind: "random",
    mode: "sample",
    aliases: "抽選 選ぶ sample",
  },
  {
    id: "shuffle",
    ja: "順番を一度混ぜる",
    en: "Shuffle once",
    category: "value",
    kind: "random",
    mode: "shuffle",
    aliases: "抽選 shuffle 混ぜる",
  },
  {
    id: "parallel",
    ja: "並列に進めて合流",
    en: "Run and join parallel branches",
    category: "control",
    kind: "parallel",
    aliases: "同時 並列 join",
  },
  {
    id: "break",
    ja: "この繰り返しを抜ける",
    en: "Break this loop",
    category: "control",
    kind: "break",
    aliases: "break ループ 抜ける",
  },
  {
    id: "continue",
    ja: "次の項目へ進む",
    en: "Continue this loop",
    category: "control",
    kind: "continue",
    aliases: "continue 次の項目 skip",
  },
  {
    id: "send",
    ja: "案内を送る",
    en: "Send a message",
    category: "discord",
    kind: "action",
    operation: "discord.sendMessage",
    aliases: "投稿 メッセージ 送信 send",
  },
  {
    id: "addRole",
    ja: "許可したロールを付ける",
    en: "Add an approved role",
    category: "discord",
    kind: "action",
    operation: "discord.addRole",
    aliases: "ロール role 付与",
  },
  {
    id: "removeRole",
    ja: "許可したロールを外す",
    en: "Remove an approved role",
    category: "discord",
    kind: "action",
    operation: "discord.removeRole",
    aliases: "ロール role 解除",
  },
  {
    id: "channel",
    ja: "許可したチャンネルを作る",
    en: "Create a permitted channel",
    category: "discord",
    kind: "action",
    operation: "discord.createChannel",
    aliases: "channel チャンネル 作成",
  },
  {
    id: "thread",
    ja: "スレッドを作る",
    en: "Create a thread",
    category: "discord",
    kind: "action",
    operation: "discord.createThread",
    aliases: "thread スレッド 作成",
  },
  {
    id: "editMessage",
    ja: "自分の投稿を編集",
    en: "Edit an owned message",
    category: "discord",
    kind: "action",
    operation: "discord.editOwnMessage",
    aliases: "投稿 編集 edit",
  },
  {
    id: "ticket",
    ja: "受付の状態を読む",
    en: "Read a ticket state",
    category: "discord",
    kind: "action",
    operation: "nexus.readTicket",
    aliases: "ticket 受付 状態 読む",
  },
  {
    id: "call",
    ja: "共通手順を呼ぶ",
    en: "Call a procedure",
    category: "reuse",
    kind: "call",
    aliases: "共通 再利用 procedure call",
  },
  {
    id: "return",
    ja: "手順の結果を返す",
    en: "Return procedure results",
    category: "reuse",
    kind: "return",
    aliases: "戻り値 return 結果",
  },
  {
    id: "end",
    ja: "この実行を終える",
    en: "End this run",
    category: "control",
    kind: "end",
    aliases: "終了 end stop",
  },
];

export function createDraft(guildId: string, locale: Locale): FlowDefinition {
  return {
    schemaVersion: 1,
    semanticProfile: "scratch.v1",
    id: uid(),
    guildId,
    name: words(locale, "新しい自動化", "New automation"),
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body: [],
    detached: [],
  };
}
const variable = (name: string, type: ValueType): VariableDeclaration => ({
  id: uid(),
  name,
  type,
});
export function createStatement(card: PaletteCard, locale: Locale): Statement {
  const id = uid();
  switch (card.kind) {
    case "endBranch":
      return { id, kind: "endBranch", semanticVersion: 1 };
    case "endRun":
      return { id, kind: "endRun", semanticVersion: 1 };
    case "searchBranch":
      return {
        id,
        kind: "searchBranch",
        value: missing({ kind: "Record", schemaId: "nexus.index-result.v1" }),
        index: variable(
          words(locale, "見つかった位置", "Found position"),
          "Number",
        ),
        found: [],
        notFound: [],
      };
    case "boundedLoop":
      return {
        id,
        kind: "boundedLoop",
        semanticVersion: 1,
        mode: card.id === "until" ? "until" : "while",
        maxBody: missing("Number"),
        until: missing("Instant"),
        condition: missing("Boolean"),
        body: [],
        handlers: {},
      };
    case "branch":
      return {
        id,
        kind: "branch",
        condition: missing("Boolean"),
        then: [],
        otherwise: [],
        unknown: [],
      };
    case "resultBranch":
      return {
        id,
        kind: "resultBranch",
        value: missing({ kind: "ParseResult", value: "Number" }),
        output: variable(
          words(locale, "成功した値", "Successful value"),
          "Number",
        ),
        reason: variable(
          words(locale, "確認した終了理由", "Verified reason"),
          "PlainText",
        ),
        succeeded: [],
        failed: [],
        notStarted: [],
        unknown: [],
      };
    case "optionalBranch":
      return {
        id,
        kind: "optionalBranch",
        value: missing({ kind: "Optional", value: "Number" }),
        output: variable(
          words(locale, "見つかった値", "Present value"),
          "Number",
        ),
        present: [],
        unset: [],
      };
    case "repeat":
      return {
        id,
        kind: "repeat",
        ...(card.id === "foreach"
          ? { list: missing({ kind: "List", element: "Number" }) }
          : { count: missing("Number") }),
        itemVariable: variable(
          words(locale, "現在の項目", "Current item"),
          "Number",
        ),
        body: [],
      };
    case "declare":
      return {
        id,
        kind: "declare",
        variable: variable(words(locale, "新しい値", "New value"), "Number"),
        value: missing("Number"),
      };
    case "assign":
      return { id, kind: "assign", variableId: "", value: missing("Number") };
    case "wait":
      return { id, kind: "wait", duration: missing("Duration") };
    case "approval":
      return {
        id,
        kind: "approval",
        actionId: "",
        until: missing("Instant"),
        approved: [],
        rejected: [],
        expired: [],
      };
    case "poll":
      return {
        id,
        kind: "poll",
        ticket: missing("TicketRef"),
        maxAttempts: missing("Number"),
        interval: missing("Duration"),
        until: missing("Instant"),
        output: variable(
          words(locale, "確認した受付状態", "Checked ticket state"),
          {
            kind: "Record",
            schemaId: "nexus.ticket.status.v1",
          },
        ),
        condition: missing("Boolean"),
        matched: [],
        exhausted: [],
        timedOut: [],
      };
    case "awaitEvent":
      return {
        id,
        kind: "awaitEvent",
        ticket: missing("TicketRef"),
        event: "ticketUpdated",
        states: [],
        until: missing("Instant"),
        output: variable(
          words(locale, "一致した受付状態", "Matched ticket state"),
          {
            kind: "Record",
            schemaId: "nexus.ticket.status.v1",
          },
        ),
        matched: [],
        timedOut: [],
      };
    case "readClock":
      return {
        id,
        kind: "readClock",
        output: variable(
          words(locale, "確認した時刻", "Checked time"),
          "Instant",
        ),
      };
    case "random": {
      const mode = card.mode ?? "integer";
      return {
        id,
        kind: "random",
        mode,
        output: variable(
          words(locale, "確定した抽選結果", "Committed draw"),
          mode === "integer" ? "Number" : { kind: "List", element: "Number" },
        ),
        ...(mode === "integer"
          ? { min: missing("Number"), max: missing("Number") }
          : {
              list: missing({ kind: "List", element: "Number" }),
              ...(mode === "sample" ? { count: missing("Number") } : {}),
            }),
      };
    }
    case "parallel":
      return {
        id,
        kind: "parallel",
        branches: [
          { id: uid(), name: words(locale, "手順 A", "Branch A"), body: [] },
          { id: uid(), name: words(locale, "手順 B", "Branch B"), body: [] },
        ],
      };
    case "call":
      return {
        id,
        kind: "call",
        procedureId: "",
        revision: 1,
        args: {},
        outputs: {},
      };
    case "return":
      return { id, kind: "return", values: {} };
    case "break":
      return { id, kind: "break" };
    case "continue":
      return { id, kind: "continue" };
    case "end":
      return { id, kind: "end" };
    case "action": {
      const operation = card.operation ?? "discord.sendMessage";
      const inputs: Record<string, ValueInput> =
        operation === "discord.sendMessage"
          ? { channel: missing("ChannelRef"), content: missing("PlainText") }
          : operation === "discord.addRole" ||
              operation === "discord.removeRole"
            ? { member: missing("MemberRef"), role: missing("RoleRef") }
            : operation === "discord.createThread"
              ? { channel: missing("ChannelRef"), name: missing("PlainText") }
              : operation === "discord.createChannel"
                ? { name: missing("PlainText"), parent: missing("ChannelRef") }
                : operation === "discord.editOwnMessage"
                  ? {
                      message: missing("MessageRef"),
                      content: missing("PlainText"),
                    }
                  : { ticket: missing("TicketRef") };
      return {
        id,
        kind: "action",
        operation,
        inputs,
        ...(operation === "discord.addRole" ||
        operation === "discord.removeRole"
          ? { approvalRequired: true }
          : {}),
      };
    }
    default:
      throw new Error("Unsupported statement card");
  }
}

export interface TreeBranch {
  key: string;
  ja: string;
  en: string;
  body: Statement[];
}
export function branches(statement: Statement): TreeBranch[] {
  if (statement.kind === "searchBranch")
    return [
      {
        key: "found",
        ja: "見つかったとき（位置を使用可能）",
        en: "When found (position available)",
        body: statement.found,
      },
      {
        key: "notFound",
        ja: "見つからなかったとき",
        en: "When not found",
        body: statement.notFound,
      },
    ];
  if (statement.kind === "boundedLoop")
    return [
      {
        key: "body",
        ja: "条件が継続するときの本文",
        en: "Body while the condition continues",
        body: statement.body,
      },
      ...(
        [
          [
            "limit",
            "上限到達 → この実行を非成功で終える",
            "Limit reached → end this run without success",
          ],
          [
            "conditionUnknown",
            "条件不明 → この実行を非成功で終える",
            "Condition unknown → end this run without success",
          ],
          [
            "evaluationError",
            "評価失敗 → この実行を非成功で終える",
            "Evaluation failed → end this run without success",
          ],
          [
            "localDeadline",
            "局所期限 → 純粋な処理で実行を終える",
            "Local deadline → end this run with pure steps",
          ],
        ] as const
      ).flatMap(([reason, ja, en]) =>
        statement.handlers[reason]
          ? [
              {
                key: `handler:${reason}`,
                ja,
                en,
                body: statement.handlers[reason]!,
              },
            ]
          : [],
      ),
    ];
  if (statement.kind === "approval")
    return [
      {
        key: "approved",
        ja: "正式に承認されたとき",
        en: "When formally approved",
        body: statement.approved,
      },
      {
        key: "rejected",
        ja: "拒否されたとき",
        en: "When rejected",
        body: statement.rejected,
      },
      {
        key: "expired",
        ja: "承認の期限を迎えたとき",
        en: "When approval expires",
        body: statement.expired,
      },
    ];
  if (statement.kind === "resultBranch") {
    const isOperation =
      typeof statement.value.type === "object" &&
      statement.value.type.kind === "OperationOutcome";
    return [
      {
        key: "succeeded",
        ja: "確認済み成功のとき",
        en: "When success is confirmed",
        body: statement.succeeded,
      },
      {
        key: "failed",
        ja: "確認済み失敗のとき",
        en: "When failure is confirmed",
        body: statement.failed,
      },
      ...(isOperation || statement.notStarted.length
        ? [
            {
              key: "notStarted",
              ja: "未開始のとき",
              en: "When not started",
              body: statement.notStarted,
            },
          ]
        : []),
      ...(isOperation || statement.unknown.length
        ? [
            {
              key: "unknown",
              ja: "結果を確認できないとき",
              en: "When the result is unknown",
              body: statement.unknown,
            },
          ]
        : []),
    ];
  }
  if (statement.kind === "optionalBranch")
    return [
      {
        key: "present",
        ja: "値があるとき",
        en: "When a value is present",
        body: statement.present,
      },
      {
        key: "unset",
        ja: "値がないとき",
        en: "When no value is present",
        body: statement.unset,
      },
    ];
  if (statement.kind === "poll" || statement.kind === "awaitEvent")
    return [
      {
        key: "matched",
        ja:
          statement.kind === "poll"
            ? "条件を満たしたとき"
            : "同じ受付の更新が一致したとき",
        en:
          statement.kind === "poll"
            ? "When the condition matches"
            : "When this ticket update matches",
        body: statement.matched,
      },
      ...(statement.kind === "poll"
        ? [
            {
              key: "exhausted",
              ja: "最大回数に達したとき",
              en: "When attempts are exhausted",
              body: statement.exhausted,
            },
          ]
        : []),
      {
        key: "timedOut",
        ja: "期限を迎えたとき",
        en: "When the deadline is reached",
        body: statement.timedOut,
      },
    ];
  if (statement.kind === "branch")
    return [
      {
        key: "then",
        ja: "成立したとき",
        en: "When true",
        body: statement.then,
      },
      {
        key: "otherwise",
        ja: "成立しないとき",
        en: "When false",
        body: statement.otherwise,
      },
      {
        key: "unknown",
        ja: "確認できないとき",
        en: "When unknown",
        body: statement.unknown,
      },
    ];
  if (statement.kind === "repeat")
    return [
      {
        key: "body",
        ja: "各項目で行う",
        en: "For each item",
        body: statement.body,
      },
    ];
  if (statement.kind === "parallel")
    return statement.branches.map((branch, index) => ({
      key: `parallel:${index}`,
      ja: branch.name,
      en: branch.name,
      body: branch.body,
    }));
  if (statement.kind === "switch")
    return statement.cases.map((branch, index) => ({
      key: `case:${index}`,
      ja: branch.value,
      en: branch.value,
      body: branch.body,
    }));
  return [];
}
export interface NodeLocation {
  statement: Statement;
  siblings: Statement[];
  index: number;
  parent?: Statement;
  branch: string;
  ancestors: Statement[];
}

export type ConditionClause = Extract<Statement, { kind: "branch" }>;
/** A view over the existing tree. Reading it never rewrites unknown branches or IDs. */
export function conditionChain(first: ConditionClause): ConditionClause[] {
  const clauses = [first];
  let current = first;
  while (
    current.otherwise.length === 1 &&
    current.otherwise[0]?.kind === "branch"
  ) {
    current = current.otherwise[0];
    clauses.push(current);
  }
  return clauses;
}
export function conditionChainRoot(
  definition: FlowDefinition,
  id: string,
): ConditionClause | undefined {
  const found = locate(definition, id);
  if (found?.statement.kind !== "branch") return undefined;
  let root = found.statement;
  for (const ancestor of [...found.ancestors].reverse()) {
    if (
      ancestor.kind !== "branch" ||
      ancestor.otherwise.length !== 1 ||
      ancestor.otherwise[0]?.id !== root.id
    )
      break;
    root = ancestor;
  }
  return root;
}
/** Reordering moves each condition, true body and its own unknown body together. */
export function editConditionChain(
  definition: FlowDefinition,
  rootId: string,
  action:
    | { kind: "add"; clause: ConditionClause }
    | { kind: "move"; index: number; direction: -1 | 1 }
    | { kind: "remove"; index: number },
): FlowDefinition {
  return updateDefinition(definition, (next) => {
    const location = locate(next, rootId);
    if (location?.statement.kind !== "branch") return;
    const clauses = conditionChain(location.statement);
    const finalElse = clauses.at(-1)!.otherwise;
    if (action.kind === "add") clauses.push(action.clause);
    else if (action.kind === "remove") {
      if (clauses.length <= 1 || !clauses[action.index]) return;
      clauses.splice(action.index, 1);
    } else {
      const target = action.index + action.direction;
      if (!clauses[action.index] || !clauses[target]) return;
      [clauses[action.index], clauses[target]] = [
        clauses[target]!,
        clauses[action.index]!,
      ];
    }
    for (let index = clauses.length - 1; index >= 0; index--)
      clauses[index]!.otherwise =
        index === clauses.length - 1 ? finalElse : [clauses[index + 1]!];
    location.siblings[location.index] = clauses[0]!;
  });
}
export function locate(
  definition: FlowDefinition,
  id: string,
): NodeLocation | undefined {
  const visit = (
    list: Statement[],
    parent: Statement | undefined,
    branch: string,
    ancestors: Statement[],
  ): NodeLocation | undefined => {
    for (let index = 0; index < list.length; index++) {
      const statement = list[index]!;
      if (statement.id === id)
        return { statement, siblings: list, index, parent, branch, ancestors };
      for (const nested of branches(statement)) {
        const found = visit(nested.body, statement, nested.key, [
          ...ancestors,
          statement,
        ]);
        if (found) return found;
      }
    }
  };
  return (
    visit(definition.body, undefined, "body", []) ??
    visit(definition.detached ?? [], undefined, "detached", []) ??
    definition.procedures
      ?.map((procedure) =>
        visit(
          procedure.body,
          undefined,
          procedureArea(procedure.id, procedure.revision),
          [],
        ),
      )
      .find(Boolean)
  );
}
export function childList(
  definition: FlowDefinition,
  parentId: string | undefined,
  branch = "body",
): Statement[] | undefined {
  if (!parentId)
    return branch === "detached"
      ? (definition.detached ??= [])
      : branch.startsWith("procedure:")
        ? definition.procedures?.find((procedure) =>
            matchesProcedureArea(branch, procedure),
          )?.body
        : definition.body;
  const parent = locate(definition, parentId)?.statement;
  return parent
    ? branches(parent).find((item) => item.key === branch)?.body
    : undefined;
}
export function updateDefinition(
  definition: FlowDefinition,
  edit: (next: FlowDefinition) => void,
): FlowDefinition {
  const next = structuredClone(definition);
  edit(next);
  return next;
}
export function cloneStatement(statement: Statement): Statement {
  const cloned = structuredClone(statement);
  const nodeIds = new Map<string, string>(),
    variableIds = new Map<string, string>();
  // Branch IDs belong to their own parallel block; equal names in another block are legal.
  const branchIds = new Map<string, Map<string, string>>();
  const usedVariables = new Set<string>();
  const allocate = (
    ids: Map<string, string>,
    source: string,
    namespace: string,
  ) => {
    if (ids.has(source)) throw new Error(`CLONE_DUPLICATE_${namespace}_ID`);
    const next = uid();
    if ([...ids.values()].includes(next))
      throw new Error(`CLONE_DUPLICATE_${namespace}_ID`);
    ids.set(source, next);
    return next;
  };
  const declaration = (value: VariableDeclaration) => {
    const id = allocate(variableIds, value.id, "VARIABLE");
    usedVariables.add(id);
  };
  const collect = (node: Statement) => {
    allocate(nodeIds, node.id, "NODE");
    if (node.kind === "parallel") {
      const ids = new Map<string, string>();
      for (const branch of node.branches) allocate(ids, branch.id, "BRANCH");
      branchIds.set(node.id, ids);
    }
    if (node.kind === "declare") declaration(node.variable);
    if (node.kind === "resultBranch") {
      declaration(node.output);
      if (node.reason) declaration(node.reason);
    }
    if (node.kind === "optionalBranch") declaration(node.output);
    if (node.kind === "searchBranch") {
      declaration(node.index);
      if (node.output) declaration(node.output);
    }
    if (node.kind === "boundedLoop" && node.reason) declaration(node.reason);
    if (node.kind === "action") {
      if (node.output) declaration(node.output);
      if (node.outcome) declaration(node.outcome);
    }
    if (
      node.kind === "random" ||
      node.kind === "readClock" ||
      node.kind === "poll" ||
      node.kind === "awaitEvent"
    )
      declaration(node.output);
    if (node.kind === "repeat") {
      declaration(node.itemVariable);
      if (node.indexVariable) declaration(node.indexVariable);
      for (const result of node.results ?? []) declaration(result.output);
    }
    if (node.kind === "call") Object.values(node.outputs).forEach(declaration);
    for (const branch of branches(node)) branch.body.forEach(collect);
  };
  collect(cloned);

  const input = (
    value: ValueInput,
    bindings: ReadonlyMap<string, string>,
  ): ValueInput => {
    if (value.kind === "literal" || value.kind === "missing") return value;
    if (value.kind === "variable")
      return {
        ...value,
        variableId:
          bindings.get(value.variableId) ??
          variableIds.get(value.variableId) ??
          value.variableId,
      };
    const expression = value.expression;
    const options = expression.options ? { ...expression.options } : undefined;
    if (options?.bindingId) {
      if (bindings.has(options.bindingId))
        throw new Error("CLONE_DUPLICATE_BINDING_ID");
      const fresh = uid();
      if (usedVariables.has(fresh))
        throw new Error("CLONE_DUPLICATE_BINDING_ID");
      usedVariables.add(fresh);
      const bodyBindings = new Map(bindings).set(options.bindingId, fresh);
      options.bindingId = fresh;
      if (options.body) options.body = input(options.body, bodyBindings);
    } else if (options?.body) options.body = input(options.body, bindings);
    // A list binding starts in the expression body, never in its source arguments.
    return {
      ...value,
      expression: {
        ...expression,
        args: expression.args.map((arg) => input(arg, bindings)),
        ...(options ? { options } : {}),
      },
    };
  };
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (
      ["literal", "missing", "variable", "expression"].includes(
        String(object.kind),
      )
    )
      return input(value as ValueInput, new Map());
    if (object.kind === "parallel") {
      const node = object as unknown as Extract<
        Statement,
        { kind: "parallel" }
      >;
      const ids = branchIds.get(node.id)!;
      return {
        ...node,
        id: nodeIds.get(node.id)!,
        branches: node.branches.map((branch) => ({
          ...branch,
          id: ids.get(branch.id)!,
          body: branch.body.map(rewrite),
          ...(branch.outputs ? { outputs: rewrite(branch.outputs) } : {}),
        })),
        ...(node.outputs
          ? {
              outputs: Object.fromEntries(
                Object.entries(node.outputs).map(([id, mapping]) => [
                  variableIds.get(id) ?? id,
                  {
                    ...mapping,
                    branchId: ids.get(mapping.branchId) ?? mapping.branchId,
                  },
                ]),
              ),
            }
          : {}),
      };
    }
    const result = Object.fromEntries(
      Object.entries(object).map(([key, child]) => [key, rewrite(child)]),
    );
    if (typeof object.id === "string") {
      if (typeof object.kind === "string" && nodeIds.has(object.id))
        result.id = nodeIds.get(object.id);
      else if ("type" in object && "name" in object)
        result.id = variableIds.get(object.id) ?? object.id;
    }
    if (object.kind === "assign" && typeof object.variableId === "string")
      result.variableId =
        variableIds.get(object.variableId) ?? object.variableId;
    if (object.kind === "approval" && typeof object.actionId === "string")
      result.actionId = nodeIds.get(object.actionId) ?? object.actionId;
    return result;
  };
  return rewrite(cloned) as Statement;
}
export type MoveDirection =
  "up" | "down" | "inside" | "outside" | "unused" | "restore";
export function moveStatement(
  definition: FlowDefinition,
  id: string,
  direction: MoveDirection,
): FlowDefinition {
  return updateDefinition(definition, (next) => {
    const found = locate(next, id);
    if (!found) return;
    if (direction === "up" || direction === "down") {
      const target = found.index + (direction === "up" ? -1 : 1);
      if (target < 0 || target >= found.siblings.length) return;
      found.siblings.splice(found.index, 1);
      found.siblings.splice(target, 0, found.statement);
      return;
    }
    let destination: Statement[] | undefined, at: number | undefined;
    if (direction === "inside") {
      const previous = found.siblings[found.index - 1];
      destination = previous ? branches(previous)[0]?.body : undefined;
    }
    if (direction === "outside" && found.parent) {
      const parent = locate(next, found.parent.id);
      destination = parent?.siblings;
      at = parent ? parent.index + 1 : undefined;
    }
    if (direction === "unused") destination = next.detached ??= [];
    if (direction === "restore") destination = next.body;
    if (!destination || destination === found.siblings) return;
    found.siblings.splice(found.index, 1);
    destination.splice(at ?? destination.length, 0, found.statement);
  });
}
export function availableVariables(
  definition: FlowDefinition,
  selectedId?: string,
  locale: Locale = "ja",
): VariableDeclaration[] {
  const found = selectedId ? locate(definition, selectedId) : undefined;
  const procedure = definition.procedures?.find(
    (item) =>
      locate(
        { ...definition, body: item.body, detached: [], procedures: [] },
        selectedId ?? "",
      ) !== undefined,
  );
  const result = procedure
    ? [...procedure.inputs]
    : [
        ...runBuiltinDeclarations(locale),
        ...definition.variables,
        ...("inputs" in definition.trigger ? definition.trigger.inputs : []),
      ];
  const append = (node: Statement) => {
    if (node.enabled === false) return;
    if (node.kind === "declare") result.push(node.variable);
    if (node.kind === "readClock" || node.kind === "random")
      result.push(node.output);
    if (node.kind === "action" && node.output) result.push(node.output);
    if (node.kind === "action" && node.outcome) result.push(node.outcome);
    if (node.kind === "call") result.push(...Object.values(node.outputs));
    if (node.kind === "repeat")
      result.push(...(node.results ?? []).map((item) => item.output));
  };
  if (found) {
    let list = procedure?.body ?? definition.body;
    for (const ancestor of found.ancestors) {
      for (const node of list) {
        if (node.id === ancestor.id) break;
        append(node);
      }
      if (ancestor.kind === "repeat") {
        result.push(ancestor.itemVariable);
        if (ancestor.indexVariable) result.push(ancestor.indexVariable);
      }
      const enteredBranch = branches(ancestor).find(
        (branch) =>
          branch.body.some((node) => node.id === selectedId) ||
          branch.body.some((node) =>
            found.ancestors.some((a) => a.id === node.id),
          ),
      );
      if (
        ancestor.kind === "boundedLoop" &&
        enteredBranch?.key.startsWith("handler:") &&
        ancestor.reason
      )
        result.push(ancestor.reason);
      if (ancestor.kind === "searchBranch" && enteredBranch?.key === "found") {
        result.push(ancestor.index);
        if (ancestor.output) result.push(ancestor.output);
      }
      if (
        (ancestor.kind === "poll" &&
          ["matched", "exhausted"].includes(enteredBranch?.key ?? "")) ||
        (ancestor.kind === "awaitEvent" && enteredBranch?.key === "matched")
      )
        result.push(ancestor.output);
      if (ancestor.kind === "resultBranch") {
        if (enteredBranch?.key === "succeeded") result.push(ancestor.output);
        else if (ancestor.reason && enteredBranch) result.push(ancestor.reason);
      }
      if (
        ancestor.kind === "optionalBranch" &&
        enteredBranch?.key === "present"
      )
        result.push(ancestor.output);
      list = enteredBranch?.body ?? [];
    }
    for (const node of found.siblings) {
      if (node.id === selectedId) break;
      append(node);
    }
  } else for (const node of definition.body) append(node);
  return result.filter(
    (value, index, all) =>
      all.findIndex((item) => item.id === value.id) === index,
  );
}

/** Add the required adjacent result consumer as one reversible editor change. */
export function captureActionOutcome(
  definition: FlowDefinition,
  actionId: string,
  locale: Locale,
): FlowDefinition {
  return updateDefinition(definition, (next) => {
    const location = locate(next, actionId);
    const action = location?.statement;
    if (!location || action?.kind !== "action" || action.outcome) return;
    const successType =
      ACTION_DEFINITIONS[action.operation].outputType ?? "Boolean";
    const output = action.output ?? {
      id: uid(),
      name: words(locale, "成功した値", "Successful value"),
      type: successType,
    };
    const outcome: VariableDeclaration = {
      id: uid(),
      name: words(locale, "確認した操作結果", "Verified operation outcome"),
      type: { kind: "OperationOutcome", value: successType },
    };
    delete action.output;
    action.outcome = outcome;
    location.siblings.splice(location.index + 1, 0, {
      id: uid(),
      kind: "resultBranch",
      value: { kind: "variable", type: outcome.type, variableId: outcome.id },
      output,
      reason: {
        id: uid(),
        name: words(locale, "操作の終了理由", "Operation reason"),
        type: "PlainText",
      },
      succeeded: [],
      failed: [],
      notStarted: [],
      unknown: [],
    });
  });
}

/** Only direct locals in the current lexical scope can be assigned after a join. */
export function writableVariables(
  definition: FlowDefinition,
  selectedId: string,
): VariableDeclaration[] {
  const found = locate(definition, selectedId);
  if (!found) return [];
  const procedure = definition.procedures?.find((item) =>
    locate(
      { ...definition, body: item.body, detached: [], procedures: [] },
      selectedId,
    ),
  );
  let list = procedure?.body ?? definition.body;
  let result: VariableDeclaration[] = [];
  for (const ancestor of [...found.ancestors, found.statement]) {
    for (const node of list) {
      if (node.id === ancestor.id) break;
      if (node.kind === "declare" && node.enabled !== false)
        result.push(node.variable);
    }
    if (ancestor.id === selectedId) break;
    if (ancestor.kind === "parallel") result = [];
    list =
      branches(ancestor).find((branch) =>
        branch.body.some(
          (node) =>
            node.id === selectedId ||
            found.ancestors.some((parent) => parent.id === node.id),
        ),
      )?.body ?? [];
  }
  return result;
}

export interface ExpressionCard {
  id: ExpressionOperator;
  ja: string;
  en: string;
  output: ValueType;
  args: ValueType[];
  aliases?: string;
}
export const EXPRESSIONS: ExpressionCard[] = [
  ...(
    [
      "add",
      "subtract",
      "multiply",
      "divide",
      "remainder",
      "min",
      "max",
    ] as const
  ).map((op, index) => ({
    id: `number.${op}` as ExpressionOperator,
    ja: ["足す", "引く", "掛ける", "割る", "余り", "小さい方", "大きい方"][
      index
    ]!,
    en: [
      "Add",
      "Subtract",
      "Multiply",
      "Divide",
      "Remainder",
      "Minimum",
      "Maximum",
    ][index]!,
    output: "Number" as const,
    args: ["Number", "Number"] as ValueType[],
  })),
  ...(["abs", "round", "floor", "ceil"] as const).map((op, index) => ({
    id: `number.${op}` as ExpressionOperator,
    ja: ["絶対値", "四捨五入", "切り下げ", "切り上げ"][index]!,
    en: ["Absolute value", "Round", "Round down", "Round up"][index]!,
    output: "Number" as const,
    args: ["Number"] as ValueType[],
  })),
  {
    id: "number.clamp",
    ja: "範囲に収める",
    en: "Clamp to a range",
    output: "Number",
    args: ["Number", "Number", "Number"],
  },
  ...(
    [
      "equal",
      "notEqual",
      "less",
      "lessOrEqual",
      "greater",
      "greaterOrEqual",
    ] as const
  ).map((op, index) => ({
    id: `compare.${op}` as ExpressionOperator,
    ja: ["等しい", "等しくない", "より小さい", "以下", "より大きい", "以上"][
      index
    ]!,
    en: [
      "Equal",
      "Not equal",
      "Less than",
      "At most",
      "Greater than",
      "At least",
    ][index]!,
    output: "Boolean" as const,
    args: ["Number", "Number"] as ValueType[],
  })),
  {
    id: "text.join",
    ja: "文字をつなぐ",
    en: "Join text",
    output: "PlainText",
    args: ["PlainText", "PlainText"],
  },
  {
    id: "text.length",
    ja: "文字の長さ",
    en: "Text length",
    output: "Number",
    args: ["PlainText"],
  },
  {
    id: "text.contains",
    ja: "文字を含むか",
    en: "Text contains",
    output: "Boolean",
    args: ["PlainText", "PlainText"],
  },
  {
    id: "text.startsWith",
    ja: "先頭を調べる",
    en: "Check a text prefix",
    output: "Boolean",
    args: ["PlainText", "PlainText"],
  },
  {
    id: "text.endsWith",
    ja: "末尾を調べる",
    en: "Check a text suffix",
    output: "Boolean",
    args: ["PlainText", "PlainText"],
  },
  {
    id: "text.trim",
    ja: "前後の空白を整える",
    en: "Trim surrounding spaces",
    output: "PlainText",
    args: ["PlainText"],
  },
  {
    id: "text.repeat",
    ja: "文字を繰り返す",
    en: "Repeat text",
    output: "PlainText",
    args: ["PlainText", "Number"],
  },
  {
    id: "list.build",
    ja: "数値の一覧を作る",
    en: "Build a number list",
    output: { kind: "List", element: "Number" },
    args: ["Number", "Number"],
  },
  ...(["length", "sum"] as const).map((op, index) => ({
    id: `list.${op}` as ExpressionOperator,
    ja: ["一覧の件数", "数値の合計"][index]!,
    en: ["List length", "Sum a list"][index]!,
    output: "Number" as const,
    args: [{ kind: "List", element: "Number" }] as ValueType[],
  })),
  {
    id: "list.range",
    ja: "番号一覧を作る",
    en: "Build an integer range",
    output: { kind: "List", element: "Number" },
    args: ["Number", "Number", "Number"],
  },
  {
    id: "duration.build",
    ja: "時間量を作る",
    en: "Build a duration",
    output: "Duration",
    args: ["Number"],
  },
  {
    id: "date.compose",
    ja: "日付を組み立てる",
    en: "Compose a date",
    output: "DateOnly",
    args: ["Number", "Number", "Number"],
  },
  {
    id: "date.addDays",
    ja: "暦で日付を動かす",
    en: "Move a calendar date",
    output: "DateOnly",
    args: ["DateOnly", "Number"],
  },
];

export interface EditSnapshot {
  definition: FlowDefinition;
  selectedId?: string;
}
export interface HistoryState {
  past: EditSnapshot[];
  present: EditSnapshot;
  future: EditSnapshot[];
  trimmed: boolean;
}
const HISTORY_BYTES = 2 * 1024 * 1024;
export function remember(
  history: HistoryState,
  next: EditSnapshot,
): HistoryState {
  const past = [...history.past, history.present];
  let trimmed = history.trimmed;
  while (past.length > 50 || JSON.stringify(past).length * 2 > HISTORY_BYTES) {
    past.shift();
    trimmed = true;
  }
  return { past, present: next, future: [], trimmed };
}
export function undoEdit(history: HistoryState): HistoryState {
  const previous = history.past.at(-1);
  return previous
    ? {
        ...history,
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    : history;
}
export function redoEdit(history: HistoryState): HistoryState {
  const next = history.future[0];
  return next
    ? {
        ...history,
        past: [...history.past, history.present],
        present: next,
        future: history.future.slice(1),
      }
    : history;
}
