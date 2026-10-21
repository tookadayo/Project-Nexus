"use client";
import type {
  FlowDefinition,
  Statement,
  ValueType,
} from "../../../../packages/automation/src/types";
import type { EditorTargets } from "./client";
import {
  availableVariables,
  locate,
  missing,
  uid,
  words,
  type Locale,
} from "./model";
import { TypeSelect } from "./type-picker";
import { ValueSlot } from "./value-slot";

export function RepeatResultsEditor({
  statement,
  onChange,
  definition,
  locale,
  targets,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "repeat" }>;
  onChange: (node: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
}) {
  const sentinel = `repeat-final-${statement.id}`;
  const copy = structuredClone(definition),
    location = locate(copy, statement.id)?.statement;
  if (location?.kind === "repeat")
    location.body.push({ id: sentinel, kind: "end" });
  const variables = availableVariables(copy, sentinel, locale);
  const results = statement.results ?? [];
  const outputType = (type: ValueType): ValueType => ({
    kind: "List",
    element: {
      kind: "Record",
      schemaId: "nexus.iteration-result.v1",
      typeArgs: [type],
    },
  });
  return (
    <fieldset className="automation-repeat-results">
      <legend>
        {words(
          locale,
          "各回の結果を一覧で受け取る",
          "Receive a list of iteration results",
        )}
      </legend>
      <p className="automation-hint">
        {words(
          locale,
          "正常に終わった回の最後で値を受け取ります。成功・失敗・未開始・スキップ・中止・結果不明を区別し、成功した中身は型付き結果分岐の成功経路だけで使います。結果一覧は読み取り専用です。失敗や結果不明から次の外部操作を始める許可にはなりません。",
          "Receive each value at the end of a normally completed iteration. Success, failure, not started, skipped, cancellation and unknown stay distinct. Use the contained outcome through its typed success branch. Result lists are read-only and do not authorize continuing external actions after failure or an unknown outcome.",
        )}
      </p>
      {results.map((result, index) => (
        <section key={result.output.id}>
          <label>
            {words(locale, "結果一覧の名前", "Result list name")}
            <input
              value={result.output.name}
              maxLength={80}
              onChange={(event) =>
                onChange({
                  ...statement,
                  results: results.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          output: { ...item.output, name: event.target.value },
                        }
                      : item,
                  ),
                })
              }
            />
          </label>
          <TypeSelect
            value={result.value.type}
            locale={locale}
            onChange={(type) =>
              onChange({
                ...statement,
                results: results.map((item, i) =>
                  i === index
                    ? {
                        output: { ...item.output, type: outputType(type) },
                        value: missing(type),
                      }
                    : item,
                ),
              })
            }
          />
          <ValueSlot
            value={result.value}
            onChange={(value) =>
              onChange({
                ...statement,
                results: results.map((item, i) =>
                  i === index ? { ...item, value } : item,
                ),
              })
            }
            label={words(
              locale,
              "この回が正常に終わったときの値",
              "Value when this iteration completes normally",
            )}
            path={`${statement.id}.result.${result.output.id}`}
            locale={locale}
            variables={variables}
            targets={targets}
            guildId={definition.guildId}
            onValidity={onValidity}
            pureDefinitions={definition.pureDefinitions}
          />
          <button
            type="button"
            onClick={() =>
              onChange({
                ...statement,
                results: results.filter((_, i) => i !== index),
              })
            }
          >
            {words(locale, "この結果一覧を削除", "Delete this result list")}
          </button>
        </section>
      ))}
      <button
        type="button"
        disabled={results.length >= 8}
        onClick={() =>
          onChange({
            ...statement,
            results: [
              ...results,
              {
                output: {
                  id: uid(),
                  name: words(locale, "各回の結果", "Iteration results"),
                  type: outputType("Number"),
                },
                value: missing("Number"),
              },
            ],
          })
        }
      >
        {words(
          locale,
          "各回の名前付き結果を追加",
          "Add a named iteration result",
        )}
      </button>
    </fieldset>
  );
}
