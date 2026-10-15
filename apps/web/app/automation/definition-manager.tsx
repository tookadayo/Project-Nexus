"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FlowDefinition,
  ValueInput,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import { validateValueInput } from "../../../../packages/automation/src/expression";
import type { EditorTargets } from "./client";
import { words, type Locale, typeName } from "./model";
import { TypeSelect } from "./type-picker";
import { ValueSlot } from "./value-slot";
import {
  addManagedDefinition,
  cloneManagedDefinition,
  createManagedDefinition,
  definitionDifferences,
  definitionIdentity,
  definitionKey,
  definitionManagementSnapshot,
  definitionReferences,
  editPureInputs,
  findManagedDefinition,
  managedDefinitions,
  removeManagedDefinition,
  repinDefinitionReferences,
  type DefinitionIdentity,
  type DefinitionKind,
  type ManagedDefinition,
  type RepinReview,
} from "./definition-management";
import "./definition-manager.css";

export interface DefinitionManagerProps {
  definition: FlowDefinition;
  locale: Locale;
  targets: EditorTargets;
  disabled?: boolean;
  onChange: (definition: FlowDefinition) => void;
  onEditProcedure?: (id: string, revision: number) => void;
  onValidity: (path: string, message: string | null) => void;
}
interface PendingDefinition {
  kind: DefinitionKind;
  value: ManagedDefinition;
  source?: DefinitionIdentity;
}
const emptyValue = (type: VariableDeclaration["type"]) => ({
  kind: "missing" as const,
  type,
});
const errorCopy = (locale: Locale, code: string) => {
  const known: Record<string, [string, string]> = {
    DEFINITION_IN_USE: [
      "参照している呼出しがあるため、この版は削除できません。",
      "This version still has callers and cannot be removed.",
    ],
    DEFINITION_CYCLE_OR_DEPTH: [
      "循環する呼出しや深すぎる呼出しは作れません。",
      "Calls cannot be recursive or exceed the shared depth limit.",
    ],
    DEFINITION_OUTPUT_INCOMPATIBLE: [
      "使用中の戻り値の型や名前が変わっています。呼出しを個別に編集してください。",
      "A used result name or type changed. Edit that caller individually.",
    ],
    DEFINITION_REFERENCE_CHANGED: [
      "呼出しが変更されています。最新の内容で確認し直してください。",
      "Callers changed. Review the current draft again.",
    ],
    DEFINITION_ID_CONFLICT: [
      "同じ版が存在します。新しい版を作り直してください。",
      "That version already exists. Create a new version again.",
    ],
    DEFINITION_NAME: [
      "名前を1〜100文字で入力してください。",
      "Enter a name of 1–100 characters.",
    ],
    DEFINITION_PARAMETER_NAME: [
      "引数と戻り値の名前を1〜100文字で入力してください。",
      "Enter parameter and result names of 1–100 characters.",
    ],
    DEFINITION_PARAMETER_ID: [
      "引数と戻り値には別々の識別子が必要です。定義を作り直してください。",
      "Parameters and results need distinct identifiers. Create the definition again.",
    ],
  };
  return (
    known[code]?.[locale === "ja" ? 0 : 1] ??
    words(
      locale,
      "定義を追加できません。型、入力、呼出し先を確認してください。",
      "Review this definition's types, inputs and dependencies before adding it.",
    )
  );
};

