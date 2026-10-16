"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FlowDefinition,
  Statement,
  ValueInput,
  ValueType,
  JsonValue,
  TicketState,
} from "../../../../packages/automation/src/types";
import type { EditorTargets } from "./client";
import { branches, PALETTE, words, uid, type Locale } from "./model";
import { ValueSlot } from "./value-slot";
import { UserInstantControl } from "./date-controls";
export interface SimulationInputs {
  inspectVariables?: string[];
  values: Record<string, { type: ValueType; value: JsonValue }>;
  outputs: Record<string, { type: ValueType; value: JsonValue }>;
  outcomes: Record<string, "SUCCEEDED" | "FAILED" | "UNKNOWN" | "NOT_STARTED">;
  clock?: string;
  approvals?: Record<string, "APPROVED" | "REJECTED" | "EXPIRED">;
  awaitEvents?: Record<
    string,
    | {
        state: "MATCHED";
        value: { state: TicketState; version: number };
        occurredAt: string;
      }
    | { state: "TIMED_OUT" }
  >;
}
export function SimulationInputPanel({
  definition,
  locale,
  targets,
  value,
  onChange,
  disabled,
  onValidity,
}: {
  definition: FlowDefinition;
  locale: Locale;
  targets: EditorTargets;
  value: SimulationInputs;
  onChange: (next: SimulationInputs) => void;
  disabled: boolean;
  onValidity?: (valid: boolean) => void;
}) {
  const invalidTimes = useRef(new Set<string>());
  const validityCallback = useRef(onValidity);
  validityCallback.current = onValidity;
  const temporalValidity = useCallback((key: string, valid: boolean) => {
    if (valid) invalidTimes.current.delete(key);
    else invalidTimes.current.add(key);
    validityCallback.current?.(invalidTimes.current.size === 0);
  }, []);
  const slotValidity = useCallback(
    (key: string, message: string | null) => {
      temporalValidity(key, message === null);
    },
    [temporalValidity],
  );
  const inputs =
    "inputs" in definition.trigger ? definition.trigger.inputs : [];
  const actions: Extract<Statement, { kind: "action" | "poll" }>[] = [];
  const eventWaits: Extract<Statement, { kind: "awaitEvent" }>[] = [];
  const approvalWaits: Extract<Statement, { kind: "approval" }>[] = [];
  const visit = (list: Statement[]) => {
    for (const node of list) {
      if (node.kind === "action" || node.kind === "poll") actions.push(node);
      if (node.kind === "awaitEvent") eventWaits.push(node);
      if (node.kind === "approval") approvalWaits.push(node);
      for (const branch of branches(node)) visit(branch.body);
    }
  };
  visit(definition.body);
  for (const procedure of definition.procedures ?? []) visit(procedure.body);
  const mockOutput = (node: Extract<Statement, { kind: "action" | "poll" }>) =>
    node.output ??
    (node.kind === "action" &&
    node.outcome &&
    typeof node.outcome.type === "object" &&
    node.outcome.type.kind === "OperationOutcome"
      ? { ...node.outcome, type: node.outcome.type.value }
      : undefined);
  const field = (
    key: string,
    type: ValueInput["type"],
    label: string,
    group: "values" | "outputs",
  ) =>
    typeof type === "string" && type.endsWith("Ref") ? (
      <fieldset key={key} className="automation-slot">
        <legend>
          {label} · {type}
        </legend>
        <p className="automation-hint">
          {words(
            locale,
            "試運転専用の合成参照を明示して使います。実際の受付・メンバー・投稿などは作成も取得もせず、権限の証明にはなりません。本番定義には入りません。",
            "Explicitly use a synthetic reference for this simulation. No actual ticket, member, message or other target is created or fetched. It proves no authority and is excluded from the production definition.",
          )}
        </p>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              [group]: {
                ...value[group],
                [key]: {
                  type,
                  value: {
                    id:
                      type === "TicketRef"
                        ? `intake:${uid()}`
                        : String(
                            900000000000000000n +
                              (BigInt(`0x${uid().replaceAll("-", "")}`) %
                                100000000000000000n),
                          ),
                    guildId: definition.guildId,
                  },
                },
              },
            })
          }
        >
          {words(
            locale,
            type === "TicketRef"
              ? "仮の受付参照を使う"
              : `合成の${type}参照を使う`,
            type === "TicketRef"
              ? "Use a synthetic ticket reference"
              : `Use a synthetic ${type} reference`,
          )}
        </button>
        {value[group][key] && (
          <>
            <small>
              {words(
                locale,
                "試運転専用の合成参照を設定済み",
                "A simulation-only synthetic reference is supplied",
              )}
            </small>
            <button
              type="button"
              onClick={() => {
                const entries = { ...value[group] };
                delete entries[key];
                onChange({ ...value, [group]: entries });
              }}
            >
              {words(locale, "模擬参照を解除", "Clear mock reference")}
            </button>
          </>
        )}
      </fieldset>
    ) : (
      <ValueSlot
        key={key}
        locale={locale}
        guildId={definition.guildId}
        label={label}
        path={`simulation-${key}`}
        modes={["literal"]}
        simulation
        variables={[]}
        targets={targets}
        value={
          value[group][key]
            ? { kind: "literal", type, value: value[group][key]!.value }
            : { kind: "missing", type }
        }
        onValidity={slotValidity}
        onChange={(input) => {
          const entries = { ...value[group] };
          if (input.kind === "literal")
            entries[key] = { type, value: input.value };
          else delete entries[key];
          onChange({ ...value, [group]: entries });
        }}
      />
    );
  return (
    <details className="automation-simulation-inputs">
      <summary>
        {words(
          locale,
          "試運転だけで使う模擬入力",
          "Mock inputs used only for simulation",
        )}
      </summary>
      <p>
        {words(
          locale,
          "この欄は本番定義・本番の抽選・正式承認へ反映しません。外部読取りや操作の結果は模擬で指定し、未指定なら未確認と表示します。",
          "These fields never change production definitions, production draws or formal approval. Supply mock outcomes for external reads and actions; omitted results remain undetermined.",
        )}
      </p>
      <UserInstantControl
        locale={locale}
        label={words(
          locale,
          "試運転の時刻（UTC・任意）",
          "Simulation clock (UTC, optional)",
        )}
        disabled={disabled}
        value={value.clock}
        onValidity={(valid) => temporalValidity("clock", valid)}
        onChange={(clock) => onChange({ ...value, clock })}
      />
      <fieldset disabled={disabled}>
        {inputs.map((input) =>
          field(input.id, input.type, input.name, "values"),
        )}
        {actions.map((action, index) => (
          <section key={action.id}>
            <h3>
              {index + 1}.{" "}
              {PALETTE.find((card) =>
                action.kind === "poll"
                  ? card.kind === "poll"
                  : card.operation === action.operation,
              )?.[locale] ?? words(locale, "登録操作", "Registered action")}
            </h3>
            {action.kind === "poll" && (
              <p className="automation-hint">
                {words(
                  locale,
                  "この模擬結果を各確認に使います。実際の受付や本番の待機は操作しません。未指定なら試運転を完了扱いにしません。",
                  "This mock read result is used for every attempt. No actual ticket or production wait is changed. An omitted result does not count as a completed simulation.",
                )}
              </p>
            )}
            <label>
              {words(locale, "模擬する結果", "Mock outcome")}
              <select
                value={value.outcomes[action.id] ?? ""}
                onChange={(event) => {
                  const outcomes = { ...value.outcomes };
                  if (event.target.value)
                    outcomes[action.id] = event.target
                      .value as SimulationInputs["outcomes"][string];
                  else delete outcomes[action.id];
                  onChange({ ...value, outcomes });
                }}
              >
                <option value="">
                  {words(
                    locale,
                    "未指定（未確認）",
                    "Not supplied (undetermined)",
                  )}
                </option>
                <option value="SUCCEEDED">
                  {words(
                    locale,
                    "確認済み成功を模擬",
                    "Simulate confirmed success",
                  )}
                </option>
                <option value="FAILED">
                  {words(
                    locale,
                    "確認済み失敗を模擬",
                    "Simulate confirmed failure",
                  )}
                </option>
                <option value="UNKNOWN">
                  {words(locale, "結果不明を模擬", "Simulate unknown result")}
                </option>
                <option value="NOT_STARTED">
                  {words(locale, "未開始を模擬", "Simulate not started")}
                </option>
              </select>
            </label>
            {mockOutput(action) &&
              field(
                action.id,
                mockOutput(action)!.type,
                words(
                  locale,
                  `${mockOutput(action)!.name}（試運転用）`,
                  `${mockOutput(action)!.name} (simulation only)`,
                ),
                "outputs",
              )}
          </section>
        ))}
        {approvalWaits.map((statement) => (
          <section key={statement.id}>
            <h3>
              {words(
                locale,
                "正式な承認待機（試運転用）",
                "Formal approval wait (simulation only)",
              )}
            </h3>
            <label>
              {words(
                locale,
                "模擬する正式承認の結果",
                "Mock formal approval result",
              )}
              <select
                value={value.approvals?.[statement.id] ?? ""}
                onChange={(event) => {
                  const approvals = { ...value.approvals };
                  if (event.target.value)
                    approvals[statement.id] = event.target.value as
                      "APPROVED" | "REJECTED" | "EXPIRED";
                  else delete approvals[statement.id];
                  onChange({ ...value, approvals });
                }}
              >
                <option value="">
                  {words(
                    locale,
                    "未指定（未確認）",
                    "Not supplied (undetermined)",
                  )}
                </option>
                <option value="APPROVED">
                  {words(locale, "承認を模擬", "Simulate approval")}
                </option>
                <option value="REJECTED">
                  {words(locale, "拒否を模擬", "Simulate rejection")}
                </option>
                <option value="EXPIRED">
                  {words(locale, "期限切れを模擬", "Simulate expiry")}
                </option>
              </select>
            </label>
            <p>
              {words(
                locale,
                "模擬結果は正式承認や権限の証明には使えず、本番の承認を消費しません。",
                "A mock cannot prove real approval or authority and consumes no production approval.",
              )}
            </p>
          </section>
        ))}
        {eventWaits.map((statement) => (
          <AwaitEventMock
            key={`${definition.id}:${statement.id}`}
            statement={statement}
            locale={locale}
            guildId={definition.guildId}
            targets={targets}
            onValidity={(valid) => temporalValidity(statement.id, valid)}
            value={value.awaitEvents?.[statement.id]}
            onChange={(mock) => {
              const awaitEvents = { ...value.awaitEvents };
              if (mock) awaitEvents[statement.id] = mock;
              else delete awaitEvents[statement.id];
              onChange({ ...value, awaitEvents });
            }}
          />
        ))}
      </fieldset>
    </details>
  );
}

