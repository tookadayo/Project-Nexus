"use client";
import type {
  FlowDefinition,
  Statement,
  ValueType,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import type { EditorTargets } from "./client";
import { locate, missing, sameType, words, type Locale } from "./model";
import { TypeSelect } from "./type-picker";
import { ValueSlot } from "./value-slot";

export function ResultBranchEditor({
  statement,
  onChange,
  definition,
  locale,
  variables,
  targets,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "resultBranch" | "optionalBranch" }>;
  onChange: (statement: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
}) {
  const wrapper: "Optional" | "ParseResult" | "OperationOutcome" =
    statement.kind === "optionalBranch"
      ? "Optional"
      : typeof statement.value.type === "object" &&
          statement.value.type.kind === "OperationOutcome"
        ? "OperationOutcome"
        : "ParseResult";
  const changeType = (type: ValueType, kind = wrapper) =>
    onChange({
      ...statement,
      value: missing({ kind, value: type }),
      output: { ...statement.output, type },
    });
  const parseTypes: ValueType[] = (
    [
      "Number",
      "DateOnly",
      {
        kind: "Enum",
        values: [
          "OPEN",
          "ACKNOWLEDGED",
          "IN_PROGRESS",
          "SNOOZED",
          "RESOLVED",
          "DISMISSED",
        ],
      },
      ...variables.flatMap((item) =>
        typeof item.type === "object" && item.type.kind === "Enum"
          ? [item.type]
          : [],
      ),
    ] as ValueType[]
  ).filter(
    (item, index, all) =>
      all.findIndex((other) => sameType(item, other)) === index,
  );
  return (
    <section className="automation-result-branch">
      {statement.kind === "resultBranch" && (
        <label>
          {words(locale, "結果の種類", "Result source kind")}
          <select
            value={wrapper}
            onChange={(event) =>
              changeType(
                event.target.value === "ParseResult" ? "Number" : "Boolean",
                event.target.value as "ParseResult" | "OperationOutcome",
              )
            }
          >
            <option value="ParseResult">
              {words(locale, "文字を読み取った結果", "Result of parsing text")}
            </option>
            <option value="OperationOutcome">
              {words(
                locale,
                "登録された操作の結果",
                "Result of a registered operation",
              )}
            </option>
          </select>
        </label>
      )}
      <TypeSelect
        value={statement.output.type}
        onChange={(type) => changeType(type)}
        locale={locale}
        label={words(
          locale,
          "成功・存在するときの値の種類",
          "Type of the successful or present value",
        )}
        allowed={wrapper === "ParseResult" ? parseTypes : undefined}
      />
      <ValueSlot
        value={statement.value}
        onChange={(value) => onChange({ ...statement, value })}
        label={words(
          locale,
          statement.kind === "optionalBranch"
            ? "有無を確認する値"
            : "分岐する型付き結果",
          statement.kind === "optionalBranch"
            ? "Optional value to inspect"
            : "Typed result to inspect",
        )}
        path={`${statement.id}.value`}
        locale={locale}
        variables={variables}
        targets={targets}
        guildId={definition.guildId}
        pureDefinitions={definition.pureDefinitions}
        onValidity={onValidity}
      />
      <label>
        {words(
          locale,
          "成功・存在する値の名前",
          "Successful or present value name",
        )}
        <input
          value={statement.output.name}
          maxLength={80}
          onChange={(event) =>
            onChange({
              ...statement,
              output: { ...statement.output, name: event.target.value },
            })
          }
        />
      </label>
      {statement.kind === "resultBranch" && statement.reason && (
        <label>
          {words(locale, "安全な理由コードの名前", "Safe reason code name")}
          <input
            value={statement.reason.name}
            maxLength={80}
            onChange={(event) =>
              onChange({
                ...statement,
                reason: { ...statement.reason!, name: event.target.value },
              })
            }
          />
        </label>
      )}
      <p className="automation-hint">
        {statement.kind === "optionalBranch"
          ? words(
              locale,
              "値がある経路だけで中の値を使います。0・いいえ・空文字・空の一覧は、値がない状態とは区別します。結果は変更できず、このブロックの後には公開しません。",
              "Only the present branch can use the contained value. Zero, false, empty text and an empty list are distinct from no value. The result is read-only and is not published after this block.",
            )
          : words(
              locale,
              "成功した値は確認済み成功の内側だけで使えます。他の枝は安全な理由コードだけを使います。普通の記録や文字ラベルから成功・承認・結果不明を偽造できません。",
              "Only the confirmed-success branch receives the successful value. Other branches receive only a safe reason code. Ordinary records and text labels cannot fabricate success, approval or unknown outcomes.",
            )}
      </p>
      {wrapper === "OperationOutcome" && (
        <p className="automation-notice">
          {words(
            locale,
            "結果不明の枝では純粋な値処理だけを許可し、終了後も実行全体は結果不明のまま停止します。再送・外部読取り・新しい外部変更・待機・共通手順の呼出しはできません。操作の直後に、同じ操作結果を直接受けるこの分岐を置きます。",
            "An unknown branch permits only pure value handling and leaves the run stopped with an unknown outcome. It cannot resend, read external state, make a new external change, wait or call a procedure. Place this branch directly after the action that supplied the same outcome.",
          )}
        </p>
      )}
    </section>
  );
}

export function ApprovalBlockEditor({
  statement,
  onChange,
  definition,
  locale,
  variables,
  targets,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "approval" }>;
  onChange: (statement: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
}) {
  const location = locate(definition, statement.id);
  const choices = (location?.siblings.slice(location.index + 1) ?? []).filter(
    (item): item is Extract<Statement, { kind: "action" }> =>
      item.kind === "action" &&
      item.enabled !== false &&
      ["discord.addRole", "discord.removeRole"].includes(item.operation),
  );
  return (
    <section className="automation-approval-block">
      <label>
        {words(
          locale,
          "正式な承認が必要な後続のロール操作",
          "Later role action requiring formal approval",
        )}
        <select
          value={statement.actionId}
          onChange={(event) =>
            onChange({ ...statement, actionId: event.target.value })
          }
        >
          <option value="">
            {words(
              locale,
              "後続の通常ロール操作を選択",
              "Choose a later ordinary role action",
            )}
          </option>
          {choices.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index + 1}.{" "}
              {words(
                locale,
                item.operation === "discord.addRole"
                  ? "許可したロールを付ける"
                  : "許可したロールを外す",
                item.operation === "discord.addRole"
                  ? "Add an approved role"
                  : "Remove an approved role",
              )}
            </option>
          ))}
        </select>
      </label>
      <ValueSlot
        value={statement.until}
        onChange={(until) => onChange({ ...statement, until })}
        label={words(
          locale,
          "承認を待つ期限（UTC）",
          "Approval deadline (UTC)",
        )}
        path={`${statement.id}.until`}
        locale={locale}
        variables={variables}
        targets={targets}
        guildId={definition.guildId}
        pureDefinitions={definition.pureDefinitions}
        onValidity={onValidity}
      />
      <p className="automation-hint">
        {words(
          locale,
          "同じ手順列で後にある通常ロール操作だけを選びます。対象の入力は待機開始時に固定し、実際の担当者の適格性・現在の権限・ロールの安全性を正式な承認で確認します。通常の真偽値では承認できません。拒否・期限切れの枝はその後に対象操作へ進みません。",
          "Choose an ordinary role action later in this same step list. Its inputs are frozen when waiting begins. Formal approval verifies the real approver, current authority and role policy. A Boolean cannot grant approval. Rejected and expired branches never continue to the target action.",
        )}
      </p>
    </section>
  );
}