export function DefinitionManager({
  definition,
  locale,
  targets,
  disabled = false,
  onChange,
  onEditProcedure,
  onValidity,
}: DefinitionManagerProps) {
  const [selected, setSelected] = useState<DefinitionIdentity | null>(null),
    [pending, setPending] = useState<PendingDefinition | null>(null),
    [compareRevision, setCompareRevision] = useState(""),
    [targetRevision, setTargetRevision] = useState(""),
    [selectedPaths, setSelectedPaths] = useState<string[]>([]),
    [review, setReview] = useState<{ base: string; plan: RepinReview } | null>(
      null,
    ),
    [checked, setChecked] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const applied = useRef<string | null>(null),
    heading = useRef<HTMLInputElement>(null);
  const pendingKey = pending
    ? definitionKey(definitionIdentity(pending.kind, pending.value))
    : "";
  useEffect(() => {
    if (pendingKey) heading.current?.focus();
  }, [pendingKey]);
  useEffect(() => {
    onValidity(
      "definition-manager.pending",
      pendingKey
        ? words(
            locale,
            "定義の編集を下書きへ追加するか、取り消してください。",
            "Add the definition edit to this draft, or cancel it.",
          )
        : null,
    );
    return () => onValidity("definition-manager.pending", null);
  }, [pendingKey, locale, onValidity]);
  const validity = useCallback((path: string, value: string | null) => {
    setSlotErrors((previous) => {
      const next = { ...previous };
      if (value) next[path] = value;
      else delete next[path];
      return next;
    });
  }, []);
  const entries = managedDefinitions(definition),
    current = selected
      ? findManagedDefinition(definition, selected)
      : undefined;
  const versions = selected
    ? entries
        .filter(
          (item) =>
            item.kind === selected.kind && item.value.id === selected.id,
        )
        .sort((a, b) => a.value.revision - b.value.revision)
    : [];
  const references = selected ? definitionReferences(definition, selected) : [];
  const compared = versions.find(
    (item) => String(item.value.revision) === compareRevision,
  )?.value;
  const difference =
    current && compared ? definitionDifferences(compared, current) : [];
  const pendingSource = pending?.source
    ? findManagedDefinition(definition, pending.source)
    : undefined;
  const pendingDifference =
    pending && pendingSource
      ? definitionDifferences(pendingSource, pending.value)
      : [];
  const select = (identity: DefinitionIdentity) => {
    setSelected(identity);
    setTargetRevision("");
    setCompareRevision("");
    setReview(null);
    setChecked(false);
    setError(null);
    setMessage(null);
    setSelectedPaths(
      definitionReferences(definition, identity).map((item) => item.path),
    );
  };
  const begin = (kind: DefinitionKind, mode?: "revision" | "copy") => {
    if (disabled || pending) return;
    try {
      const value =
        mode && selected
          ? cloneManagedDefinition(definition, selected, mode)
          : createManagedDefinition(definition, kind);
      if (!mode)
        value.name = words(
          locale,
          kind === "procedure" ? "新しい共通手順" : "新しいPure値",
          kind === "procedure" ? "New shared procedure" : "New pure value",
        );
      applied.current = null;
      setError(null);
      setMessage(null);
      setSlotErrors({});
      setPending({
        kind,
        value,
        ...(mode && selected ? { source: selected } : {}),
      });
    } catch (cause) {
      setError(errorCopy(locale, cause instanceof Error ? cause.message : ""));
    }
  };
  const updatePending = (value: ManagedDefinition) => {
    setPending((previous) => (previous ? { ...previous, value } : null));
    setError(null);
  };
  const applyPending = () => {
    if (
      !pending ||
      disabled ||
      applied.current === pendingKey ||
      Object.keys(slotErrors).length
    )
      return;
    try {
      if ("value" in pending.value)
        validateValueInput(pending.value.value, {
          guildId: definition.guildId,
          variables: Object.fromEntries(
            pending.value.inputs.map((item) => [
              item.id,
              { type: item.type, value: null, provenance: [] },
            ]),
          ),
          pureDefinitions: [
            ...(definition.pureDefinitions ?? []),
            pending.value,
          ],
        });
      const next = addManagedDefinition(
        definition,
        pending.kind,
        pending.value,
      );
      applied.current = pendingKey;
      onChange(next);
      select(definitionIdentity(pending.kind, pending.value));
      setPending(null);
      setMessage(
        words(
          locale,
          "新しい版をこの下書きへ追加しました。呼出し先は自動更新していません。保存・試運転・影響確認は別に行います。",
          "Added a new version to this draft. Callers remain pinned. Save, simulate and review impact separately.",
        ),
      );
      if (pending.kind === "procedure")
        onEditProcedure?.(pending.value.id, pending.value.revision);
    } catch (cause) {
      setError(errorCopy(locale, cause instanceof Error ? cause.message : ""));
    }
  };
  const prepareRepin = () => {
    if (!selected || !targetRevision || disabled || !selectedPaths.length)
      return;
    try {
      const plan = repinDefinitionReferences(
        definition,
        selected,
        { ...selected, revision: Number(targetRevision) },
        selectedPaths,
      );
      setReview({ base: definitionManagementSnapshot(definition), plan });
      setChecked(false);
      setError(null);
    } catch (cause) {
      setError(errorCopy(locale, cause instanceof Error ? cause.message : ""));
    }
  };
  const applyRepin = () => {
    if (!review || !checked || disabled) return;
    if (review.base !== definitionManagementSnapshot(definition)) {
      setError(errorCopy(locale, "DEFINITION_REFERENCE_CHANGED"));
      setReview(null);
      return;
    }
    const next = structuredClone(review.plan.definition);
    if (definition.ui) next.ui = structuredClone(definition.ui);
    else delete next.ui;
    onChange(next);
    setReview(null);
    setChecked(false);
    setMessage(
      words(
        locale,
        "選んだ呼出しだけを更新しました。未入力の引数を埋め、再検証してください。",
        "Updated only the selected callers. Fill unset arguments and validate again.",
      ),
    );
  };
  const referenceName = (owner: string) => {
    const item = entries.find(
      (entry) =>
        definitionKey(definitionIdentity(entry.kind, entry.value)) === owner,
    );
    return item
      ? `${item.value.name} · v${item.value.revision}`
      : words(
          locale,
          owner === "main" ? "主手順" : "今回は使わない手順",
          owner === "main" ? "Main steps" : "Detached steps",
        );
  };
  return (
    <details className="automation-definition-manager">
      <summary>
        {words(
          locale,
          "共通手順・Pure値の定義と固定版を管理",
          "Manage shared procedures, pure values and fixed versions",
        )}
      </summary>
      <p>
        {words(
          locale,
          "定義はこの自動化の保存版に含まれます。新しい版やコピーを作っても、既存の呼出し・実行中の処理・有効な保存版は変わりません。",
          "Definitions belong to this flow revision. New versions and copies do not change existing callers, running executions or the enabled revision.",
        )}
      </p>
      <div className="automation-definition-create">
        <button
          type="button"
          disabled={disabled || Boolean(pending)}
          onClick={() => begin("procedure")}
        >
          {words(locale, "共通手順を作る", "Create a shared procedure")}
        </button>
        <button
          type="button"
          disabled={disabled || Boolean(pending)}
          onClick={() => begin("pure")}
        >
          {words(locale, "Pure値を作る", "Create a pure value")}
        </button>
      </div>
      {!entries.length && (
        <p>{words(locale, "定義はまだありません。", "No definitions yet.")}</p>
      )}
      <ul className="automation-definition-list">
        {entries.map(({ kind, value }) => {
          const identity = definitionIdentity(kind, value),
            refs = definitionReferences(definition, identity);
          return (
            <li key={definitionKey(identity)}>
              <button
                type="button"
                aria-pressed={
                  selected &&
                  definitionKey(selected) === definitionKey(identity)
                    ? true
                    : false
                }
                disabled={Boolean(pending)}
                onClick={() => select(identity)}
              >
                {value.name} · v{value.revision} ·{" "}
                {kind === "pure"
                  ? words(locale, "Pure値", "Pure value")
                  : words(locale, "共通手順", "Shared procedure")}
              </button>
              <small>
                {words(
                  locale,
                  `呼出し ${refs.length}件`,
                  `${refs.length} callers`,
                )}
              </small>
            </li>
          );
        })}
      </ul>
      {current && selected && !pending && (
        <section
          className="automation-definition-version"
          aria-label={words(
            locale,
            "選んだ定義の版",
            "Selected definition version",
          )}
        >
          <h3>
            {current.name} · v{current.revision}
          </h3>
          <Signature definition={current} locale={locale} />
          <div className="automation-definition-create">
            <button
              type="button"
              disabled={disabled}
              onClick={() => begin(selected.kind, "revision")}
            >
              {words(
                locale,
                "この版から新しい版を編集",
                "Edit a new version from this revision",
              )}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => begin(selected.kind, "copy")}
            >
              {words(
                locale,
                "別の定義としてコピー",
                "Copy as a separate definition",
              )}
            </button>
            <button
              type="button"
              disabled={
                disabled ||
                references.some(
                  (item) => item.owner !== definitionKey(selected),
                )
              }
              onClick={() => {
                try {
                  onChange(removeManagedDefinition(definition, selected));
                  setSelected(null);
                } catch (cause) {
                  setError(
                    errorCopy(
                      locale,
                      cause instanceof Error ? cause.message : "",
                    ),
                  );
                }
              }}
            >
              {words(
                locale,
                "未使用のこの版を下書きから削除",
                "Remove this unused version from the draft",
              )}
            </button>
          </div>
          <label>
            {words(locale, "比較元の版", "Compare with revision")}
            <select
              value={compareRevision}
              onChange={(event) => setCompareRevision(event.target.value)}
            >
              <option value="">
                {words(locale, "比較元を選ぶ", "Choose a revision")}
              </option>
              {versions
                .filter((item) => item.value.revision !== current.revision)
                .map((item) => (
                  <option key={item.value.revision} value={item.value.revision}>
                    v{item.value.revision}
                  </option>
                ))}
            </select>
          </label>
          {compared && (
            <DifferenceList difference={difference} locale={locale} />
          )}
          <h4>
            {words(
              locale,
              "この版を使う呼出し",
              "Callers pinned to this version",
            )}
          </h4>
          {!references.length ? (
            <p>
              {words(
                locale,
                "この下書きに呼出しはありません。",
                "This draft has no callers of this version.",
              )}
            </p>
          ) : (
            <fieldset disabled={disabled || Boolean(review)}>
              <legend>
                {words(
                  locale,
                  "更新する呼出しを選ぶ",
                  "Select callers to update",
                )}
              </legend>
              {references.map((reference) => (
                <label key={reference.path}>
                  <input
                    type="checkbox"
                    checked={selectedPaths.includes(reference.path)}
                    onChange={(event) =>
                      setSelectedPaths((previous) =>
                        event.target.checked
                          ? [...previous, reference.path]
                          : previous.filter((path) => path !== reference.path),
                      )
                    }
                  />
                  {referenceName(reference.owner)}
                  <small>{reference.path}</small>
                </label>
              ))}
              <label>
                {words(
                  locale,
                  "明示的に切り替える版",
                  "Explicitly switch to revision",
                )}
                <select
                  value={targetRevision}
                  onChange={(event) => setTargetRevision(event.target.value)}
                >
                  <option value="">
                    {words(locale, "更新先を選ぶ", "Choose a target revision")}
                  </option>
                  {versions
                    .filter((item) => item.value.revision !== selected.revision)
                    .map((item) => (
                      <option
                        key={item.value.revision}
                        value={item.value.revision}
                      >
                        v{item.value.revision} · {item.value.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!targetRevision || !selectedPaths.length}
                onClick={prepareRepin}
              >
                {words(
                  locale,
                  "呼出し更新の内容を確認",
                  "Review caller update",
                )}
              </button>
            </fieldset>
          )}
        </section>
      )}
      {pending && (
        <fieldset className="automation-definition-edit" disabled={disabled}>
          <legend>
            {words(
              locale,
              "新しい定義の版を編集",
              "Edit a new definition version",
            )}{" "}
            · v{pending.value.revision}
          </legend>
          <label>
            {words(locale, "定義の名前", "Definition name")}
            <input
              ref={heading}
              maxLength={100}
              value={pending.value.name}
              onChange={(event) =>
                updatePending({ ...pending.value, name: event.target.value })
              }
            />
          </label>
          <Declarations
            value={pending.value.inputs}
            locale={locale}
            label={words(locale, "入力の引数", "Input parameters")}
            onChange={(inputs) =>
              updatePending(
                "value" in pending.value
                  ? editPureInputs(pending.value, inputs)
                  : { ...pending.value, inputs },
              )
            }
          />
          {"outputs" in pending.value ? (
            <>
              <Declarations
                value={pending.value.outputs}
                locale={locale}
                label={words(locale, "名前付きの戻り値", "Named results")}
                onChange={(outputs) => {
                  const next = structuredClone(pending.value);
                  if (!("body" in next)) return;
                  next.outputs = outputs;
                  const synchronize = (value: unknown): void => {
                    if (!value || typeof value !== "object") return;
                    const object = value as Record<string, unknown>;
                    if (object.kind === "return") {
                      const previous = object.values as Record<
                        string,
                        ValueInput
                      >;
                      object.values = Object.fromEntries(
                        outputs.map((output) => [
                          output.id,
                          previous[output.id]?.type &&
                          JSON.stringify(previous[output.id]!.type) ===
                            JSON.stringify(output.type)
                            ? previous[output.id]
                            : emptyValue(output.type),
                        ]),
                      );
                    }
                    Object.values(object).forEach(synchronize);
                  };
                  synchronize(next.body);
                  updatePending(next);
                }}
              />
              <p>
                {words(
                  locale,
                  "下書きに追加すると手順を編集できます。全ての正常経路で宣言した結果を返してください。引数は読み取り専用で、呼出しの深さと処理予算を共有します。",
                  "After adding this version, edit its steps. Every normal path must return the declared results. Parameters are read-only; calls share the depth and execution budgets.",
                )}
              </p>
            </>
          ) : (
            <>
              <TypeSelect
                value={pending.value.outputType}
                locale={locale}
                onChange={(outputType) => {
                  if ("value" in pending.value)
                    updatePending({
                      ...pending.value,
                      outputType,
                      value: emptyValue(outputType),
                    });
                }}
              />
              <ValueSlot
                value={pending.value.value}
                locale={locale}
                label={words(locale, "返すPure値", "Pure result value")}
                path={`definition-manager.${pendingKey}`}
                variables={pending.value.inputs}
                targets={targets}
                guildId={definition.guildId}
                pureDefinitions={definition.pureDefinitions}
                onValidity={validity}
                onChange={(value) => {
                  if ("value" in pending.value)
                    updatePending({ ...pending.value, value });
                }}
              />
              <p>
                {words(
                  locale,
                  "使えるのは引数と純粋な計算だけです。送信、外部の読取り、時計、抽選、代入、再帰は使えません。",
                  "Use parameters and pure calculations only. Sending, external reads, clock reads, random draws, assignments and recursion are unavailable.",
                )}
              </p>
            </>
          )}
          {pendingSource && (
            <DifferenceList difference={pendingDifference} locale={locale} />
          )}
          <button
            type="button"
            disabled={
              !pending.value.name.trim() ||
              Boolean(Object.keys(slotErrors).length)
            }
            onClick={applyPending}
          >
            {words(
              locale,
              "この版を下書きへ追加",
              "Add this version to the draft",
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setSlotErrors({});
              setError(null);
            }}
          >
            {words(locale, "定義の編集を取り消す", "Cancel definition edit")}
          </button>
        </fieldset>
      )}
      {review && (
        <fieldset className="automation-definition-review" disabled={disabled}>
          <legend>
            {words(
              locale,
              "呼出し先の更新を確認",
              "Review fixed-version caller changes",
            )}
          </legend>
          <p>
            {words(
              locale,
              `${review.plan.references.length}件の呼出しを更新します。入力し直す引数 ${review.plan.resetInputs}件、新しい戻り値 ${review.plan.addedOutputs}件。選ばなかった呼出しは現在の版を維持します。`,
              `Update ${review.plan.references.length} callers: ${review.plan.resetInputs} arguments become unset and ${review.plan.addedOutputs} new results are added. Unselected callers keep their current version.`,
            )}
          </p>
          <label>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            {words(
              locale,
              "対象の呼出しと、引数・戻り値の変更を確認しました。",
              "I reviewed the callers and changes to arguments and results.",
            )}
          </label>
          <button type="button" disabled={!checked} onClick={applyRepin}>
            {words(locale, "選んだ呼出しの版を更新", "Update selected callers")}
          </button>
          <button
            type="button"
            onClick={() => {
              setReview(null);
              setChecked(false);
            }}
          >
            {words(locale, "呼出し更新を取り消す", "Cancel caller update")}
          </button>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
function Signature({
  definition,
  locale,
}: {
  definition: ManagedDefinition;
  locale: Locale;
}) {
  return (
    <p>
      {words(locale, "入力", "Inputs")}:{" "}
      {definition.inputs
        .map((item) => `${item.name}: ${typeName(item.type)}`)
        .join(", ") || "—"}
      <br />
      {words(locale, "戻り値", "Results")}:{" "}
      {"outputs" in definition
        ? definition.outputs
            .map((item) => `${item.name}: ${typeName(item.type)}`)
            .join(", ") || "—"
        : typeName(definition.outputType)}
    </p>
  );
}
function Declarations({
  value,
  locale,
  label,
  onChange,
}: {
  value: VariableDeclaration[];
  locale: Locale;
  label: string;
  onChange: (value: VariableDeclaration[]) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {value.map((item, index) => (
        <div key={item.id} className="automation-definition-parameter">
          <label>
            {words(locale, "名前", "Name")}
            <input
              value={item.name}
              maxLength={100}
              onChange={(event) =>
                onChange(
                  value.map((entry, i) =>
                    i === index
                      ? { ...entry, name: event.target.value }
                      : entry,
                  ),
                )
              }
            />
          </label>
          <TypeSelect
            value={item.type}
            locale={locale}
            onChange={(type) =>
              onChange(
                value.map((entry, i) =>
                  i === index ? { ...entry, type } : entry,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            {words(locale, "この項目を削除", "Remove parameter")}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.length >= 128}
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              name: words(
                locale,
                `項目 ${value.length + 1}`,
                `Parameter ${value.length + 1}`,
              ),
              type: "PlainText",
            },
          ])
        }
      >
        {words(locale, "型付きの項目を追加", "Add a typed parameter")}
      </button>
    </fieldset>
  );
}
function DifferenceList({
  difference,
  locale,
}: {
  difference: ReturnType<typeof definitionDifferences>;
  locale: Locale;
}) {
  return (
    <section className="automation-definition-diff">
      <h4>
        {words(locale, "元の版との差分", "Changes from the original version")}
      </h4>
      {difference.length ? (
        <ul>
          {difference.slice(0, 100).map((item) => (
            <li key={item.path}>
              <strong>{item.path}</strong>
              <span>{item.before}</span>
              <span aria-hidden="true"> → </span>
              <span>{item.after}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {words(
            locale,
            "処理・引数・戻り値の内容は同じです。版とローカルIDだけが新しくなります。",
            "Behavior, parameters and results are unchanged. Only the version and local IDs are new.",
          )}
        </p>
      )}
      {difference.length > 100 && (
        <p>
          {words(
            locale,
            "差分が多いため、先頭100件を表示しています。",
            "Showing the first 100 changes.",
          )}
        </p>
      )}
    </section>
  );
}
