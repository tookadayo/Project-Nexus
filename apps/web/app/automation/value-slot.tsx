"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
  ExpressionOperator,
  JsonValue,
  ValueInput,
  VariableDeclaration,
  PureDefinition,
  ValueType,
} from "../../../../packages/automation/src/types";
import type { EditorTargets } from "./client";
import { MessageBuilder } from "./message-builder";
import { TemporalValueInput } from "./temporal-value-input";
import {
  DateOnlyControl,
  LocalTimeControl,
  UserInstantControl,
} from "./date-controls";
import {
  isInstantRangeV2Type,
  isLocalTimeType,
  localTimePrecision,
} from "../../../../packages/automation/src/temporal-types";
import { FixedLookupEditor } from "./fixed-lookup-editor";
import { temporalChoiceLabel } from "../../../../packages/automation/src/temporal-values";
import { missing, sameType, typeName, words, type Locale, uid } from "./model";
import {
  expressionCardsFor,
  instantiateExpressionCard,
  expressionBodyBindings,
  supportsFixedMappingKeyEditor,
} from "../../../../packages/automation/src/expression-cards";
import { registeredRecordSchema } from "../../../../packages/automation/src/expression";
import { assertUnicodeScalarText } from "../../../../packages/automation/src/scratch-unicode";

const isStateValue = (type: ValueType): boolean =>
  type === "ConditionResult" ||
  (typeof type === "object" &&
    (["Optional", "ParseResult", "OperationOutcome"].includes(type.kind) ||
      (type.kind === "List" && isStateValue(type.element))));

interface SlotProps {
  value: ValueInput;
  onChange: (value: ValueInput) => void;
  locale: Locale;
  label: string;
  path: string;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  guildId: string;
  integer?: boolean;
  minimum?: number;
  maximum?: number;
  pureDefinitions?: PureDefinition[];
  simulation?: boolean;
  depth?: number;
  modes?: ("literal" | "variable" | "expression")[];
  onValidity: (path: string, message: string | null) => void;
}
export const AutomationSemanticProfile = createContext<
  "scratch.v1" | undefined
>(undefined);
const displayLiteral = (value: ValueInput): string =>
  value.kind === "literal" &&
  (typeof value.value === "string" || typeof value.value === "number")
    ? String(value.value)
    : "";