function AwaitEventMock({
  statement,
  locale,
  guildId,
  targets,
  value,
  onChange,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "awaitEvent" }>;
  locale: Locale;
  guildId: string;
  targets: EditorTargets;
  value: NonNullable<SimulationInputs["awaitEvents"]>[string] | undefined;
  onChange: (
    value: NonNullable<SimulationInputs["awaitEvents"]>[string] | undefined,
  ) => void;
  onValidity: (valid: boolean) => void;
}) {
  const timeValid = useRef(true);
  const [mode, setMode] = useState(value?.state ?? ""),
    [result, setResult] = useState<ValueInput>(
      value?.state === "MATCHED"
        ? { kind: "literal", type: statement.output.type, value: value.value }
        : { kind: "missing", type: statement.output.type },
    ),
    [occurredAt, setOccurredAt] = useState(
      value?.state === "MATCHED" ? value.occurredAt : "",
    );
  const last = useRef(JSON.stringify(value));
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next === last.current) return;
    last.current = next;
    setMode(value?.state ?? "");
    setResult(
      value?.state === "MATCHED"
        ? { kind: "literal", type: statement.output.type, value: value.value }
        : { kind: "missing", type: statement.output.type },
    );
    setOccurredAt(value?.state === "MATCHED" ? value.occurredAt : "");
  }, [value, statement.output.type]);
  const validity = useCallback(() => {}, []);
  const emit = (
    mock: NonNullable<SimulationInputs["awaitEvents"]>[string] | undefined,
  ) => {
    last.current = JSON.stringify(mock);
    onChange(mock);
  };
  const publish = (
    nextMode: string,
    nextResult = result,
    nextAt = occurredAt,
  ) => {
    if (nextMode === "TIMED_OUT") return emit({ state: "TIMED_OUT" });
    const record = nextResult.kind === "literal" ? nextResult.value : undefined;
    if (
      nextMode === "MATCHED" &&
      record &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      typeof record.state === "string" &&
      typeof record.version === "number" &&
      Number.isSafeInteger(record.version) &&
      record.version >= 0 &&
      nextAt &&
      timeValid.current &&
      Number.isFinite(Date.parse(nextAt))
    )
      emit({
        state: "MATCHED",
        value: { state: record.state as TicketState, version: record.version },
        occurredAt: nextAt,
      });
    else emit(undefined);
  };
  return (
    <section className="automation-await-event-mock">
      <h3>
        {words(
          locale,
          "受付更新の待機（試運転用）",
          "Awaited ticket update (simulation only)",
        )}
      </h3>
      <p className="automation-hint">
        {words(
          locale,
          "一致または期限切れを明示し、一致の場合は状態・版・発生日時を入力します。これは仮の更新で、実イベントの本人・権限確認を証明するものではありません。",
          "Explicitly simulate a match or timeout. A match requires state, version and event time. This synthetic update does not prove the identity or authorization of a real event.",
        )}
      </p>
      <label>
        {words(locale, "模擬する待機結果", "Mock wait result")}
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            publish(event.target.value);
          }}
        >
          <option value="">
            {words(locale, "未指定（未確認）", "Not supplied (undetermined)")}
          </option>
          <option value="MATCHED">
            {words(locale, "一致する更新を模擬", "Simulate a matching update")}
          </option>
          <option value="TIMED_OUT">
            {words(locale, "期限切れを模擬", "Simulate a timeout")}
          </option>
        </select>
      </label>
      {mode === "MATCHED" && (
        <>
          <ValueSlot
            value={result}
            onChange={(next) => {
              setResult(next);
              publish(mode, next);
            }}
            label={words(
              locale,
              "一致した受付状態（試運転用）",
              "Matched ticket state (simulation only)",
            )}
            path={`simulation-await-${statement.id}`}
            locale={locale}
            guildId={guildId}
            variables={[]}
            targets={targets}
            modes={["literal"]}
            simulation
            onValidity={validity}
          />
          <UserInstantControl
            locale={locale}
            label={words(
              locale,
              "模擬更新の発生日時（UTC）",
              "Mock event time (UTC)",
            )}
            value={occurredAt}
            onValidity={(valid) => {
              timeValid.current = valid;
              onValidity(valid);
              if (!valid) emit(undefined);
            }}
            onChange={(next) => {
              const at = next ?? "";
              setOccurredAt(at);
              publish(mode, result, at);
            }}
          />
        </>
      )}
    </section>
  );
}
