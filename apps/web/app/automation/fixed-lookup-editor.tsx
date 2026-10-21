"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PureDefinition,
  ValueInput,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import { stableListKey } from "../../../../packages/automation/src/structured-values";
import { supportsFixedMappingKeyEditor } from "../../../../packages/automation/src/expression-cards";
import type { EditorTargets } from "./client";
import { missing, words, type Locale } from "./model";
import { ValueSlot } from "./value-slot";

export function FixedLookupEditor(props: {
  value: Extract<ValueInput, { kind: "expression" }>;
  onChange: (value: ValueInput) => void;
  locale: Locale;
  path: string;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  guildId: string;
  pureDefinitions?: PureDefinition[];
  depth?: number;
  onValidity: (path: string, message: string | null) => void;
}) {
  const { value, locale, path } = props;
  const args = value.expression.args,
    keyType = args[0]?.type ?? "PlainText",
    resultType = value.type;
  const keysReadOnly = !supportsFixedMappingKeyEditor(keyType);
  const source = () =>
    args[1]?.kind === "literal" && Array.isArray(args[1].value)
      ? args[1].value.map((item) => ({
          kind: "literal" as const,
          type: keyType,
          value: item,
        }))
      : args.slice(3).map(() => missing(keyType));
  const [keys, setKeys] = useState<ValueInput[]>(source);
  const last = useRef(JSON.stringify(value));
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized !== last.current) {
      last.current = serialized;
      setKeys(source());
    }
  }, [value]);
  const serializedKeys = JSON.stringify(keys);
  useEffect(() => {
    const values = keys.flatMap((item) =>
      item.kind === "literal" ? [stableListKey(item.value)] : [],
    );
    props.onValidity(
      `${path}.mapping-keys`,
      new Set(values).size !== values.length
        ? words(
            locale,
            "同じ対応キーを重複して設定できません。",
            "Mapping keys must be distinct.",
          )
        : null,
    );
  }, [serializedKeys, locale, path, props.onValidity]);
  useEffect(
    () => () => props.onValidity(`${path}.mapping-keys`, null),
    [path, props.onValidity],
  );
  const emit = (
    nextKeys: ValueInput[],
    rows: ValueInput[],
    lookup = args[0] ?? missing(keyType),
    fallback = args[2] ?? missing(resultType),
    allowEmpty = false,
  ) => {
    const complete =
      nextKeys.every((item) => item.kind === "literal") &&
      (nextKeys.length > 0 || allowEmpty || args[1]?.kind === "literal");
    const fixedKeys: ValueInput = keysReadOnly
      ? (args[1] ?? missing({ kind: "List", element: keyType }))
      : complete
        ? {
            kind: "literal",
            type: { kind: "List", element: keyType },
            value: nextKeys.map((item) =>
              item.kind === "literal" ? item.value : null,
            ),
          }
        : missing({ kind: "List", element: keyType });
    const next: ValueInput = {
      ...value,
      expression: {
        ...value.expression,
        args: [lookup, fixedKeys, fallback, ...rows],
      },
    };
    last.current = JSON.stringify(next);
    setKeys(nextKeys);
    props.onChange(next);
  };
  const field = (
    input: ValueInput,
    label: string,
    suffix: string,
    onChange: (next: ValueInput) => void,
    fixed = false,
  ) => (
    <ValueSlot
      {...props}
      value={input}
      onChange={onChange}
      label={label}
      path={`${path}.${suffix}`}
      depth={(props.depth ?? 0) + 1}
      modes={fixed ? ["literal"] : undefined}
    />
  );
  return (
    <div className="automation-fixed-lookup">
      {keysReadOnly && (
        <p className="automation-notice" role="status">
          {words(
            locale,
            "この種類の保存済み固定参照は、この画面ではまだ選択・変更できません。キーをそのまま保持して、戻り値だけを編集できます。参照IDの直接入力は使いません。",
            "This saved fixed-reference type cannot yet be selected or changed in this editor. Its keys are preserved; returned values remain editable. Raw reference IDs cannot be entered.",
          )}
        </p>
      )}
      {field(
        args[0] ?? missing(keyType),
        words(locale, "対応を調べるキー", "Key to look up"),
        "lookup-key",
        (next) => emit(keys, args.slice(3), next),
      )}
      {field(
        args[2] ?? missing(resultType),
        words(
          locale,
          "一致するキーがないときの値",
          "Explicit value when no key matches",
        ),
        "fallback",
        (next) => emit(keys, args.slice(3), undefined, next),
      )}
      <p className="automation-hint">
        {words(
          locale,
          "対応のキーは型のそろった固定値です。一致しない場合の値も明示します。空欄や例示をキーや戻り値として補いません。",
          "Mapping keys are fixed values of one type. Explicitly provide the no-match value too. Blank fields and examples are never filled in as keys or results.",
        )}
      </p>
      {keys.map((key, index) => (
        <fieldset key={index}>
          <legend>
            {words(locale, `対応 ${index + 1}`, `Mapping row ${index + 1}`)}
          </legend>
          {keysReadOnly ? (
            <p>
              {words(
                locale,
                "保存した固定参照を変更せず保持",
                "Saved fixed reference preserved unchanged",
              )}
            </p>
          ) : (
            field(
              key,
              words(locale, "固定の対応キー", "Fixed mapping key"),
              `key${index}`,
              (next) =>
                emit(
                  keys.map((item, i) => (i === index ? next : item)),
                  args.slice(3),
                ),
              true,
            )
          )}
          {field(
            args[index + 3] ?? missing(resultType),
            words(locale, "このキーに対応する値", "Value for this key"),
            `row${index}`,
            (next) =>
              emit(
                keys,
                args.slice(3).map((item, i) => (i === index ? next : item)),
              ),
          )}
          <button
            type="button"
            disabled={keysReadOnly}
            onClick={() =>
              emit(
                keys.filter((_, i) => i !== index),
                args.slice(3).filter((_, i) => i !== index),
                undefined,
                undefined,
                true,
              )
            }
          >
            {words(locale, "この対応行を削除", "Remove this mapping row")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={keysReadOnly || keys.length >= 100}
        onClick={() =>
          emit(
            [...keys, missing(keyType)],
            [...args.slice(3), missing(resultType)],
          )
        }
      >
        {words(locale, "対応行を追加", "Add a mapping row")}
      </button>
      {!keys.length && !keysReadOnly && (
        <button
          type="button"
          onClick={() => emit([], [], undefined, undefined, true)}
        >
          {words(
            locale,
            "空の対応表を明示して使う",
            "Explicitly use an empty mapping table",
          )}
        </button>
      )}
    </div>
  );
}
