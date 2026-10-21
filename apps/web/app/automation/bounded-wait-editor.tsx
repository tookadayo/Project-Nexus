"use client";

import type {
  FlowDefinition,
  Statement,
  ValueInput,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import { DEFAULT_AUTOMATION_LIMITS } from "../../../../packages/automation/src/types";
import type { EditorTargets } from "./client";
import { words, type Locale } from "./model";
import { ValueSlot } from "./value-slot";

const ticketStates = [
  ["OPEN", "未対応", "Open"],
  ["ACKNOWLEDGED", "確認済み", "Acknowledged"],
  ["IN_PROGRESS", "対応中", "In progress"],
  ["SNOOZED", "保留中", "Snoozed"],
  ["RESOLVED", "解決済み", "Resolved"],
  ["DISMISSED", "対応不要", "Dismissed"],
] as const;

/** Existing bounded, read-only ticket contracts; no executable user code. */
export function BoundedWaitEditor({
  statement,
  onChange,
  definition,
  locale,
  variables,
  targets,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "poll" | "awaitEvent" }>;
  onChange: (statement: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
}) {
  const slot = (
    input: ValueInput,
    label: string,
    key: string,
    update: (value: ValueInput) => void,
    options: {
      integer?: boolean;
      minimum?: number;
      maximum?: number;
      scope?: VariableDeclaration[];
    } = {},
  ) => (
    <ValueSlot
      key={`${statement.id}-${key}`}
      value={input}
      label={label}
      path={`${statement.id}.${key}`}
      locale={locale}
      variables={options.scope ?? variables}
      targets={targets}
      guildId={definition.guildId}
      integer={options.integer}
      minimum={options.minimum}
      maximum={options.maximum}
      onChange={update}
      onValidity={onValidity}
      pureDefinitions={definition.pureDefinitions}
    />
  );
  return (
    <section className="automation-bounded-wait">
      {slot(
        statement.ticket,
        words(locale, "確認する受付", "Ticket to observe"),
        "ticket",
        (ticket) => onChange({ ...statement, ticket }),
      )}
      <p className="automation-hint">
        {words(
          locale,
          "NEXUSの起点や前の処理から得た受付参照を使います。本文は取得しません。現在の閲覧権限を確認できない場合は実行を停止します。",
          "Use a typed NEXUS ticket reference from the start or a previous step. Message bodies are not read. If current read permission cannot be verified, the run stops.",
        )}
      </p>
      {statement.kind === "poll" ? (
        <>
          {slot(
            statement.maxAttempts,
            words(locale, "確認する最大回数", "Maximum read attempts"),
            "maxAttempts",
            (maxAttempts) => onChange({ ...statement, maxAttempts }),
            {
              integer: true,
              minimum: 1,
              maximum: DEFAULT_AUTOMATION_LIMITS.maxListItems,
            },
          )}
          {slot(
            statement.interval,
            words(locale, "次の確認までの間隔", "Interval between reads"),
            "interval",
            (interval) => onChange({ ...statement, interval }),
            { minimum: Number.MIN_VALUE },
          )}
          <p className="automation-hint">
            {words(
              locale,
              `1〜${DEFAULT_AUTOMATION_LIMITS.maxListItems}回、間隔は0秒より長く設定します。対象と回数・間隔・期限は、このブロックの開始時に固定します。`,
              `Choose 1–${DEFAULT_AUTOMATION_LIMITS.maxListItems} attempts and an interval greater than zero. The target, count, interval and deadline are frozen when this block starts.`,
            )}
          </p>
        </>
      ) : (
        <fieldset>
          <legend>
            {words(
              locale,
              "待つ受付の更新状態",
              "Ticket update states to await",
            )}
          </legend>
          <p className="automation-hint">
            {words(
              locale,
              "現在の受付フォームから作られた受付の更新だけを待ちます。待機を開始した後の、同じ受付で一致する状態を1つ以上選びます。無関係な更新や過去の更新では再開しません。",
              "Await updates to tickets from the current intake form only. Select at least one matching state for this same ticket after waiting begins. Unrelated or historical updates do not resume the run.",
            )}
          </p>
          {ticketStates.map(([state, ja, en]) => (
            <label key={state} className="automation-await-state">
              <input
                type="checkbox"
                checked={statement.states.includes(state)}
                onChange={(event) =>
                  onChange({
                    ...statement,
                    states: event.target.checked
                      ? [...statement.states, state]
                      : statement.states.filter((item) => item !== state),
                  })
                }
              />
              {words(locale, ja, en)}
            </label>
          ))}
        </fieldset>
      )}
      {slot(
        statement.until,
        words(locale, "確認を終了する期限（UTC）", "Stop checking at (UTC)"),
        "until",
        (until) => onChange({ ...statement, until }),
      )}
      <p className="automation-hint">
        {words(
          locale,
          "期限は実行開始から7日以内です。固定日時・型の合う変数・日時計算を選べます。空欄や例示は実行値になりません。取消は実行全体を終了します。",
          "The deadline must be within seven days of the run start. Choose a fixed instant, matching variable or date calculation. Blank fields and examples are never execution values. Cancellation ends the entire run.",
        )}
      </p>
      <label>
        {words(locale, "読み取り結果の名前", "Read result name")}
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
      {statement.kind === "poll" &&
        slot(
          statement.condition,
          words(
            locale,
            "読み取り後に確かめる条件",
            "Condition checked after each read",
          ),
          "condition",
          (condition) => onChange({ ...statement, condition }),
          { scope: [...variables, statement.output] },
        )}
      <p className="automation-hint">
        {statement.kind === "poll"
          ? words(
              locale,
              "読み取り結果は状態と版だけの変更できない値です。条件と「条件を満たした」「最大回数に達した」の内側で使えます。初回確認前に期限を迎えることがあるため、期限切れの内側やブロックの後では使えません。読み取り失敗を条件不成立へ変えません。",
              "The read-only result contains only state and version. Use it in the condition, matched branch or attempts-exhausted branch. It is unavailable in the timeout branch or after this block because the deadline may precede the first read. Read failures do not become a false condition.",
            )
          : words(
              locale,
              "一致した受付の状態と版は、変更できない結果として一致時の内側だけで使えます。期限切れの内側やブロックの後では使えません。権限や確認の失敗を期限切れへ変えません。",
              "The matched ticket state and version are read-only and available only inside the matched branch. They are unavailable in the timeout branch or after this block. Authorization or verification failures do not become timeouts.",
            )}
      </p>
    </section>
  );
}