export function ValueSlot(props: SlotProps) {
  const semanticProfile = useContext(AutomationSemanticProfile);
  const {
    value,
    onChange,
    locale,
    label,
    path,
    variables,
    targets,
    guildId,
    integer = false,
    depth = 0,
    onValidity,
  } = props;
  const [raw, setRaw] = useState(displayLiteral(value)),
    [unit, setUnit] = useState(1),
    [error, setError] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const [inputReset, setInputReset] = useState(0);
  const last = useRef(JSON.stringify(value));
  const focusValue = useRef<ValueInput | undefined>(undefined);
  const unicodeMessage = words(
    locale,
    "文字に不正なサロゲートがあります。文字を入力し直してください。置換文字へ自動では変更しません。",
    "Text contains an unpaired surrogate. Re-enter the text. It is not automatically changed to a replacement character.",
  );
  const stateMessage = words(
    locale,
    "状態を持つ値は汎用比較できません。値あり/なし・条件の不明・読み取りや操作の結果を、それぞれの型付き分岐で確認してください。",
    "State-bearing values cannot use generic comparisons. Use the matching typed branch for optional presence, unknown conditions, or parsed and operation results.",
  );
  const joinMessage = words(
    locale,
    "文字をつなぐ欄にはPlainTextが必要です。文章を明示入力するか、PlainTextを返す登録済みの値ブロックを選び直してください。数値や参照を自動で文字に変換しません。",
    "Joining text requires PlainText. Enter the text explicitly or choose a registered value block returning PlainText. Numbers and references are not automatically converted to text.",
  );
  useEffect(() => () => onValidity(path, null), [onValidity, path]);
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized !== last.current) {
      last.current = serialized;
      setRaw(displayLiteral(value));
      setError(null);
      setUnit(1);
      onValidity(path, null);
    }
    let message: string | null = null;
    if (
      semanticProfile === "scratch.v1" &&
      value.kind === "literal" &&
      value.type === "PlainText" &&
      typeof value.value === "string"
    ) {
      try {
        assertUnicodeScalarText(value.value);
      } catch {
        message = unicodeMessage;
      }
    }
    if (semanticProfile === "scratch.v1" && value.kind === "expression") {
      if (
        value.expression.operator.startsWith("compare.") &&
        value.expression.args.some((arg) => isStateValue(arg.type))
      )
        message = stateMessage;
      if (
        value.expression.operator === "text.join" &&
        value.expression.args.some((arg) => arg.type !== "PlainText")
      )
        message = joinMessage;
    }
    if (message) {
      setError(message);
      onValidity(path, message);
    } else if (
      error === unicodeMessage ||
      error === stateMessage ||
      error === joinMessage
    ) {
      setError(null);
      onValidity(path, null);
    }
  }, [
    value,
    path,
    onValidity,
    semanticProfile,
    unicodeMessage,
    stateMessage,
    joinMessage,
    error,
  ]);
  const change = (next: ValueInput) => {
    last.current = JSON.stringify(next);
    onChange(next);
  };
  const fail = (message: string | null) => {
    setError(message);
    onValidity(path, message);
  };
  const mode =
    value.kind === "missing"
      ? "literal"
      : value.kind === "expression" && value.expression.operator === "pure.call"
        ? "custom"
        : value.kind;
  const compatible = variables.filter((item) =>
    sameType(item.type, value.type),
  );
  const matchingExpressions = expressionCardsFor(value.type, {
    variables,
    pureDefinitions: props.pureDefinitions,
    semanticProfile,
  });
  const expressionCards = matchingExpressions.filter((item) =>
    `${item.label.ja} ${item.label.en} ${item.operator} ${item.operator.includes("modulo") || item.operator.includes("remainder") ? "mod 余り" : ""} ${item.operator.includes("sqrt") ? "sqrt 平方根" : ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const labelId = `slot-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const selectedCard =
    value.kind === "expression"
      ? matchingExpressions.find(
          (card) =>
            card.operator === value.expression.operator &&
            card.inputs.every(
              (input, index) =>
                value.expression.args[index] &&
                sameType(input.type, value.expression.args[index]!.type),
            ) &&
            Object.entries(card.options ?? {}).every(
              ([key, option]) =>
                JSON.stringify(
                  value.expression.options?.[
                    key as keyof typeof value.expression.options
                  ],
                ) === JSON.stringify(option),
            ),
        )
      : undefined;
  const fixedMappingReadOnly =
    value.kind === "expression" &&
    value.expression.operator === "value.lookup" &&
    !supportsFixedMappingKeyEditor(
      value.expression.args[0]?.type ?? "PlainText",
    );
  const commitText = (text: string) => {
    setRaw(text);
    let message: string | null = null;
    if (semanticProfile === "scratch.v1" && value.type === "PlainText") {
      try {
        assertUnicodeScalarText(text);
      } catch {
        message = unicodeMessage;
      }
    }
    fail(message);
    change(
      text === ""
        ? missing(value.type)
        : { kind: "literal", type: value.type, value: text },
    );
  };
  const numberChange = (text: string, factor = unit) => {
    setRaw(text);
    const pattern = integer
      ? props.minimum !== undefined && props.minimum < 0
        ? /^-?(0|[1-9][0-9]*)$/
        : /^(0|[1-9][0-9]*)$/
      : /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
    if (text === "") {
      fail(null);
      change(missing(value.type));
      return;
    }
    const parsed = Number(text),
      valid =
        pattern.test(text) &&
        Number.isFinite(parsed) &&
        (props.minimum === undefined || parsed >= props.minimum) &&
        (props.maximum === undefined || parsed <= props.maximum) &&
        (!integer || Number.isSafeInteger(parsed));
    if (!valid) {
      fail(
        words(
          locale,
          integer
            ? "表示された範囲の半角整数を入力してください。例示は入力値ではありません。"
            : "有限の半角数値を入力してください。",
          "Enter " +
            (integer
              ? "a whole number within the displayed range."
              : "a finite decimal number."),
        ),
      );
      change(missing(value.type));
      return;
    }
    if (value.type === "Duration" && (parsed < 0 || parsed * factor > 604800)) {
      fail(
        words(
          locale,
          "待機は0秒以上、7日以内です。",
          "Waits must be between zero seconds and seven days.",
        ),
      );
      change(missing(value.type));
      return;
    }
    fail(null);
    change({
      kind: "literal",
      type: value.type,
      value: parsed * (value.type === "Duration" ? factor : 1),
    });
  };
  const renderFixed = () => {
    if (
      isInstantRangeV2Type(value.type) ||
      [
        "ZonedDateTimeSpec",
        "DateRange",
        "InstantRange",
        "LocalTimeWindowSpec",
      ].includes(String(value.type))
    )
      return (
        <TemporalValueInput
          key={inputReset}
          value={value}
          onChange={change}
          locale={locale}
          label={label}
          onValidity={fail}
        />
      );
    if (
      value.type === "LegacyMessageSpec" ||
      value.type === "EmbedSpec" ||
      value.type === "RichTextSpec"
    )
      return (
        <MessageBuilder
          value={value}
          onChange={change}
          locale={locale}
          onValidity={fail}
        />
      );
    if (isLocalTimeType(value.type))
      return (
        <LocalTimeControl
          key={inputReset}
          id={labelId}
          value={raw}
          onChange={commitText}
          precision={localTimePrecision(value.type)!}
          locale={locale}
          label={label}
          onValidity={(valid) =>
            fail(
              valid
                ? null
                : words(
                    locale,
                    "時刻の形式と精度を確認してください。",
                    "Review the time format and precision.",
                  ),
            )
          }
        />
      );
    if (typeof value.type === "object") {
      if (value.type.kind === "Enum")
        return (
          <select
            id={labelId}
            aria-label={label}
            value={value.kind === "literal" ? String(value.value) : ""}
            onChange={(event) => commitText(event.target.value)}
          >
            <option value="">
              {words(locale, "選択してください", "Choose a value")}
            </option>
            {value.type.values.map((item) => (
              <option key={item} value={item}>
                {temporalChoiceLabel(value.type, item, locale)}
              </option>
            ))}
          </select>
        );
      if (value.type.kind === "List")
        return <FixedListInput {...props} onChange={change} />;
      if (value.type.kind === "Optional")
        return <OptionalLiteralInput {...props} onChange={change} />;
      if (
        value.type.kind === "ParseResult" ||
        value.type.kind === "OperationOutcome"
      )
        return (
          <p className="automation-hint">
            {words(
              locale,
              "この結果は文字の読み取りか登録操作から受け取ります。状態ラベルや成功した値を固定入力で作ることはできません。",
              "Receive this result from a text parser or a registered operation. A fixed status label or successful value cannot fabricate it.",
            )}
          </p>
        );
      if (value.type.kind === "Record" && props.simulation)
        return <MockRecordInput {...props} onChange={change} />;
      return (
        <p className="automation-hint">
          {words(
            locale,
            "この型は、型の合う変数または値ブロックから選びます。",
            "Choose a matching variable or value block for this type.",
          )}
        </p>
      );
    }
    if (value.type === "Number" || value.type === "Duration")
      return (
        <div className="automation-number">
          <input
            id={labelId}
            aria-label={label}
            type="text"
            inputMode={integer ? "numeric" : "decimal"}
            value={raw}
            placeholder={words(
              locale,
              "例: 3（未入力）",
              "e.g. 3 (not entered)",
            )}
            aria-invalid={Boolean(error)}
            aria-describedby={`${labelId}-hint`}
            onChange={(event) => numberChange(event.target.value)}
          />
          {value.type === "Duration" && (
            <select
              aria-label={words(locale, "時間の単位", "Duration unit")}
              value={unit}
              onChange={(event) => {
                const factor = Number(event.target.value);
                setUnit(factor);
                numberChange(raw, factor);
              }}
            >
              <option value={1}>{words(locale, "秒", "seconds")}</option>
              <option value={60}>{words(locale, "分", "minutes")}</option>
              <option value={3600}>{words(locale, "時間", "hours")}</option>
              <option value={86400}>
                {words(locale, "経過日（24時間）", "elapsed days (24 hours)")}
              </option>
            </select>
          )}
          <small id={`${labelId}-hint`}>
            {value.type === "Duration"
              ? words(
                  locale,
                  "固定入力は秒へ一度だけ変換します。最大7日。",
                  "Fixed values convert to seconds once. Maximum seven days.",
                )
              : words(
                  locale,
                  integer
                    ? props.minimum !== undefined || props.maximum !== undefined
                      ? `範囲: ${props.minimum ?? 0}〜${props.maximum ?? "上限まで"} の整数。空欄は未設定です。`
                      : "0以上の整数。空欄は未設定です。"
                    : "有限数値。暗黙の型変換はしません。",
                  integer
                    ? props.minimum !== undefined || props.maximum !== undefined
                      ? `Whole-number range: ${props.minimum ?? 0}–${props.maximum ?? "the upper limit"}. Blank means unset.`
                      : "Non-negative whole number. Blank means unset."
                    : "Finite number. No implicit conversion.",
                )}
          </small>
        </div>
      );
    if (value.type === "Boolean" || value.type === "ConditionResult")
      return (
        <select
          id={labelId}
          aria-label={label}
          value={value.kind === "literal" ? String(value.value) : ""}
          onChange={(event) => {
            const chosen = event.target.value;
            change(
              chosen === ""
                ? missing(value.type)
                : {
                    kind: "literal",
                    type: value.type,
                    value:
                      value.type === "Boolean" ? chosen === "true" : chosen,
                  },
            );
            fail(null);
          }}
        >
          <option value="">{words(locale, "未設定", "Not set")}</option>
          <option value="true">
            {words(locale, "はい・成立", "Yes / true")}
          </option>
          <option value="false">
            {words(locale, "いいえ・不成立", "No / false")}
          </option>
          {value.type === "ConditionResult" && (
            <option value="unknown">
              {words(locale, "確認できない", "Unknown")}
            </option>
          )}
        </select>
      );
    if (value.type === "DateOnly")
      return (
        <DateOnlyControl
          key={inputReset}
          id={labelId}
          value={raw}
          onChange={commitText}
          locale={locale}
          label={label}
          onValidity={(valid) =>
            fail(
              valid
                ? null
                : words(
                    locale,
                    "ISO形式の存在する日付を入力してください。",
                    "Enter an existing ISO calendar date.",
                  ),
            )
          }
        />
      );
    if (value.type === "Instant")
      return (
        <UserInstantControl
          key={inputReset}
          id={labelId}
          value={raw}
          onChange={(text) => {
            setRaw(text ?? "");
            change(
              text
                ? { kind: "literal", type: "Instant", value: text }
                : missing("Instant"),
            );
          }}
          locale={locale}
          label={label}
          onValidity={(valid) =>
            fail(
              valid
                ? null
                : words(
                    locale,
                    "UTC日時を秒までで入力してください。既存の小数秒は明示置換まで保持します。",
                    "Enter a UTC date/time with at most second precision. Saved fractional seconds remain until explicitly replaced.",
                  ),
            )
          }
        />
      );
    if (value.type === "ChannelRef" || value.type === "RoleRef") {
      const choices =
        value.type === "ChannelRef" ? targets.channels : targets.roles;
      const current =
        value.kind === "literal" &&
        value.value &&
        typeof value.value === "object" &&
        !Array.isArray(value.value)
          ? String(value.value.id)
          : "";
      return (
        <div>
          <select
            id={labelId}
            aria-label={label}
            disabled={!targets.available}
            value={current}
            onChange={(event) => {
              const choice = choices.find(
                (item) => item.id === event.target.value,
              );
              change(
                choice
                  ? {
                      kind: "literal",
                      type: value.type,
                      value: { id: choice.id, guildId },
                    }
                  : missing(value.type),
              );
            }}
          >
            <option value="">
              {targets.available
                ? words(locale, "名前で対象を選択", "Choose a target by name")
                : words(
                    locale,
                    "対象を取得できません",
                    "Targets are unavailable",
                  )}
            </option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
                {choice.type ? ` · ${choice.type}` : ""}
              </option>
            ))}
          </select>
          {targets.available && choices.length === 0 && (
            <small>
              {words(
                locale,
                "条件に合う項目はありません。",
                "No matching items were found.",
              )}
            </small>
          )}
          <small>
            {words(
              locale,
              "実行直前にも対象と現在の権限を確認します。",
              "The target and current permissions are checked again before execution.",
            )}
          </small>
        </div>
      );
    }
    if (value.type.endsWith("Ref"))
      return (
        <p className="automation-hint">
          {words(
            locale,
            "この参照は、起点や前の処理から得た型付きの値を選んでください。IDの直接入力は使いません。",
            "Choose a typed reference from the start or a previous step. Raw IDs are not accepted.",
          )}
        </p>
      );
    if (value.type === "TimeZone")
      return (
        <input
          id={labelId}
          aria-label={label}
          value={raw}
          placeholder="Asia/Tokyo"
          onChange={(event) => {
            const text = event.target.value;
            commitText(text);
            if (text) {
              try {
                new Intl.DateTimeFormat("en", { timeZone: text });
                fail(null);
              } catch {
                fail(
                  words(
                    locale,
                    "IANA地域名を入力してください。",
                    "Enter an IANA time-zone name.",
                  ),
                );
              }
            }
          }}
        />
      );
    return (
      <div>
        <textarea
          id={labelId}
          aria-label={label}
          rows={3}
          value={raw}
          placeholder={words(
            locale,
            "案内文を入力（例示は保存されません）",
            "Enter your text (examples are not saved)",
          )}
          onChange={(event) => commitText(event.target.value)}
        />
        {value.type === "PlainText" && (
          <button
            type="button"
            onClick={() => {
              setRaw("");
              fail(null);
              change({ kind: "literal", type: "PlainText", value: "" });
            }}
          >
            {words(locale, "空文字を明示して使う", "Explicitly use empty text")}
          </button>
        )}
        {value.type === "PlainText" && (
          <small>
            {words(
              locale,
              "通常文字は装飾をエスケープ。メンション通知は既定で無効です。",
              "Plain text escapes formatting. Mention notifications are off by default.",
            )}
          </small>
        )}
      </div>
    );
  };
  return (
    <fieldset
      className={`automation-slot ${value.type === "Boolean" || value.type === "ConditionResult" ? "is-condition" : "is-value"}`}
      aria-describedby={error ? `${labelId}-error` : undefined}
      data-value-type={typeName(value.type, locale)}
      data-value-source={mode}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          focusValue.current = structuredClone(value);
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          !focusValue.current ||
          (event.target as HTMLElement).closest(".automation-slot") !==
            event.currentTarget
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const previous = structuredClone(focusValue.current);
        change(previous);
        setRaw(displayLiteral(previous));
        setSearch("");
        setInputReset((version) => version + 1);
        fail(null);
        event.currentTarget
          .querySelector<HTMLButtonElement>(".automation-slot-mode button")
          ?.focus();
      }}
    >
      <legend>
        <span
          className={`automation-socket-symbol ${value.type === "Boolean" || value.type === "ConditionResult" ? "is-condition" : "is-value"}`}
          aria-hidden="true"
        />
        <span>{label}</span>{" "}
        <small>
          {typeName(value.type, locale)}
          {value.type === "ConditionResult"
            ? words(
                locale,
                " · 不明を含む条件",
                " · condition including unknown",
              )
            : ""}
        </small>
      </legend>
      <p className="automation-slot-hint">
        {words(
          locale,
          `必要な型: ${typeName(value.type, locale)}。型と使用範囲が合う値だけを挿入します。`,
          `Expected type: ${typeName(value.type, locale)}. Insert a value with a matching type and scope.`,
        )}
      </p>
      <div
        className="automation-slot-mode"
        role="group"
        aria-label={words(locale, "値の入力方法", "Value source")}
      >
        {(
          props.modes ??
          (["literal", "variable", "expression", "custom"] as const)
        ).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={mode === choice}
            title={
              choice === "custom" &&
              !matchingExpressions.some((card) => card.operator === "pure.call")
                ? words(
                    locale,
                    "この型を返す純粋な自作値を先に定義してください。",
                    "First define a pure custom value returning this type.",
                  )
                : undefined
            }
            disabled={
              (choice === "expression" || choice === "custom") &&
              (depth >= 7 ||
                !matchingExpressions.some(
                  (card) =>
                    (card.operator === "pure.call") === (choice === "custom"),
                ))
            }
            onClick={() => {
              if (mode === choice) return;
              fail(null);
              setRaw("");
              setUnit(1);
              change(
                choice === "literal"
                  ? missing(value.type)
                  : choice === "variable"
                    ? { kind: "variable", type: value.type, variableId: "" }
                    : matchingExpressions.find(
                          (card) =>
                            (card.operator === "pure.call") ===
                            (choice === "custom"),
                        )
                      ? instantiateExpressionCard(
                          matchingExpressions.find(
                            (card) =>
                              (card.operator === "pure.call") ===
                              (choice === "custom"),
                          )!,
                          uid,
                        )
                      : missing(value.type),
              );
            }}
          >
            {words(
              locale,
              ...({
                literal: ["固定値", "Fixed value"],
                variable: ["変数", "Variable"],
                expression: ["計算ブロック", "Calculation"],
                custom: ["自作の値", "Custom value"],
              }[choice] as [string, string]),
            )}
          </button>
        ))}
      </div>
      {mode === "literal" ? (
        renderFixed()
      ) : mode === "variable" ? (
        <div>
          <select
            id={labelId}
            aria-label={label}
            value={value.kind === "variable" ? value.variableId : ""}
            onChange={(event) =>
              change({
                kind: "variable",
                type: value.type,
                variableId: event.target.value,
              })
            }
          >
            <option value="">
              {words(
                locale,
                "型と範囲の合う変数を選択",
                "Choose a matching variable",
              )}
            </option>
            {compatible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {typeName(item.type, locale)}
              </option>
            ))}
          </select>
          {compatible.length === 0 && (
            <small>
              {words(
                locale,
                "この位置で使える同型の変数はありません。前の手順で作成してください。",
                "No matching variable is available here. Create one in an earlier step.",
              )}
            </small>
          )}
        </div>
      ) : (
        <div className="automation-expression">
          <label>
            {words(locale, "値ブロックを探す", "Find a value block")}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            id={labelId}
            aria-label={label}
            disabled={fixedMappingReadOnly}
            value={selectedCard?.id ?? ""}
            onChange={(event) => {
              const card = matchingExpressions.find(
                (item) => item.id === event.target.value,
              );
              if (card) change(instantiateExpressionCard(card, uid));
            }}
          >
            {value.kind === "expression" &&
              !selectedCard &&
              !fixedMappingReadOnly && (
                <option value="" disabled>
                  {words(
                    locale,
                    "保存した値ブロックの型を確認し、登録済みの形を選び直してください",
                    "Review the saved value block type and choose a registered form",
                  )}
                </option>
              )}
            {fixedMappingReadOnly && (
              <option value="">
                {words(
                  locale,
                  "保存済み対応表（キーを変更せず保持）",
                  "Saved mapping (keys preserved unchanged)",
                )}
              </option>
            )}
            {expressionCards.length === 0 && (
              <option value="">
                {words(
                  locale,
                  "対応する計算がありません",
                  "No matching calculation",
                )}
              </option>
            )}
            {expressionCards
              .filter(
                (card) =>
                  (card.operator === "pure.call") === (mode === "custom"),
              )
              .map((card) => (
                <option key={card.id} value={card.id}>
                  {card.label[locale]}
                  {card.inputs[0]
                    ? ` · ${typeName(card.inputs[0].type, locale)}`
                    : ""}
                </option>
              ))}
          </select>
          {value.kind === "expression" &&
            ["number.round", "number.floor", "number.ceil"].includes(
              value.expression.operator,
            ) && (
              <label>
                {words(locale, "丸める桁", "Rounding precision")}
                <select
                  value={value.expression.options?.digits ?? 0}
                  onChange={(event) =>
                    change({
                      ...value,
                      expression: {
                        ...value.expression,
                        options: {
                          ...value.expression.options,
                          digits: Number(event.target.value),
                        },
                      },
                    })
                  }
                >
                  {Array.from({ length: 17 }, (_, index) => index - 8).map(
                    (digits) => (
                      <option key={digits} value={digits}>
                        {digits === 0
                          ? words(locale, "整数", "Whole number")
                          : digits > 0
                            ? words(
                                locale,
                                `小数第${digits}位`,
                                `${digits} decimal places`,
                              )
                            : words(
                                locale,
                                `${10 ** -digits}の位`,
                                `Nearest ${10 ** -digits}`,
                              )}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
          {value.kind === "expression" &&
            value.expression.operator === "duration.build" && (
              <label>
                {words(locale, "時間の単位", "Duration unit")}
                <select
                  value={value.expression.options?.unit ?? "seconds"}
                  onChange={(event) =>
                    change({
                      ...value,
                      expression: {
                        ...value.expression,
                        options: {
                          ...value.expression.options,
                          unit: event.target.value as
                            "seconds" | "minutes" | "hours" | "days",
                        },
                      },
                    })
                  }
                >
                  <option value="seconds">
                    {words(locale, "秒", "Seconds")}
                  </option>
                  <option value="minutes">
                    {words(locale, "分", "Minutes")}
                  </option>
                  <option value="hours">
                    {words(locale, "時間", "Hours")}
                  </option>
                  <option value="days">
                    {words(
                      locale,
                      "経過日（24時間）",
                      "Elapsed days (24 hours)",
                    )}
                  </option>
                </select>
              </label>
            )}
          {value.kind === "expression" &&
            value.expression.operator === "value.lookup" && (
              <FixedLookupEditor {...props} value={value} onChange={change} />
            )}
          {value.kind === "expression" &&
            value.expression.operator !== "value.lookup" &&
            value.expression.args.map((arg, index) => (
              <ValueSlot
                {...props}
                key={`${value.expression.operator}-${index}`}
                value={arg}
                label={
                  selectedCard?.inputs[index]?.label[locale] ??
                  words(locale, `入力 ${index + 1}`, `Input ${index + 1}`)
                }
                integer={selectedCard?.inputs[index]?.integer ?? false}
                minimum={selectedCard?.inputs[index]?.minimum}
                maximum={selectedCard?.inputs[index]?.maximum}
                path={`${path}.arg${index}`}
                depth={depth + 1}
                onChange={(next) =>
                  change({
                    ...value,
                    expression: {
                      ...value.expression,
                      args: value.expression.args.map((item, i) =>
                        i === index ? next : item,
                      ),
                    },
                  })
                }
              />
            ))}
          {value.kind === "expression" && value.expression.options?.body && (
            <ValueSlot
              {...props}
              value={value.expression.options.body}
              variables={[...variables, ...expressionBodyBindings(value)]}
              label={
                selectedCard?.binding?.label[locale] ??
                words(locale, "各項目の計算", "Calculation for each item")
              }
              path={`${path}.body`}
              depth={depth + 1}
              integer={false}
              minimum={undefined}
              maximum={undefined}
              onChange={(body) =>
                change({
                  ...value,
                  expression: {
                    ...value.expression,
                    options: { ...value.expression.options, body },
                  },
                })
              }
            />
          )}
          {value.kind === "expression" && selectedCard?.variadic && (
            <>
              <button
                type="button"
                disabled={
                  value.expression.args.length >= selectedCard.variadic.maximum
                }
                onClick={() =>
                  change({
                    ...value,
                    expression: {
                      ...value.expression,
                      args: [
                        ...value.expression.args,
                        missing(selectedCard.variadic!.type),
                      ],
                    },
                  })
                }
              >
                {words(locale, "項目を追加", "Add item")}
              </button>
              <button
                type="button"
                disabled={
                  value.expression.args.length <= selectedCard.variadic.minimum
                }
                onClick={() =>
                  change({
                    ...value,
                    expression: {
                      ...value.expression,
                      args: value.expression.args.slice(0, -1),
                    },
                  })
                }
              >
                {words(locale, "最後の入力を削除", "Remove last input")}
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p
          id={`${labelId}-error`}
          className="automation-field-error"
          role="alert"
        >
          {error}
        </p>
      )}
      {value.kind === "missing" && !error && (
        <small className="automation-unset">
          {words(
            locale,
            "未設定 · 下書き保存は可能。有効化はできません。",
            "Not set · You can save a draft. Enabling is blocked.",
          )}
        </small>
      )}
      {(value.kind === "variable" || value.kind === "expression") && (
        <small className="automation-runtime-value">
          {words(
            locale,
            "実行時に決まります。試運転の値はこの欄の固定値に保存しません。",
            "Determined at run time. Simulation values are not saved here as fixed values.",
          )}
        </small>
      )}
      {semanticProfile === "scratch.v1" && value.type === "PlainText" && (
        <p className="automation-typed-text-guidance">{joinMessage}</p>
      )}
      {semanticProfile === "scratch.v1" &&
        (isStateValue(value.type) || value.type === "Boolean") && (
          <p className="automation-state-comparison-guidance">
            {words(
              locale,
              "Optionalは「値があるときとないときで分ける」、ConditionResultは「条件で分ける」の成立・不成立・不明、ParseResultとOperationOutcomeは「読み取り・操作の結果で分ける」を使います。これらの値に汎用の等しい/大小比較は使えません。",
              "For Optional use Branch on an optional value; for ConditionResult use the true, false and unknown paths of Branch on a condition; for ParseResult and OperationOutcome use Branch on a typed result. Generic equality and ordering are unavailable for these values.",
            )}
          </p>
        )}
      {semanticProfile === "scratch.v1" &&
        value.kind === "expression" &&
        [
          "list.item",
          "list.insert",
          "list.remove",
          "list.replace",
          "list.slice",
          "list.lastOptional",
          "list.lastStrict",
        ].includes(value.expression.operator) && (
          <p className="automation-list-position-guidance">
            {words(
              locale,
              "位置は1から始まる整数です。random・last・allという文字は入力できません。無作為の位置は抽選ブロックで一度確定した数値を使います。最後の項目は専用の形で、値あり/なしを分ける形か、空の一覧ならエラーにする形を選びます。すべて削除は「一覧を空にした値」を使い、空にした値を明示して代入します。",
              "Positions are integers starting at 1. The words random, last and all are not valid numbers. Use a number fixed once by the random-draw block for a random position. For the last item choose its dedicated optional form or the strict form that errors on an empty list. To clear all items, use Create a cleared list and explicitly assign that value.",
            )}
          </p>
        )}
      {semanticProfile === "scratch.v1" && value.type === "Number" && (
        <details className="automation-number-semantics">
          <summary>
            {words(
              locale,
              "数値の精度と丸め方",
              "Number precision and rounding",
            )}
          </summary>
          <p>
            {words(
              locale,
              "小数の計算には誤差が出る場合があります。0.1 + 0.2 は 0.30000000000000004 となり、0.3 との厳密比較は false です。数値は binary64 で扱い、表示だけで同値とは判断しません。",
              "Decimal arithmetic can have precision differences. 0.1 + 0.2 is 0.30000000000000004, so an exact comparison with 0.3 is false. Numbers use binary64; equal-looking displays do not establish equality.",
            )}
          </p>
          <p>
            {words(
              locale,
              "切り下げ floor(-1.2) = -2。切り上げ ceil(-1.2) = -1。0の方向へ切り捨てる truncate(-1.2) = -1。負の数では切り下げと0方向の切り捨てが異なります。",
              "Floor(-1.2) = -2. Ceil(-1.2) = -1. Truncate(-1.2) = -1, toward zero. For negative numbers, flooring and truncating toward zero differ.",
            )}
          </p>
          <p>
            {words(
              locale,
              "半値は0から遠い方: 1.5 → 2、-1.5 → -2、-0.5 → -1。半値は大きい方（Scratch方式）: 1.5 → 2、-1.5 → -1、-0.5 → 0。丸めるブロックで方式を明示して選びます。",
              "Halfway away from zero: 1.5 → 2, -1.5 → -2, -0.5 → -1. Halfway toward positive infinity (Scratch style): 1.5 → 2, -1.5 → -1, -0.5 → 0. Choose an explicit mode in the rounding block.",
            )}
          </p>
          <p>
            {words(
              locale,
              "丸め方を変えたら新しい版として保存し、構造の確認・送信しない試運転・影響確認をやり直します。開始済みの実行は元の版を使います。",
              "After changing rounding mode, save a new revision, validate, test without sending and review impact again. Runs already started keep their original revision.",
            )}
          </p>
          {value.kind === "expression" &&
            value.expression.operator === "number.math" && (
              <p>
                {words(
                  locale,
                  "数学関数はサーバーの固定版MPFRを使います。三角関数は度数で入力し、逆三角関数も度数を返します。誤差は最大4 ulp、表現できる微小値（subnormal）を保持します。範囲外や未定義の計算はエラーになり、ブラウザの近似値では代用しません。",
                  "Math functions use fixed MPFR on the server. Trigonometric inputs and inverse-trigonometric results use degrees. Error is at most 4 ulp, and representable subnormals are preserved. Out-of-range or undefined calculations fail; browser approximations are not substituted.",
                )}
              </p>
            )}
        </details>
      )}
      {value.kind === "expression" &&
        value.expression.operator.startsWith("text.") && (
          <details className="automation-text-semantics">
            <summary>
              {words(
                locale,
                "文字の数え方と一致の規則",
                "How text positions and matching work",
              )}
            </summary>
            <p>
              {semanticProfile === "scratch.v1"
                ? words(
                    locale,
                    "文字数・一文字・切り出し・検索の位置はUnicode 16.0の見た目の文字のまとまり（EGC）です。含む・置換・分割・先頭/末尾一致はUnicode scalar列の完全一致です。結合記号や絵文字の途中にも一致し、置換や分割で見た目が変わる場合があります。連結後は文字のまとまりを数え直します。例: e＋結合アクセントの中にアクセントを「含む」は true ですが、文字の位置を「探す」は文字のまとまりの途中を選べず not_found です。",
                    "Length, letter, slice and find positions use Unicode 16.0 extended grapheme clusters (EGCs). Contains, replace, split, starts-with and ends-with match exact Unicode scalar sequences. They may match inside combining text or emoji and change its appearance. Joined text is segmented again. Example: contains finds the combining accent inside e + accent (true), while find cannot select part of that cluster (not_found).",
                  )
                : words(
                    locale,
                    "この保存版の文字位置は従来のUnicode scalar単位です。新しい見た目の文字単位へ自動では変更しません。",
                    "This saved profile keeps legacy Unicode scalar positions. It is not automatically changed to grapheme-cluster positions.",
                  )}
            </p>
          </details>
        )}
    </fieldset>
  );
}

export function literalText(input: ValueInput | undefined): string | undefined {
  return input?.kind === "literal" && typeof input.value === "string"
    ? input.value
    : undefined;
}
export function isJsonValue(value: unknown): value is JsonValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    Array.isArray(value) ||
    typeof value === "object"
  );
}
export type { ExpressionOperator };

function MockRecordInput(props: SlotProps) {
  const type = props.value.type;
  if (typeof type !== "object" || type.kind !== "Record")
    throw new Error("MOCK_RECORD_TYPE");
  const schema = (() => {
    try {
      return registeredRecordSchema(type, {
        guildId: props.guildId,
        variables: {},
      });
    } catch {
      return undefined;
    }
  })();
  const source = (input: ValueInput): Record<string, ValueInput> =>
    Object.fromEntries(
      Object.entries(schema?.fields ?? {}).map(([key, field]) => [
        key,
        input.kind === "literal" &&
        input.value &&
        typeof input.value === "object" &&
        !Array.isArray(input.value) &&
        Object.hasOwn(input.value, key)
          ? { kind: "literal", type: field.type, value: input.value[key]! }
          : missing(field.type),
      ]),
    );
  const [fields, setFields] = useState(() => source(props.value));
  const last = useRef(JSON.stringify(props.value));
  useEffect(() => {
    const next = JSON.stringify(props.value);
    if (next !== last.current) {
      last.current = next;
      setFields(source(props.value));
    }
  }, [props.value]);
  if (!schema)
    return (
      <p>
        {words(
          props.locale,
          "この記録型の試運転入力は未対応です。",
          "Mock input for this record type is unavailable.",
        )}
      </p>
    );
  return (
    <div>
      <p className="automation-hint">
        {words(
          props.locale,
          "試運転専用の模擬結果です。本番のサービス記録や権限の証明には使えません。",
          "This is a simulation-only mock result. It cannot create a production service record or prove authority.",
        )}
      </p>
      {Object.entries(schema.fields).map(([key, field]) => (
        <ValueSlot
          {...props}
          key={key}
          value={fields[key] ?? missing(field.type)}
          label={
            key === "state"
              ? words(props.locale, "模擬の受付状態", "Mock ticket state")
              : key === "version"
                ? words(props.locale, "模擬の受付版", "Mock ticket version")
                : key === "first"
                  ? words(props.locale, "模擬の一つ目の値", "Mock first value")
                  : key === "second"
                    ? words(
                        props.locale,
                        "模擬の二つ目の値",
                        "Mock second value",
                      )
                    : key === "key"
                      ? words(
                          props.locale,
                          "模擬のグループキー",
                          "Mock group key",
                        )
                      : key === "items"
                        ? words(props.locale, "模擬の項目一覧", "Mock items")
                        : key === "item"
                          ? words(
                              props.locale,
                              "模擬の見つかった項目",
                              "Mock found item",
                            )
                          : key === "position"
                            ? words(
                                props.locale,
                                "模擬の見つかった位置",
                                "Mock found position",
                              )
                            : key
          }
          integer={key === "version"}
          minimum={key === "version" ? 0 : undefined}
          path={`${props.path}.record.${key}`}
          onChange={(input) => {
            const next = { ...fields, [key]: input };
            setFields(next);
            const complete = Object.entries(schema.fields).every(
              ([name, spec]) => spec.optional || next[name]?.kind === "literal",
            );
            const output: ValueInput = complete
              ? {
                  kind: "literal",
                  type,
                  value: Object.fromEntries(
                    Object.entries(next)
                      .filter(([, item]) => item.kind === "literal")
                      .map(([name, item]) => [
                        name,
                        (item as Extract<ValueInput, { kind: "literal" }>)
                          .value,
                      ]),
                  ),
                }
              : missing(type);
            last.current = JSON.stringify(output);
            props.onChange(output);
          }}
        />
      ))}
    </div>
  );
}

function OptionalLiteralInput(props: SlotProps) {
  const type = props.value.type;
  if (typeof type === "string" || type.kind !== "Optional")
    throw Error("OPTIONAL_TYPE");
  const data =
    props.value.kind === "literal" &&
    props.value.value &&
    typeof props.value.value === "object" &&
    !Array.isArray(props.value.value)
      ? props.value.value
      : undefined;
  const [choice, setChoice] = useState(
      data?.state === "set" ? "set" : data?.state === "unset" ? "unset" : "",
    ),
    [inner, setInner] = useState<ValueInput>(
      data?.state === "set"
        ? { kind: "literal", type: type.value, value: data.value! }
        : missing(type.value),
    );
  const last = useRef(JSON.stringify(props.value));
  useEffect(() => {
    const next = JSON.stringify(props.value);
    if (next === last.current) return;
    last.current = next;
    const data =
      props.value.kind === "literal" &&
      props.value.value &&
      typeof props.value.value === "object" &&
      !Array.isArray(props.value.value)
        ? props.value.value
        : undefined;
    setChoice(
      data?.state === "set" ? "set" : data?.state === "unset" ? "unset" : "",
    );
    setInner(
      data?.state === "set"
        ? { kind: "literal", type: type.value, value: data.value! }
        : missing(type.value),
    );
  }, [props.value, type.value]);
  const emit = (mode: string, input = inner) => {
    const next: ValueInput =
      mode === "unset"
        ? { kind: "literal", type, value: { state: "unset" } }
        : mode === "set" && input.kind === "literal"
          ? {
              kind: "literal",
              type,
              value: { state: "set", value: input.value },
            }
          : missing(type);
    last.current = JSON.stringify(next);
    props.onChange(next);
  };
  return (
    <div className="automation-optional-literal">
      <label>
        {words(props.locale, "値の有無を明示", "Explicit presence")}
        <select
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            emit(event.target.value);
          }}
        >
          <option value="">{words(props.locale, "未設定", "Not set")}</option>
          <option value="set">
            {words(props.locale, "値がある", "A value is present")}
          </option>
          <option value="unset">
            {words(props.locale, "値がない", "No value is present")}
          </option>
        </select>
      </label>
      {choice === "set" && (
        <ValueSlot
          {...props}
          value={inner}
          modes={["literal"]}
          path={`${props.path}.present-value`}
          label={words(props.locale, "中の値", "Contained value")}
          depth={(props.depth ?? 0) + 1}
          onChange={(value) => {
            setInner(value);
            emit("set", value);
          }}
        />
      )}
    </div>
  );
}

function FixedListInput(props: SlotProps) {
  const type = props.value.type;
  if (typeof type !== "object" || type.kind !== "List")
    throw new Error("LIST_TYPE_REQUIRED");
  const source = (value: ValueInput) =>
    value.kind === "literal" && Array.isArray(value.value)
      ? value.value.map((item) => ({
          id: crypto.randomUUID(),
          input: { kind: "literal" as const, type: type.element, value: item },
        }))
      : [];
  const [items, setItems] = useState<{ id: string; input: ValueInput }[]>(() =>
    source(props.value),
  );
  const last = useRef(JSON.stringify(props.value));
  useEffect(() => {
    const next = JSON.stringify(props.value);
    if (next !== last.current) {
      last.current = next;
      setItems(source(props.value));
    }
  }, [props.value]);
  const commit = (next: typeof items) => {
    setItems(next);
    const complete = next.every((item) => item.input.kind === "literal");
    const value: ValueInput = complete
      ? {
          kind: "literal",
          type,
          value: next.map((item) =>
            item.input.kind === "literal" ? item.input.value : null,
          ),
        }
      : { kind: "missing", type };
    last.current = JSON.stringify(value);
    props.onChange(value);
    props.onValidity(
      props.path,
      complete
        ? null
        : words(
            props.locale,
            "一覧の各項目を入力してください。空欄は実行値になりません。",
            "Enter every list item. Blank items are not execution values.",
          ),
    );
  };
  return (
    <div className="automation-list-input">
      <p>
        {words(
          props.locale,
          "同じ型の項目を順に指定します。追加した空欄に初期値は入りません。",
          "Specify same-type items in order. Added blank items have no default value.",
        )}
      </p>
      {items.map((item, index) => (
        <div key={item.id}>
          <ValueSlot
            {...props}
            modes={["literal"]}
            integer={false}
            depth={(props.depth ?? 0) + 1}
            path={props.path + "." + item.id}
            label={words(
              props.locale,
              index + 1 + "番目",
              "Item " + (index + 1),
            )}
            value={item.input}
            onChange={(input) =>
              commit(
                items.map((old, i) => (i === index ? { ...old, input } : old)),
              )
            }
          />
          <button
            type="button"
            onClick={() => {
              props.onValidity(props.path + "." + item.id, null);
              commit(items.filter((_old, i) => i !== index));
            }}
          >
            {words(props.locale, "項目を除く", "Remove item")}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          commit([
            ...items,
            { id: crypto.randomUUID(), input: missing(type.element) },
          ])
        }
      >
        {words(props.locale, "項目を追加", "Add item")}
      </button>
      {items.length === 0 && props.value.kind === "missing" && (
        <button type="button" onClick={() => commit([])}>
          {words(props.locale, "空の一覧を確定", "Use an empty list")}
        </button>
      )}
    </div>
  );
}
