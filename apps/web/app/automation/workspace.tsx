"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlowDefinition,
  Statement,
  ValueInput,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import {
  AUTOMATION_CATALOG,
  automationValidationMessage,
} from "../../../../packages/automation/src/catalog";
import { TypeSelect } from "./type-picker";
import { ConfirmationDialog } from "../confirmation-dialog";
import {
  automationClient,
  AutomationRequestError,
  type CheckResult,
  type EditorTargets,
  type FlowDetail,
  type FlowSummary,
  type ImpactResult,
  type SimulationResult,
} from "./client";
import {
  availableVariables,
  writableVariables,
  sameType,
  branches,
  childList,
  cloneStatement,
  createDraft,
  createStatement,
  captureActionOutcome,
  procedureArea,
  matchesProcedureArea,
  locate,
  missing,
  moveStatement,
  PALETTE,
  redoEdit,
  remember,
  typeName,
  uid,
  undoEdit,
  updateDefinition,
  words,
  type HistoryState,
  type Locale,
  type PaletteCard,
} from "./model";
import { ValueSlot, literalText } from "./value-slot";
import { TriggerEditor } from "./trigger-editor";
import { BoundedWaitEditor } from "./bounded-wait-editor";
import { ResultBranchEditor, ApprovalBlockEditor } from "./result-branch-editor";
import { RepeatResultsEditor } from "./repeat-results-editor";
import { DefinitionManager } from "./definition-manager";
import { runBuiltinDeclarations } from "../../../../packages/automation/src/builtins";
import { AutomationRunPanel, IterationResultsSummary } from "./run-panel";
import {
  SimulationInputPanel,
  type SimulationInputs,
} from "./simulation-inputs";
import "./workspace.css";

const EMPTY_TARGETS: EditorTargets = {
  channels: [],
  roles: [],
  available: false,
};
export interface AutomationWorkspaceProps {
  locale: Locale;
  guildId: string;
  guildName?: string;
  timeZone?: string;
  targets?: EditorTargets;
  endpoint?: string;
  initialDefinition?: FlowDefinition;
  readOnly?: boolean;
  initialTemplate?: "schedule" | "approval" | "ticket" | "interaction";
  initialFlowId?: string;
  initialRunId?: string;
}
type Review = {
  validate?: CheckResult;
  test?: SimulationResult;
  impact?: ImpactResult;
};
type PendingRequest = {
  requestId: string;
  kind: "save" | "enable" | "disable";
};
const stateLabel = (locale: Locale, state: string) =>
  words(
    locale,
    ...(({
      DRAFT: ["下書き", "Draft"],
      ACTIVE: ["有効", "Enabled"],
      DISABLED: ["停止", "Stopped"],
      UNKNOWN: ["結果不明", "Result unknown"],
    }[state] as [string, string]) ?? ["確認が必要", "Needs review"]),
  );

export function AutomationWorkspace({
  locale,
  guildId,
  guildName,
  timeZone = "UTC",
  targets: providedTargets,
  endpoint = "/api/automation",
  initialDefinition,
  readOnly = false,
  initialTemplate,
  initialFlowId,
  initialRunId,
}: AutomationWorkspaceProps) {
  const client = useMemo(
    () => automationClient(endpoint, guildId),
    [endpoint, guildId],
  );
  const [fetchedTargets, setFetchedTargets] =
    useState<EditorTargets>(EMPTY_TARGETS);
  const targets = providedTargets ?? fetchedTargets;
  const [history, setHistory] = useState<HistoryState | undefined>(() =>
    initialDefinition
      ? {
          past: [],
          present: { definition: initialDefinition },
          future: [],
          trimmed: false,
        }
      : undefined,
  );
  const [items, setItems] = useState<FlowSummary[] | null>(null),
    [revision, setRevision] = useState(0),
    [activeRevision, setActiveRevision] = useState<number | null>(null),
    [saved, setSaved] = useState(
      initialDefinition ? JSON.stringify(initialDefinition) : "",
    ),
    [review, setReview] = useState<Review>({});
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [problem, setProblem] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState<PendingRequest | null>(null),
    [confirm, setConfirm] = useState<"enable" | "discard" | "disable" | null>(
      null,
    ),
    [nextFlow, setNextFlow] = useState<string | null>(null);
  const [scheduleReview,setScheduleReview]=useState<FlowDetail["scheduleReview"]>();
  const [query, setQuery] = useState(""),
    [view, setView] = useState<"blocks" | "steps">("blocks"),
    [panel, setPanel] = useState<"blocks" | "palette" | "details">("blocks"),
    [area, setArea] = useState("body"),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [variableQuery, setVariableQuery] = useState("");
  const [simulation, setSimulation] = useState<SimulationInputs>({
    values: {},
    outputs: {},
    outcomes: {},
  });
  const flight = useRef(false),
    epoch = useRef(0);
  const definition = history?.present.definition,
    selectedId = history?.present.selectedId;
  const dirty = Boolean(definition && JSON.stringify(definition) !== saved);
  const locked = readOnly || Boolean(busy) || Boolean(uncertain) || conflict;
  const selected =
    definition && selectedId
      ? locate(definition, selectedId)?.statement
      : undefined;
  const variables = definition
    ? availableVariables(definition, selectedId, locale)
    : [];
  const selectedProcedure = definition?.procedures?.find(
    (item) => matchesProcedureArea(area,item),
  );
  const activeBody = definition
    ? area === "detached"
      ? (definition.detached ?? [])
      : (selectedProcedure?.body ?? definition.body)
    : [];
  const availableCards = PALETTE.filter(
    (card) =>
      (card.kind !== "parallel" ||
        AUTOMATION_CATALOG.find((item) => item.id === "CT07")?.availability ===
          "available") &&
      (card.kind !== "poll" ||
        AUTOMATION_CATALOG.find((item) => item.id === "CT11")?.availability ===
          "available") &&
      (card.kind !== "awaitEvent" ||
        AUTOMATION_CATALOG.find((item) => item.id === "CT05")?.availability ===
          "available") &&
      (!["discord.addRole", "discord.removeRole"].includes(
        card.operation ?? "",
      ) ||
        AUTOMATION_CATALOG.find((item) => item.id === "DO09")?.availability ===
          "available") &&
      `${card.ja} ${card.en} ${card.aliases}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const unavailableCards = AUTOMATION_CATALOG.filter(
    (card) =>
      card.availability === "unavailable" &&
      `${card.label.ja} ${card.label.en} ${card.aliases?.join(" ") ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const checked = Boolean(
    !dirty &&
    !hasErrors &&
    revision > 0 &&
    review.validate?.valid &&
    review.validate.complete &&
    review.test?.valid &&
    review.test.complete &&
    review.test.status === "COMPLETED" &&
    review.impact?.valid &&
    review.impact.complete &&
    review.impact.productionAvailable === true &&
    review.validate.revision === revision &&
    review.test.revision === revision &&
    review.impact.revision === revision &&
    review.validate.semanticHash === review.test.semanticHash &&
    review.test.semanticHash === review.impact.semanticHash,
  );

  const showError = (error: unknown) => {
    const status = error instanceof AutomationRequestError ? error.status : 0;
    setProblem(
      status === 401
        ? words(
            locale,
            "ログインの有効期限が切れました。もう一度ログインしてください。",
            "Your sign-in expired. Sign in again.",
          )
        : status === 403
          ? words(
              locale,
              "この操作に必要な現在の権限がありません。",
              "You do not currently have permission for this action.",
            )
          : status === 409
            ? words(
                locale,
                "別の画面で変更されています。最新の版を確認してください。",
                "This draft changed elsewhere. Review the latest version.",
              )
            : status === 422 || status === 400
              ? words(
                  locale,
                  "設定を適用できません。入力と利用可能な操作を確認してください。",
                  "These settings cannot be applied. Review the inputs and available operations.",
                )
              : words(
                  locale,
                  "情報を取得できませんでした。実行や保存の成功は確認できていません。",
                  "Information could not be retrieved. Execution or save success has not been confirmed.",
                ),
    );
    if (status === 409) setConflict(true);
  };
  const adopt = (detail: FlowDetail) => {
    if (detail.definition.guildId !== guildId)
      throw new Error("GUILD_MISMATCH");
    setHistory({
      past: [],
      present: { definition: detail.definition },
      future: [],
      trimmed: false,
    });
    setSaved(JSON.stringify(detail.definition));
    setRevision(detail.draftRevision);
    setActiveRevision(detail.state === "ACTIVE" ? detail.activeRevision : null);
    setScheduleReview(detail.scheduleReview);
    setReview({});
    setSimulation({ values: {}, outputs: {}, outcomes: {} });
    setConflict(false);
    setUncertain(null);
    setFieldErrors({});
    setArea("body");
    setPanel("blocks");
  };
  useEffect(() => {
    let current = true;
    setLoading(true);
    setProblem("");
    client
      .list()
      .then(async (result) => {
        if (!current) return;
        setItems(result.items);
        if (initialFlowId && !initialDefinition) {
          const detail = await client.read(initialFlowId);
          if (!current) return;
          adopt(detail);
        } else if (initialTemplate && !initialDefinition)
          newDraft(
            initialTemplate === "schedule"
              ? "notice"
              : initialTemplate === "ticket"
                ? "wait"
                : initialTemplate,
          );
        if (current) setLoading(false);
      })
      .catch((error) => {
        if (current) {
          showError(error);
          setLoading(false);
        }
      });
    if (!providedTargets)
      Promise.all([client.targets("ChannelRef"), client.targets("RoleRef")])
        .then(([channels, roles]) => {
          if (current)
            setFetchedTargets({
              channels: channels.items,
              roles: roles.items,
              available:
                channels.state === "AVAILABLE" && roles.state === "AVAILABLE",
            });
        })
        .catch(() => {
          if (current) setFetchedTargets(EMPTY_TARGETS);
        });
    return () => {
      current = false;
      epoch.current++;
    };
    // The parent remounts this workspace when the selected server or locale changes.
  }, [client, guildId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const validity = useCallback(
    (path: string, message: string | null) =>
      setFieldErrors((previous) => {
        if ((message === null && !previous[path]) || message === previous[path])
          return previous;
        const next = { ...previous };
        if (message) next[path] = message;
        else delete next[path];
        return next;
      }),
    [],
  );
  const edit = (next: FlowDefinition, focus = selectedId) => {
    if (locked) return;
    setHistory((previous) =>
      previous
        ? remember(previous, { definition: next, selectedId: focus })
        : {
            past: [],
            present: { definition: next, selectedId: focus },
            future: [],
            trimmed: false,
          },
    );
    setReview({});
    setAnnouncement(
      words(
        locale,
        "下書きを変更しました。試運転と影響確認をやり直してください。",
        "Draft changed. Simulation and impact review must be repeated.",
      ),
    );
    setProblem("");
  };
  const modify = (
    mutation: (next: FlowDefinition) => void,
    focus = selectedId,
  ) => {
    if (definition) edit(updateDefinition(definition, mutation), focus);
  };
  const select = (id: string) => {
    setHistory((previous) =>
      previous
        ? { ...previous, present: { ...previous.present, selectedId: id } }
        : previous,
    );
    setPanel("details");
  };
  const replace = (statement: Statement) =>
    modify((next) => {
      const found = locate(next, statement.id);
      if (found) found.siblings[found.index] = statement;
    });
  const add = (card: PaletteCard, parentId?: string, branch = area) => {
    if (!definition) return;
    const statement = createStatement(card, locale);
    modify((next) => {
      const list = childList(next, parentId, branch);
      if (list) list.push(statement);
    }, statement.id);
    setPanel("details");
    setAnnouncement(
      words(locale, `${card.ja}を追加しました。`, `${card.en} added.`),
    );
  };
  const load = async (id: string) => {
    if (flight.current) return;
    flight.current = true;
    setBusy("load");
    setProblem("");
    try {
      adopt(await client.read(id));
    } catch (error) {
      showError(error);
    } finally {
      flight.current = false;
      setBusy("");
    }
  };
  const newDraft = (template = "blank") => {
    const next = createDraft(guildId, locale);
    if (template === "notice") {
      next.name = words(
        locale,
        "予定のお知らせ（下書き）",
        "Scheduled notice (draft)",
      );
      next.trigger = {
        kind: "schedule",
        schedule: {
          kind: "recurring",
          frequency: "weekly",
          time: "18:00",
          timeZone,
          startDate: "",
          endDate: "",
          weekdays: [5],
          missingTime: "skip",
          repeatedTime: "earlier",
          pastOccurrences: "skip",
        },
      };
      next.body = [
        createStatement(
          PALETTE.find((item) => item.id === "send")!,
          locale,
        ),
      ];
    }
    if (template === "wait") {
      next.name = words(
        locale,
        "受付の再確認（下書き）",
        "Recheck a ticket (draft)",
      );
      next.trigger = {
        kind: "internal",
        event: "ticketCreated",
        inputs: [
          {
            id: "event.ticket",
            name: words(
              locale,
              "運用依頼の参照",
              "Operations request reference",
            ),
            type: "TicketRef",
          },
        ],
      };
      next.body = [
        {
          id: uid(),
          kind: "wait",
          duration: { kind: "literal", type: "Duration", value: 86400 },
        },
        createStatement(
          PALETTE.find((item) => item.id === "ticket")!,
          locale,
        ),
      ];
      const read = next.body[1];
      if (read?.kind === "action") {
        read.inputs.ticket = {
          kind: "variable",
          type: "TicketRef",
          variableId: "event.ticket",
        };
        read.output = {
          id: uid(),
          name: words(locale, "受付の状態と版", "Request state and version"),
          type: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
        };
      }
    }
    if (template === "interaction") {
      next.name = words(
        locale,
        "ボタンの案内（下書き）",
        "Interaction guide (draft)",
      );
      next.trigger = { kind: "interaction", inputs: [] };
      next.body = [
        createStatement(
          PALETTE.find((item) => item.id === "branch")!,
          locale,
        ),
      ];
    }
    if (template === "approval") {
      next.name = words(
        locale,
        "限定ロールの申請（下書き）",
        "Approved role request (draft)",
      );
      next.body = [
        createStatement(
          PALETTE.find((item) => item.id === "addRole")!,
          locale,
        ),
      ];
      next.trigger = {
        kind: "interaction",
        inputs: [
          {
            id: "interaction.member",
            name: words(
              locale,
              "ボタンを押した本人",
              "Person who pressed the button",
            ),
            type: "MemberRef",
          },
        ],
      };
      const role = next.body[0];
      if (role?.kind === "action")
        role.inputs.member = {
          kind: "variable",
          type: "MemberRef",
          variableId: "interaction.member",
        };
    }
    setHistory({
      past: [],
      present: { definition: next },
      future: [],
      trimmed: false,
    });
    setRevision(0);
    setSaved("");
    setActiveRevision(null);
    setScheduleReview(undefined);
    setReview({});
    setSimulation({ values: {}, outputs: {}, outcomes: {} });
    setFieldErrors({});
    setArea("body");
    setProblem("");
    setConflict(false);
    setPanel("blocks");
    setAnnouncement(
      template === "blank"
        ? words(locale, "空の下書きを作成しました。", "Blank draft created.")
        : words(
            locale,
            "例から未有効の下書きを作成しました。表示された初期値を確認し、不足を入力してください。",
            "An inactive draft was created from an example. Review the displayed initial values and complete missing inputs.",
          ),
    );
  };
  const run = async (
    kind: "save" | "validate" | "test" | "impact" | "enable" | "disable",
  ) => {
    if (!definition || flight.current || locked) return;
    if (
      kind !== "save" &&
      kind !== "disable" &&
      (dirty || revision < 1 || hasErrors)
    )
      return;
    if (kind === "enable" && !checked) return;
    flight.current = true;
    setBusy(kind);
    setProblem("");
    const currentEpoch = epoch.current,
      requestId = uid(),
      flowId = definition.id;
    try {
      if (kind === "save") {
        const detail = await client.save(definition, revision, requestId);
        if (currentEpoch !== epoch.current) return;
        if (detail.definition.guildId !== guildId || detail.id !== flowId)
          throw new Error("SAVE_SCOPE_MISMATCH");
        setHistory((previous) =>
          previous
            ? {
                ...previous,
                present: { ...previous.present, definition: detail.definition },
              }
            : previous,
        );
        setSaved(JSON.stringify(detail.definition));
        setRevision(detail.draftRevision);
        if (detail.activeRevision !== undefined)
          setActiveRevision(detail.activeRevision);
        setReview({});
        setAnnouncement(
          words(
            locale,
            "下書きを保存しました。本番の動作は変わっていません。",
            "Draft saved. Production behavior is unchanged.",
          ),
        );
      } else if (kind === "enable" || kind === "disable") {
        const detail =
          kind === "enable"
            ? await client.enable(
                flowId,
                revision,
                review.validate!.semanticHash,
                requestId,
              )
            : await client.disable(flowId, requestId);
        if (currentEpoch !== epoch.current) return;
        setActiveRevision(kind === "disable" ? null : detail.activeRevision);
        if(kind==="enable")setScheduleReview({required:false,reason:null});
        setConfirm(null);
        setAnnouncement(
          words(
            locale,
            kind === "enable"
              ? "確認した版を有効にしました。"
              : "新しい起動を停止しました。",
            kind === "enable"
              ? "The reviewed revision is enabled."
              : "New starts have been stopped.",
          ),
        );
      } else {
        const result =
          kind === "validate"
            ? await client.validate(flowId, revision)
            : kind === "test"
              ? await client.test(flowId, revision, simulation)
              : await client.impact(flowId, revision);
        if (currentEpoch !== epoch.current) return;
        if (result.revision !== revision) throw new AutomationRequestError(409);
        if (
          kind === "test" &&
          (!("externalChanges" in result) ||
            result.externalChanges !== 0 ||
            !("productionRuns" in result) ||
            result.productionRuns !== 0 ||
            !("approvalConsumption" in result) ||
            result.approvalConsumption !== 0)
        )
          throw new Error("UNSAFE_SIMULATION_RESPONSE");
        setReview((previous) => ({ ...previous, [kind]: result }));
        setAnnouncement(
          words(
            locale,
            kind === "test"
              ? "送信なしの試運転を確認しました。"
              : "保存版の確認結果を表示しています。",
            kind === "test"
              ? "Simulation completed without sending."
              : "Review results are shown for the saved revision.",
          ),
        );
      }
      const list = await client.list();
      if (currentEpoch === epoch.current) setItems(list.items);
    } catch (error) {
      if (
        error instanceof AutomationRequestError &&
        error.uncertain &&
        ["save", "enable", "disable"].includes(kind)
      ) {
        setUncertain({ requestId, kind: kind as PendingRequest["kind"] });
        setConfirm(null);
        setProblem(
          words(
            locale,
            "保存・変更の結果を確認できません。同じ要求を再送せず、状態を照合してください。",
            "The save or change result is unknown. Check the request status without resending it.",
          ),
        );
      } else showError(error);
    } finally {
      flight.current = false;
      setBusy("");
    }
  };
  const lookup = async () => {
    if (!uncertain || flight.current) return;
    flight.current = true;
    setBusy("lookup");
    try {
      const result = await client.lookup(uncertain.requestId);
      if (result.state !== "CONFIRMED" || !result.flowId)
        throw new Error("UNCONFIRMED");
      const detail = await client.read(result.flowId);
      adopt(detail);
      setProblem("");
      setAnnouncement(
        words(
          locale,
          "保存・変更の結果を照合しました。最新の版を表示しています。",
          "The request was reconciled. The latest revision is shown.",
        ),
      );
    } catch {
      setProblem(
        words(
          locale,
          "結果はまだ確認できません。同じ要求は再送していません。しばらくして再照合してください。",
          "The result is still unconfirmed. The request has not been resent. Check again later.",
        ),
      );
    } finally {
      flight.current = false;
      setBusy("");
    }
  };
  const requestSwitch = (id: string) => {
    if (busy || uncertain || conflict || !id || (readOnly && id === "new"))
      return;
    if (dirty) {
      setNextFlow(id);
      setConfirm("discard");
    } else if (id === "new") newDraft();
    else void load(id);
  };
  const summarize = (node: Statement) => {
    if (node.kind === "action")
      return PALETTE.find((card) => card.operation === node.operation);
    if (node.kind === "random")
      return PALETTE.find((card) => card.mode === node.mode);
    return PALETTE.find((card) => card.kind === node.kind);
  };
  const tree = (
    list: Statement[],
    parentId?: string,
    branch = area,
    depth = 0,
  ) => (
    <ol
      className="automation-stack"
      data-parent={parentId}
      data-branch={branch}
      data-depth={depth}
      aria-label={words(locale, "手順の順番", "Step order")}
    >
      {list.map((node, index) => {
        const card = summarize(node),
          nested = branches(node),
          found = locate(definition!, node.id);
        return (
          <li
            key={node.id}
            className={`automation-block category-${card?.category ?? "control"} ${nested.length ? "is-container" : ""} ${node.enabled === false ? "is-disabled" : ""} ${selectedId === node.id ? "is-selected" : ""}`}
          >
            <div className="automation-block-head">
              <button
                type="button"
                className="automation-block-title"
                aria-pressed={selectedId === node.id}
                onClick={() => select(node.id)}
              >
                <span className="automation-order">{index + 1}</span>
                <span>
                  <small>
                    {words(
                      locale,
                      nested.length
                        ? "条件・繰り返しを囲む手順"
                        : "積み重ねる手順",
                      nested.length ? "Contains steps" : "Statement",
                    )}
                  </small>
                  {card
                    ? words(locale, card.ja, card.en)
                    : words(
                        locale,
                        "対応していない手順（保持）",
                        "Unsupported step (preserved)",
                      )}
                  {node.kind === "declare" && <b> · {node.variable.name}</b>}
                </span>
              </button>
              {node.enabled === false && (
                <strong>{words(locale, "今回は使わない", "Not used")}</strong>
              )}
            </div>
            <div
              className="automation-block-actions"
              aria-label={words(
                locale,
                "ドラッグ不要の編集操作",
                "Edit without dragging",
              )}
            >
              <button
                type="button"
                disabled={locked || index === 0}
                onClick={() => edit(moveStatement(definition!, node.id, "up"))}
              >
                {words(locale, "上へ", "Up")}
              </button>
              <button
                type="button"
                disabled={locked || index === list.length - 1}
                onClick={() =>
                  edit(moveStatement(definition!, node.id, "down"))
                }
              >
                {words(locale, "下へ", "Down")}
              </button>
              <button
                type="button"
                disabled={
                  locked ||
                  !branches(list[index - 1] ?? { id: "", kind: "end" }).length
                }
                onClick={() =>
                  edit(moveStatement(definition!, node.id, "inside"))
                }
              >
                {words(locale, "前の中へ", "Inside previous")}
              </button>
              <button
                type="button"
                disabled={locked || !found?.parent}
                onClick={() =>
                  edit(moveStatement(definition!, node.id, "outside"))
                }
              >
                {words(locale, "外へ", "Out")}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  const cloned = cloneStatement(node);
                  modify((next) => {
                    const location = locate(next, node.id);
                    location?.siblings.splice(location.index + 1, 0, cloned);
                  }, cloned.id);
                }}
              >
                {words(locale, "複製", "Duplicate")}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  edit(
                    moveStatement(
                      definition!,
                      node.id,
                      area === "detached" ? "restore" : "unused",
                    ),
                  )
                }
              >
                {words(
                  locale,
                  area === "detached" ? "手順へ戻す" : "保管する",
                  area === "detached" ? "Restore to steps" : "Not used",
                )}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  modify((next) => {
                    const location = locate(next, node.id);
                    location?.siblings.splice(location.index, 1);
                  }, undefined);
                  setFieldErrors({});
                }}
              >
                {words(locale, "削除", "Delete")}
              </button>
            </div>
            {nested.map((child) => (
              <section key={child.key} className="automation-cavity">
                <h4>{words(locale, child.ja, child.en)}</h4>
                {tree(child.body, node.id, child.key, depth + 1)}
                <button
                  type="button"
                  className="automation-add-inside"
                  disabled={locked}
                  onClick={() => {
                    select(node.id);
                    setPanel("palette");
                    setAnnouncement(
                      words(
                        locale,
                        `${child.ja}の追加ボタンから部品を選択してください。`,
                        `Choose a block to add ${child.en.toLowerCase()}.`,
                      ),
                    );
                    setInsertion({ parentId: node.id, branch: child.key });
                  }}
                >
                  {words(locale, "この中に追加", "Add inside")}
                </button>
              </section>
            ))}
          </li>
        );
      })}
      {list.length === 0 && (
        <li className="automation-empty-stack">
          {words(
            locale,
            "ここに手順を追加します。ドラッグは不要です。",
            "Add steps here. Dragging is optional.",
          )}
        </li>
      )}
    </ol>
  );
  const [insertion, setInsertion] = useState<{
    parentId?: string;
    branch: string;
  }>({ branch: "body" });
  const allVariables = definition
    ? collectVariables(definition, locale).filter((item) =>
        `${item.name} ${typeName(item.type)}`
          .toLowerCase()
          .includes(variableQuery.toLowerCase()),
      )
    : [];

  return (
    <section
      className="automation-workspace"
      aria-label={words(locale, "自動化を組み立てる", "Build an automation")}
      lang={locale}
    >
      <header className="automation-page-heading">
        <div>
          <p className="automation-eyebrow">NEXUS AUTOMATION</p>
          <h1>{words(locale, "自動化", "Automation")}</h1>
          <p>
            {words(
              locale,
              "きっかけと手順をつなぎ、送信せずに確かめます。",
              "Connect a start trigger and steps, then test without sending.",
            )}
          </p>
        </div>
        <span className="automation-server">
          {guildName ?? words(locale, "選択中のサーバー", "Selected server")}
        </span>
      </header>
      {readOnly && (
        <p role="status" className="automation-notice">
          {words(
            locale,
            "現在の資格では閲覧できます。編集と有効化には管理資格が必要です。",
            "Your current access allows viewing. Editing and enabling require management authority.",
          )}
        </p>
      )}
      {problem && (
        <div role="alert" className="automation-problem">
          <p>{problem}</p>
          {uncertain ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void lookup()}
            >
              {words(locale, "結果を照合する", "Check request status")}
            </button>
          ) : conflict && definition ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setNextFlow(definition.id);
                setConfirm("discard");
              }}
            >
              {words(locale, "最新の版を読み直す", "Reload latest revision")}
            </button>
          ) : items === null ? (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                client
                  .list()
                  .then((result) => {
                    setItems(result.items);
                    setProblem("");
                  })
                  .catch(showError)
                  .finally(() => setLoading(false));
              }}
            >
              {words(locale, "再取得", "Fetch again")}
            </button>
          ) : null}
          {!uncertain && (
            <a href="/servers">
              {words(locale, "サーバー選択へ戻る", "Back to server selection")}
            </a>
          )}
        </div>
      )}
      {scheduleReview?.required&&<section className="automation-notice" role="status"><strong>{words(locale,"予定の時刻を確認して再度有効化してください","Review schedule times and explicitly enable again")}</strong><p>{words(locale,
        scheduleReview.reason==="TIME_ZONE_MEANING_UNAVAILABLE"?"現在の規則で予定の時刻を確認できないため、今後の予定起動を停止しています。日時・地域・次回予定を確認し、新しい版を保存して検証・試運転・影響確認の後に明示して有効化してください。確認済みの実行結果は変わりません。":"タイムゾーンの意味や規則の変更を検出したため、今後の予定起動を停止しています。日時・地域・次回予定を確認し、新しい版を保存して検証・試運転・影響確認の後に明示して有効化してください。確認済みの実行結果は変わりません。",
        scheduleReview.reason==="TIME_ZONE_MEANING_UNAVAILABLE"?"Future scheduled starts are paused because schedule times could not be verified under current rules. Review dates, the region and next occurrences, save a new revision, validate, simulate, review impact and explicitly enable it. Confirmed run results are unchanged.":"A change in time-zone meaning or rules paused future scheduled starts. Review the dates, region and next occurrences, save a new revision, validate, simulate, review impact and explicitly enable it. Confirmed run results are unchanged.")}</p></section>}
      <p className="automation-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {loading ? (
        <p role="status">
          {words(locale, "自動化を確認しています…", "Checking automations…")}
        </p>
      ) : (
        items !== null && (
          <>
            <div className="automation-flow-picker">
              <label>
                {words(locale, "保存された自動化", "Saved automations")}
                <select
                  value={definition?.id ?? ""}
                  disabled={Boolean(busy) || Boolean(uncertain) || conflict}
                  onChange={(event) => requestSwitch(event.target.value)}
                >
                  <option value="">
                    {words(locale, "自動化を選択", "Choose an automation")}
                  </option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {stateLabel(locale, item.state)}
                    </option>
                  ))}
                  {definition &&
                    !items.some((item) => item.id === definition.id) && (
                      <option value={definition.id}>
                        {definition.name} · {words(locale, "未保存", "Unsaved")}
                      </option>
                    )}
                </select>
              </label>
              <button
                type="button"
                disabled={locked}
                onClick={() => requestSwitch("new")}
              >
                {words(locale, "空の下書きを作る", "Create a blank draft")}
              </button>
            </div>
            {!definition ? (
              <div className="automation-start">
                <h2>
                  {words(
                    locale,
                    "自動化はまだ選択されていません",
                    "Choose or create an automation",
                  )}
                </h2>
                <p>
                  {items.length === 0
                    ? words(
                        locale,
                        "自動化はまだありません。例か空の下書きから始められます。",
                        "No automations yet. Start from an example or a blank draft.",
                      )
                    : words(
                        locale,
                        "保存された手順を選ぶか、新しく組み立てます。",
                        "Choose saved steps or build something new.",
                      )}
                </p>
                <div className="automation-template-grid">
                  <button disabled={locked} onClick={() => newDraft("notice")}>
                    <strong>
                      {words(locale, "予定のお知らせ", "Scheduled notice")}
                    </strong>
                    <span>
                      {words(
                        locale,
                        "曜日・地域・送信先を設定",
                        "Choose weekdays, region and destination",
                      )}
                    </span>
                  </button>
                  <button disabled={locked} onClick={() => newDraft("wait")}>
                    <strong>
                      {words(locale, "受付の再確認", "Recheck a ticket")}
                    </strong>
                    <span>
                      {words(
                        locale,
                        "明示初期値：24時間待機。通知は未設定",
                        "Explicit initial value: wait 24 hours. Sending is not configured.",
                      )}
                    </span>
                  </button>
                  <button disabled={locked} onClick={() => newDraft()}>
                    <strong>
                      {words(locale, "自由に組み立てる", "Build your own")}
                    </strong>
                    <span>
                      {words(
                        locale,
                        "共通の型付きブロックを使う",
                        "Use the shared typed block language",
                      )}
                    </span>
                  </button>
                </div>
                <p>
                  {words(
                    locale,
                    "全プランで同じブロック言語と送信なし試運転を使います。Betaの利用枠はサーバーで確認し、購入や自動課金は行いません。",
                    "All plans share the block language and simulation. Beta capacity is checked on the server; no purchase or automatic charge is made.",
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="automation-draft-heading">
                  <label>
                    {words(locale, "自動化の名前", "Automation name")}
                    <input
                      value={definition.name}
                      maxLength={100}
                      disabled={locked}
                      onChange={(event) =>
                        modify((next) => {
                          next.name = event.target.value;
                        })
                      }
                    />
                  </label>
                  <div>
                    <strong>
                      {dirty
                        ? words(locale, "未保存の変更", "Unsaved changes")
                        : words(locale, "保存した下書き", "Saved draft")}{" "}
                      · {words(locale, "下書き版", "Draft revision")}{" "}
                      {revision || "—"}
                    </strong>
                    <small>
                      {words(locale, "有効版", "Enabled revision")}{" "}
                      {activeRevision ?? "—"} ·{" "}
                      {words(
                        locale,
                        "保存と有効化は別の操作です",
                        "Saving and enabling are separate actions",
                      )}
                    </small>
                  </div>
                </div>
                <div className="automation-toolbar">
                  <button
                    type="button"
                    disabled={locked || !history?.past.length}
                    onClick={() => {
                      setHistory((previous) =>
                        previous ? undoEdit(previous) : previous,
                      );
                      setReview({});
                      setFieldErrors({});
                    }}
                  >
                    {words(locale, "編集を戻す", "Undo edit")}
                  </button>
                  <button
                    type="button"
                    disabled={locked || !history?.future.length}
                    onClick={() => {
                      setHistory((previous) =>
                        previous ? redoEdit(previous) : previous,
                      );
                      setReview({});
                      setFieldErrors({});
                    }}
                  >
                    {words(locale, "やり直す", "Redo edit")}
                  </button>
                  <button
                    type="button"
                    className="automation-primary"
                    disabled={locked || !dirty || hasErrors}
                    onClick={() => void run("save")}
                  >
                    {busy === "save"
                      ? words(locale, "保存を確認中…", "Checking save…")
                      : words(locale, "下書きを保存", "Save draft")}
                  </button>
                  <button
                    type="button"
                    disabled={locked || dirty || revision < 1 || hasErrors}
                    onClick={() => void run("validate")}
                  >
                    {words(locale, "構造を確認", "Validate steps")}
                  </button>
                  <button
                    type="button"
                    disabled={locked || dirty || revision < 1 || hasErrors}
                    onClick={() => void run("test")}
                  >
                    {words(locale, "送信せずに試す", "Test without sending")}
                  </button>
                  <button
                    type="button"
                    disabled={locked || dirty || revision < 1 || hasErrors}
                    onClick={() => void run("impact")}
                  >
                    {words(locale, "影響を確認", "Review impact")}
                  </button>
                  <button
                    type="button"
                    className="automation-primary"
                    disabled={locked || !checked}
                    onClick={() => setConfirm("enable")}
                  >
                    {words(locale, "確認して有効にする", "Review and enable")}
                  </button>
                  {activeRevision !== null && (
                    <button
                      disabled={locked}
                      onClick={() => setConfirm("disable")}
                    >
                      {words(locale, "新規起動を停止", "Stop new starts")}
                    </button>
                  )}
                </div>
                <p className="automation-hint">
                  {words(
                    locale,
                    "Undoは現在タブの編集だけを戻します。本番の送信や承認は変わりません。",
                    "Undo changes edits in this tab only. Sent actions and approvals are unchanged.",
                  )}
                  {history?.trimmed &&
                    " " +
                      words(
                        locale,
                        "古い編集は履歴の上限により戻せません。",
                        "Older edits are no longer available because the history limit was reached.",
                      )}
                </p>
                <nav
                  className="automation-mobile-tabs"
                  aria-label={words(locale, "編集する場所", "Editor panels")}
                >
                  {(["blocks", "palette", "details"] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={panel === name}
                      onClick={() => setPanel(name)}
                    >
                      {words(
                        locale,
                        ...({
                          blocks: ["手順", "Steps"],
                          palette: ["部品を探す", "Find blocks"],
                          details: ["詳細入力", "Step details"],
                        }[name] as [string, string]),
                      )}
                    </button>
                  ))}
                </nav>
                <div className="automation-editor-grid">
                  <aside
                    className={`automation-palette mobile-${panel === "palette" ? "open" : "closed"}`}
                  >
                    <h2>{words(locale, "部品を探す", "Find blocks")}</h2>
                    <label>
                      {words(
                        locale,
                        "名前・普通の言葉で検索",
                        "Search by name or plain words",
                      )}
                      <input
                        type="search"
                        value={query}
                        placeholder={words(
                          locale,
                          "例: 足す、待つ、送る",
                          "e.g. add, wait, send",
                        )}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <p className="automation-hint">
                      {words(
                        locale,
                        "クリックで追加。条件の内側も追加ボタンから選べます。",
                        "Click to add. Use Add inside to select a branch.",
                      )}
                    </p>
                    <p className="automation-insertion">
                      {words(locale, "追加先：", "Add to: ")}
                      {insertion.parentId
                        ? words(locale, "選択した内側", "Selected branch")
                        : area === "detached"
                          ? words(locale, "今回は使わない", "Not used")
                          : words(
                              locale,
                              "現在の手順の末尾",
                              "End of current steps",
                            )}
                      <button onClick={() => setInsertion({ branch: area })}>
                        {words(locale, "末尾へ変更", "Use end")}
                      </button>
                    </p>
                    <fieldset disabled={locked}>
                      {availableCards.map((card) => (
                        <button
                          type="button"
                          key={card.id}
                          className={`automation-palette-card category-${card.category}`}
                          onClick={() =>
                            add(
                              card,
                              insertion.parentId,
                              insertion.parentId ? insertion.branch : area,
                            )
                          }
                        >
                          <span
                            className="automation-card-shape"
                            aria-hidden="true"
                          >
                            {[
                              "branch",
                              "repeat",
                              "parallel",
                              "poll",
                              "awaitEvent",
                            ].includes(card.kind)
                              ? "⊏"
                              : card.category === "value"
                                ? "▱"
                                : "▰"}
                          </span>
                          <span>
                            {words(locale, card.ja, card.en)}
                            <small>
                              {words(
                                locale,
                                card.category === "value"
                                  ? "値・計算"
                                  : card.category === "time"
                                    ? "待つ・時間"
                                    : card.category === "discord"
                                      ? "Discordの操作"
                                      : "条件・手順",
                                card.category === "value"
                                  ? "Values & calculations"
                                  : card.category === "time"
                                    ? "Wait & time"
                                    : card.category === "discord"
                                      ? "Discord actions"
                                      : "Conditions & steps",
                              )}
                            </small>
                          </span>
                          <span aria-hidden="true">＋</span>
                        </button>
                      ))}
                    </fieldset>
                    <details>
                      <summary>
                        {words(
                          locale,
                          "まだ利用できない候補",
                          "Unavailable candidates",
                        )}{" "}
                        ({unavailableCards.length})
                      </summary>
                      {unavailableCards.map((card) => (
                        <div key={card.id} className="automation-unavailable">
                          <strong>{card.label[locale]}</strong>
                          <small>
                            {card.reason?.[locale] ??
                              words(
                                locale,
                                "契約の実装と試験が必要です。",
                                "Implementation and contract tests are required.",
                              )}
                          </small>
                        </div>
                      ))}
                    </details>
                  </aside>
                  <main
                    className={`automation-canvas mobile-${panel === "blocks" ? "open" : "closed"}`}
                  >
                    <div className="automation-view-bar">
                      <div
                        role="group"
                        aria-label={words(
                          locale,
                          "同じ手順の表示方法",
                          "View the same steps",
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={view === "blocks"}
                          onClick={() => setView("blocks")}
                        >
                          {words(locale, "ブロックで編集", "Edit with blocks")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={view === "steps"}
                          onClick={() => setView("steps")}
                        >
                          {words(locale, "手順一覧", "Steps")}
                        </button>
                      </div>
                      <label>
                        {words(locale, "編集対象", "Editing")}
                        <select
                          value={area}
                          onChange={(event) => {
                            setArea(event.target.value);
                            setInsertion({ branch: event.target.value });
                            setHistory((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    present: {
                                      ...previous.present,
                                      selectedId: undefined,
                                    },
                                  }
                                : previous,
                            );
                          }}
                        >
                          <option value="body">
                            {words(locale, "主手順", "Main steps")}
                          </option>
                          {definition.procedures?.map((item) => (
                            <option
                              key={`${item.id}@${item.revision}`}
                              value={procedureArea(item.id,item.revision)}
                            >
                              {item.name} · {words(locale,"版","revision")} {item.revision}
                            </option>
                          ))}
                          <option value="detached">
                            {words(locale, "今回は使わない", "Not used")}
                          </option>
                        </select>
                      </label>
                    </div>
                    <fieldset
                      disabled={locked}
                      className="automation-definition-fields"
                    >
                      {area === "body" ? (
                        <>
                          <TriggerEditor
                            trigger={definition.trigger}
                            locale={locale}
                            timeZone={timeZone}
                            onChange={(next) =>
                              modify((current) => {
                                current.trigger = next;
                              })
                            }
                          />
                          <TargetPolicy
                            definition={definition}
                            targets={targets}
                            locale={locale}
                            onChange={(policy) =>
                              modify((next) => {
                                next.targets = policy;
                              })
                            }
                          />
                        </>
                      ) : selectedProcedure ? (
                        <section className="automation-trigger">
                          <h3>
                            {words(
                              locale,
                              "共通手順（固定版）",
                              "Shared procedure (fixed revision)",
                            )}
                          </h3>
                          <label>
                            {words(locale, "名前", "Name")}
                            <input
                              value={selectedProcedure.name}
                              onChange={(event) =>
                                modify((next) => {
                                  next.procedures!.find(
                                    (item) => item.id === selectedProcedure.id && item.revision===selectedProcedure.revision,
                                  )!.name = event.target.value;
                                })
                              }
                            />
                          </label>
                          <DeclarationList
                            locale={locale}
                            title={words(
                              locale,
                              "型付き引数",
                              "Typed arguments",
                            )}
                            values={selectedProcedure.inputs}
                            onChange={(values) =>
                              modify((next) => {
                                next.procedures!.find(
                                  (item) => item.id === selectedProcedure.id && item.revision===selectedProcedure.revision,
                                )!.inputs = values;
                              })
                            }
                          />
                          <DeclarationList
                            locale={locale}
                            title={words(
                              locale,
                              "名前付き戻り値",
                              "Named results",
                            )}
                            values={selectedProcedure.outputs}
                            onChange={(values) =>
                              modify((next) => {
                                next.procedures!.find(
                                  (item) => item.id === selectedProcedure.id && item.revision===selectedProcedure.revision,
                                )!.outputs = values;
                              })
                            }
                          />
                        </section>
                      ) : (
                        <p className="automation-notice">
                          {words(
                            locale,
                            "この領域のブロックは実行計画に入りません。元の構造と値は保持します。",
                            "Blocks here are excluded from the execution plan. Their structure and values are preserved.",
                          )}
                        </p>
                      )}
                    </fieldset>
                    <div className={`automation-tree view-${view}`}>
                      {tree(activeBody)}
                    </div>
                    <button
                      type="button"
                      disabled={locked}
                      className="automation-add-main"
                      onClick={() => {
                        setInsertion({ branch: area });
                        setPanel("palette");
                      }}
                    >
                      {words(locale, "ここに追加", "Add here")} ＋
                    </button>
                    <DefinitionManager key={definition.id} definition={definition} locale={locale} targets={targets} disabled={locked}
                      onChange={next=>edit(next)} onValidity={validity}
                      onEditProcedure={(id,revision)=>{
                        setArea(procedureArea(id,revision));setInsertion({branch:procedureArea(id,revision)});setPanel("blocks");
                        setHistory(previous=>previous?{...previous,present:{...previous.present,selectedId:undefined}}:previous);
                      }}/>
                  </main>
                  <aside
                    className={`automation-details mobile-${panel === "details" ? "open" : "closed"}`}
                  >
                    <h2>{words(locale, "選択した手順", "Selected step")}</h2>
                    <fieldset
                      disabled={locked}
                      className="automation-definition-fields"
                    >
                      {selected ? (
                        <StatementEditor
                          statement={selected}
                          onChange={replace}
                          definition={definition}
                          locale={locale}
                          variables={variables}
                          targets={targets}
                          onValidity={validity}
                          onCaptureOutcome={()=>edit(captureActionOutcome(definition,selected.id,locale))}
                        />
                      ) : (
                        <p>
                          {words(
                            locale,
                            "ブロックの名前を押すと、入力・対象・型を変更できます。",
                            "Select a block name to edit its inputs, targets and types.",
                          )}
                        </p>
                      )}
                    </fieldset>
                    <details>
                      <summary>
                        {words(locale, "変数と使用範囲", "Variables and scope")}
                      </summary>
                      <input
                        aria-label={words(
                          locale,
                          "変数を探す",
                          "Search variables",
                        )}
                        type="search"
                        value={variableQuery}
                        onChange={(event) =>
                          setVariableQuery(event.target.value)
                        }
                      />
                      {allVariables.length ? (
                        <ul>
                          {allVariables.map((item) => (
                            <li key={item.id}>
                              <strong>{item.name}</strong> ·{" "}
                              {typeName(item.type)}
                              {item.description && (
                                <small>{item.description}</small>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          {words(
                            locale,
                            "変数はまだありません。",
                            "No variables yet.",
                          )}
                        </p>
                      )}
                      <p>
                        {words(
                          locale,
                          "名前を変えても参照は維持します。並列の親・兄弟の値には代入できません。",
                          "Renaming preserves references. Parallel branches cannot assign parent or sibling values.",
                        )}
                      </p>
                    </details>
                  </aside>
                </div>
                {hasErrors && (
                  <section className="automation-problem">
                    <h2>
                      {words(
                        locale,
                        "入力を修正してください",
                        "Review these inputs",
                      )}
                    </h2>
                    <ul>
                      {Object.entries(fieldErrors).map(([path, message]) => (
                        <li key={path}>{message}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <SimulationInputPanel
                  definition={definition}
                  locale={locale}
                  targets={targets}
                  value={simulation}
                  disabled={locked}
                  onChange={(next) => {
                    setSimulation(next);
                    setReview((previous) => ({ ...previous, test: undefined }));
                  }}
                />
                <ReviewResults
                  review={review}
                  locale={locale}
                  revision={revision}
                />
                <AutomationRunPanel
                  key={definition.id}
                  locale={locale}
                  guildId={guildId}
                  endpoint={endpoint}
                  definition={definition}
                  activeRevision={activeRevision}
                  draftRevision={revision}
                  highlightRunId={initialRunId}
                  dirty={dirty}
                  targets={targets}
                  disabled={locked}
                />
              </>
            )}
          </>
        )
      )}
      {confirm && (
        <ConfirmationDialog
          label={words(
            locale,
            confirm === "enable"
              ? "確認した版を有効にする"
              : confirm === "disable"
                ? "新規起動を停止する"
                : "未保存の編集を破棄する",
            confirm === "enable"
              ? "Enable the reviewed revision"
              : confirm === "disable"
                ? "Stop new starts"
                : "Discard unsaved edits",
          )}
          busy={Boolean(busy)}
          onCancel={() => setConfirm(null)}
          className="automation-dialog"
        >
          <h2>
            {words(
              locale,
              confirm === "enable"
                ? "この版を有効にしますか"
                : confirm === "disable"
                  ? "新しい起動を停止しますか"
                  : "未保存の編集を破棄しますか",
              confirm === "enable"
                ? "Enable this revision?"
                : confirm === "disable"
                  ? "Stop new starts?"
                  : "Discard unsaved edits?",
            )}
          </h2>
          <p>
            {confirm === "enable"
              ? words(
                  locale,
                  `下書き版 ${revision} の対象・内容・件数・権限・7日以内の実行期限を確認してください。有効化は次の起点から適用します。`,
                  `Review revision ${revision}: targets, content, counts, permissions and the seven-day run deadline. Enabling applies to future starts.`,
                )
              : confirm === "disable"
                ? words(
                    locale,
                    "これからの起動を止めます。確認済みの外部操作を取り消す機能ではありません。",
                    "Future starts will stop. Confirmed external actions are not undone.",
                  )
                : words(
                    locale,
                    "現在タブの未保存編集とUndo履歴を破棄し、選んだ下書きを読みます。",
                    "Unsaved edits and Undo history in this tab will be discarded before loading the selected draft.",
                  )}
          </p>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setConfirm(null)}
          >
            {words(locale, "取消", "Cancel")}
          </button>
          <button
            type="button"
            className="automation-primary"
            disabled={Boolean(busy) || (confirm === "enable" && !checked)}
            onClick={() => {
              if (confirm === "discard") {
                const next = nextFlow;
                setConfirm(null);
                setNextFlow(null);
                if (next === "new") newDraft();
                else if (next) void load(next);
              } else void run(confirm);
            }}
          >
            {words(
              locale,
              confirm === "enable"
                ? "この版を有効にする"
                : confirm === "disable"
                  ? "新規起動を停止"
                  : "破棄して開く",
              confirm === "enable"
                ? "Enable this revision"
                : confirm === "disable"
                  ? "Stop new starts"
                  : "Discard and open",
            )}
          </button>
        </ConfirmationDialog>
      )}
    </section>
  );
}

function StatementEditor({
  statement,
  onChange,
  definition,
  locale,
  variables,
  targets,
  onValidity,
  onCaptureOutcome,
}: {
  statement: Statement;
  onChange: (statement: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  variables: VariableDeclaration[];
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
  onCaptureOutcome:()=>void;
}) {
  const writable = writableVariables(definition, statement.id);
  const slot = (
    input: ValueInput,
    label: string,
    key: string,
    update: (value: ValueInput) => void,
    integer = false,
  ) => (
    <ValueSlot
      key={`${statement.id}-${key}`}
      value={input}
      label={label}
      path={`${statement.id}.${key}`}
      locale={locale}
      variables={variables}
      targets={targets}
      guildId={definition.guildId}
      integer={integer}
      onChange={update}
      onValidity={onValidity}
      pureDefinitions={definition.pureDefinitions}
    />
  );
  const declaration = (
    value: VariableDeclaration,
    change: (value: VariableDeclaration) => void,
    allowType = true,
  ) => (
    <div className="automation-variable-editor">
      <label>
        {words(locale, "値の名前", "Value name")}
        <input
          value={value.name}
          maxLength={80}
          onChange={(event) => change({ ...value, name: event.target.value })}
        />
      </label>
      {allowType && (
        <TypeSelect
          locale={locale}
          value={value.type}
          onChange={(type) => change({ ...value, type })}
        />
      )}
    </div>
  );
  return (
    <div className="automation-statement-editor">
      {statement.kind === "action" &&
        ["discord.addRole", "discord.removeRole"].includes(
          statement.operation,
        ) &&
        AUTOMATION_CATALOG.find((item) => item.id === "DO09")?.availability !==
          "available" && (
          <p className="automation-notice">
            {AUTOMATION_CATALOG.find((item) => item.id === "DO09")?.reason?.[
              locale
            ] ??
              words(
                locale,
                "現在の安全契約では、このロール操作を本番へ有効化できません。",
                "The current safety contract does not permit production activation of this role action.",
              )}
          </p>
        )}
      <label className="automation-enabled">
        <input
          type="checkbox"
          checked={statement.enabled !== false}
          onChange={(event) =>
            onChange({ ...statement, enabled: event.target.checked })
          }
        />
        {words(
          locale,
          "このブロックと内側を使用する",
          "Use this block and its contents",
        )}
      </label>
      {statement.kind === "declare" && (
        <>
          {declaration(statement.variable, (variable) =>
            onChange({
              ...statement,
              variable,
              value:
                JSON.stringify(variable.type) ===
                JSON.stringify(statement.variable.type)
                  ? statement.value
                  : missing(variable.type),
            }),
          )}
          {slot(
            statement.value,
            words(locale, "初期値（明示入力）", "Initial value (explicit)"),
            "value",
            (value) => onChange({ ...statement, value }),
          )}
        </>
      )}
      {statement.kind === "assign" && (
        <>
          <label>
            {words(locale, "代入する変数", "Variable to assign")}
            <select
              value={statement.variableId}
              onChange={(event) => {
                const variable = writable.find(
                  (item) => item.id === event.target.value,
                );
                onChange({
                  ...statement,
                  variableId: event.target.value,
                  value: variable ? missing(variable.type) : missing("Number"),
                });
              }}
            >
              <option value="">
                {words(locale, "変数を選択", "Choose a variable")}
              </option>
              {writable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {typeName(item.type)}
                </option>
              ))}
            </select>
          </label>
          {slot(
            statement.value,
            words(locale, "入れる値", "New value"),
            "value",
            (value) => onChange({ ...statement, value }),
          )}
        </>
      )}
      {statement.kind === "branch" && (
        <>
          {slot(
            statement.condition,
            words(locale, "成立する条件", "Condition"),
            "condition",
            (condition) => onChange({ ...statement, condition }),
          )}
          <p>
            {words(
              locale,
              "成立・不成立・確認できない場合を別の内側で編集します。入力不正を不明に変えません。",
              "Edit true, false and unknown branches separately. Invalid inputs are not converted to unknown.",
            )}
          </p>
        </>
      )}
      {(statement.kind==="resultBranch"||statement.kind==="optionalBranch")&&<ResultBranchEditor statement={statement} onChange={onChange} definition={definition} locale={locale} variables={variables} targets={targets} onValidity={onValidity}/>}
      {statement.kind==="approval"&&<ApprovalBlockEditor statement={statement} onChange={onChange} definition={definition} locale={locale} variables={variables} targets={targets} onValidity={onValidity}/>}
      {statement.kind === "repeat" && (
        <>
          {statement.count
            ? slot(
                statement.count,
                words(locale, "繰り返す回数", "Repeat count"),
                "count",
                (count) => onChange({ ...statement, count }),
                true,
              )
            : slot(
                statement.list ?? missing({ kind: "List", element: "Number" }),
                words(
                  locale,
                  "開始時に固定する一覧",
                  "List to freeze at loop start",
                ),
                "list",
                (list) => onChange({ ...statement, list }),
              )}
          {declaration(
            statement.itemVariable,
            (variable) =>
              onChange({
                ...statement,
                itemVariable: variable,
                ...(statement.list
                  ? { list: missing({ kind: "List", element: variable.type }) }
                  : {}),
              }),
            Boolean(statement.list),
          )}
          <p>
            {words(
              locale,
              "開始時に回数や一覧を固定します。0回は内側を実行せず次へ進みます。",
              "The count or list is frozen at loop start. Zero repeats skip the body and continue.",
            )}
          </p>
          <RepeatResultsEditor statement={statement} onChange={onChange} definition={definition} locale={locale} targets={targets} onValidity={onValidity}/>
        </>
      )}
      {statement.kind === "wait" && (
        <>
          <label>
            {words(locale, "待機の種類", "Wait mode")}
            <select
              value={statement.until ? "until" : "duration"}
              onChange={(event) =>
                onChange({
                  id: statement.id,
                  kind: "wait",
                  enabled: statement.enabled,
                  ...(event.target.value === "until"
                    ? { until: missing("Instant") }
                    : { duration: missing("Duration") }),
                })
              }
            >
              <option value="duration">
                {words(locale, "経過時間を待つ", "Wait a duration")}
              </option>
              <option value="until">
                {words(locale, "UTCの時点まで待つ", "Wait until a UTC instant")}
              </option>
            </select>
          </label>
          {statement.until
            ? slot(
                statement.until,
                words(locale, "再開する時点", "Resume instant"),
                "until",
                (until) => onChange({ ...statement, until }),
              )
            : slot(
                statement.duration ?? missing("Duration"),
                words(locale, "待機時間", "Wait duration"),
                "duration",
                (duration) => onChange({ ...statement, duration }),
              )}
          <p>
            {words(
              locale,
              "1回の待機と処理全体は最大7日。長期予定は開始ブロックで設定します。",
              "Each wait and the entire run are limited to seven days. Use a schedule trigger for longer plans.",
            )}
          </p>
        </>
      )}
      {(statement.kind === "poll" || statement.kind === "awaitEvent") && (
        <BoundedWaitEditor
          statement={statement}
          onChange={onChange}
          definition={definition}
          locale={locale}
          variables={variables}
          targets={targets}
          onValidity={onValidity}
        />
      )}
      {statement.kind === "random" && (
        <>
          {declaration(
            statement.output,
            (output) => onChange({ ...statement, output }),
            false,
          )}
          {statement.mode === "integer" ? (
            <>
              {slot(
                statement.min ?? missing("Number"),
                words(locale, "下限（含む）", "Minimum (included)"),
                "min",
                (min) => onChange({ ...statement, min }),
                true,
              )}
              {slot(
                statement.max ?? missing("Number"),
                words(locale, "上限（含む）", "Maximum (included)"),
                "max",
                (max) => onChange({ ...statement, max }),
                true,
              )}
            </>
          ) : (
            <>
              <TypeSelect
                value={
                  statement.list &&
                  typeof statement.list.type === "object" &&
                  statement.list.type.kind === "List"
                    ? statement.list.type.element
                    : "Number"
                }
                locale={locale}
                onChange={(element) =>
                  onChange({
                    ...statement,
                    list: missing({ kind: "List", element }),
                    output: {
                      ...statement.output,
                      type: { kind: "List", element },
                    },
                  })
                }
              />
              {slot(
                statement.list ?? missing({ kind: "List", element: "Number" }),
                words(locale, "候補一覧", "Candidate list"),
                "list",
                (list) => onChange({ ...statement, list }),
              )}
              {statement.mode === "sample" &&
                slot(
                  statement.count ?? missing("Number"),
                  words(locale, "選ぶ件数", "Number to select"),
                  "count",
                  (count) => onChange({ ...statement, count }),
                  true,
                )}
            </>
          )}
          <p>
            {words(
              locale,
              "明示操作として一度だけ確定し、同じ実行の再開で引き直しません。試運転の結果は本番結果ではありません。",
              "This explicit step commits one result. Resuming the same run never redraws. Simulation results are not production results.",
            )}
          </p>
        </>
      )}
      {statement.kind === "readClock" && (
        <>
          {declaration(
            statement.output,
            (output) => onChange({ ...statement, output }),
            false,
          )}
          <p>
            {words(
              locale,
              "この手順に到達した時刻を明示取得し、結果を固定します。",
              "Explicitly read and freeze the time when this step is reached.",
            )}
          </p>
        </>
      )}
      {statement.kind === "action" && (
        <>
          {(statement.operation === "discord.sendMessage" ||
            statement.operation === "discord.editOwnMessage") && (
            <label>
              {words(locale, "投稿の作り方", "Message authoring mode")}
              <select
                value={statement.inputs.messageSpec ? "structured" : "plain"}
                onChange={(event) => {
                  const inputs = { ...statement.inputs };
                  delete inputs.content;
                  delete inputs.messageSpec;
                  onChange({
                    ...statement,
                    inputs: {
                      ...inputs,
                      ...(event.target.value === "structured"
                        ? { messageSpec: missing("LegacyMessageSpec") }
                        : { content: missing("PlainText") }),
                    },
                  });
                }}
              >
                <option value="plain">
                  {words(locale, "普通の文章", "Plain text")}
                </option>
                <option value="structured">
                  {words(
                    locale,
                    "文章の部品と埋め込みカード（Legacy）",
                    "Text parts and embed cards (Legacy)",
                  )}
                </option>
              </select>
            </label>
          )}
          {Object.entries(statement.inputs).map(([key, input]) =>
            slot(
              input,
              words(
                locale,
                ...(({
                  channel: ["対象チャンネル", "Target channel"],
                  content: ["案内文", "Message text"],
                  messageSpec: ["構造化した投稿", "Structured message"],
                  member: ["対象メンバー", "Target member"],
                  role: ["許可ロール", "Approved role"],
                  name: ["作成する名前", "Name to create"],
                  message: ["自分の投稿参照", "Owned message reference"],
                  ticket: ["受付の参照", "Ticket reference"],
                }[key] as [string, string]) ?? [key, key]),
              ),
              key,
              (value) =>
                onChange({
                  ...statement,
                  inputs: { ...statement.inputs, [key]: value },
                }),
            ),
          )}
          {statement.output &&
            declaration(
              statement.output,
              (output) => onChange({ ...statement, output }),
              false,
            )}
          {!statement.output && !statement.outcome &&
            [
              "discord.sendMessage",
              "discord.createThread",
              "discord.createChannel",
              "nexus.readTicket",
            ].includes(statement.operation) && (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...statement,
                    output: {
                      id: uid(),
                      name: words(locale, "処理の結果", "Step result"),
                      type:
                        statement.operation === "discord.sendMessage"
                          ? "MessageRef"
                          : statement.operation === "discord.createThread"
                            ? "ThreadRef"
                            : statement.operation === "discord.createChannel"
                              ? "ChannelRef"
                              : {
                                  kind: "Record",
                                  schemaId: "nexus.ticket.status.v1",
                                },
                    },
                  })
                }
              >
                {words(locale, "結果に名前を付ける", "Name the result")}
              </button>
            )}
          {statement.outcome ? declaration(statement.outcome,(outcome)=>onChange({...statement,outcome}),false) : <button type="button" onClick={onCaptureOutcome}>{words(locale,"型付き操作結果として受け取り分岐を追加","Capture the typed outcome and add its branches")}</button>}
          {statement.operation === "discord.sendMessage" ||
          statement.operation === "discord.editOwnMessage" ? (
            <MessagePreview
              text={literalText(statement.inputs.content)}
              locale={locale}
            />
          ) : null}
          {statement.operation === "discord.addRole" ||
          statement.operation === "discord.removeRole" ? (
            <p className="automation-notice">
              {words(
                locale,
                "通常の真偽値では承認できません。適格者の正式な承認・許可ロール・現在の階層を実行基盤で検証できる場合だけ実行します。",
                "A Boolean cannot grant approval. Execution requires service-issued approval, an allowlisted role and current hierarchy checks.",
              )}
            </p>
          ) : null}
        </>
      )}
      {statement.kind === "parallel" && (
        <>
          <ParallelOutputs
            statement={statement}
            onChange={onChange}
            definition={definition}
            locale={locale}
            targets={targets}
            onValidity={onValidity}
          />
          {statement.branches.map((branch, index) => (
            <div key={branch.id}>
              <label>
                {words(
                  locale,
                  `枝 ${index + 1} の名前`,
                  `Branch ${index + 1} name`,
                )}
                <input
                  value={branch.name}
                  onChange={(event) =>
                    onChange({
                      ...statement,
                      branches: statement.branches.map((item, i) =>
                        i === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                disabled={statement.branches.length <= 2}
                onClick={() =>
                  onChange({
                    ...statement,
                    branches: statement.branches.filter(
                      (item) => item.id !== branch.id,
                    ),
                    outputs: Object.fromEntries(
                      Object.entries(statement.outputs ?? {}).filter(
                        ([, binding]) => binding.branchId !== branch.id,
                      ),
                    ),
                  })
                }
              >
                {words(
                  locale,
                  "この枝と中の手順を削除",
                  "Delete this branch and its steps",
                )}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={statement.branches.length >= 3}
            onClick={() =>
              onChange({
                ...statement,
                branches: [
                  ...statement.branches,
                  {
                    id: uid(),
                    name: words(
                      locale,
                      `枝 ${statement.branches.length + 1}`,
                      `Branch ${statement.branches.length + 1}`,
                    ),
                    body: [],
                  },
                ],
              })
            }
          >
            {words(locale, "並列の枝を追加", "Add a parallel branch")}
          </button>
          <p>
            {words(
              locale,
              "枝は2〜3本で、互いに独立します。親や兄弟の変数を上書きせず、開始した全ての枝が完了してから進みます。待機・承認・失敗・結果不明を完了に置き換えません。",
              "Use two or three independent branches. Parent and sibling variables cannot be overwritten. Continue after all started branches complete; waiting, approval, failure and unknown outcomes are not completion.",
            )}
          </p>
        </>
      )}
      {statement.kind === "call" && (
        <>
          <label>
            {words(
              locale,
              "固定版の共通手順",
              "Fixed-revision shared procedure",
            )}
            <select
              value={`${statement.procedureId}@${statement.revision}`}
              onChange={(event) => {
                const procedure = definition.procedures?.find(
                  (item) => `${item.id}@${item.revision}` === event.target.value,
                );
                onChange({
                  ...statement,
                  procedureId: procedure?.id??"",
                  revision: procedure?.revision ?? 1,
                  args: Object.fromEntries(
                    (procedure?.inputs ?? []).map((item) => [
                      item.id,
                      missing(item.type),
                    ]),
                  ),
                  outputs: Object.fromEntries(
                    (procedure?.outputs ?? []).map((item) => [
                      item.id,
                      { ...item, id: uid() },
                    ]),
                  ),
                });
              }}
            >
              <option value="">
                {words(locale, "手順を選択", "Choose a procedure")}
              </option>
              {definition.procedures?.map((item) => (
                <option key={`${item.id}@${item.revision}`} value={`${item.id}@${item.revision}`}>
                  {item.name} · {words(locale, "版", "revision")}{" "}
                  {item.revision}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(statement.args).map(([id, input]) =>
            slot(
              input,
              definition.procedures
                ?.find((item) => item.id === statement.procedureId&&item.revision===statement.revision)
                ?.inputs.find((item) => item.id === id)?.name ??
                words(locale, "引数", "Argument"),
              id,
              (value) =>
                onChange({
                  ...statement,
                  args: { ...statement.args, [id]: value },
                }),
            ),
          )}
          <p>
            {words(
              locale,
              "再帰は使えません。子の変更を既存の親へ自動適用しません。",
              "Recursion is not allowed. Child edits do not automatically replace a saved parent revision.",
            )}
          </p>
        </>
      )}
      {statement.kind === "return" && (
        <>
          {definition.procedures
            ?.find((item) =>
              locate(
                {
                  ...definition,
                  body: item.body,
                  detached: [],
                  procedures: [],
                },
                statement.id,
              ),
            )
            ?.outputs.map((output) =>
              slot(
                statement.values[output.id] ?? missing(output.type),
                output.name,
                output.id,
                (value) =>
                  onChange({
                    ...statement,
                    values: { ...statement.values, [output.id]: value },
                  }),
              ),
            )}
          <p>
            {words(
              locale,
              "全ての正常経路で宣言した結果を返します。失敗・中止・結果不明を成功へ変えません。",
              "Return every declared result on all successful paths. Failure, cancellation and unknown outcomes do not become success.",
            )}
          </p>
        </>
      )}
      {statement.kind === "break" || statement.kind === "continue" ? (
        <p>
          {words(
            locale,
            "直近の有限繰り返しだけを操作します。親手順・並列・承認・待機の境界を越えられません。",
            "Only the nearest finite loop can be controlled. Procedure, parallel, approval and wait boundaries cannot be crossed.",
          )}
        </p>
      ) : null}
      {statement.kind === "end" && (
        <p>
          {words(
            locale,
            "主手順全体の終了要求です。子の戻り値や枝の終了とは区別します。",
            "This requests the end of the entire main run. It is distinct from returning a result or finishing a branch.",
          )}
        </p>
      )}
    </div>
  );
}
function ParallelOutputs({
  statement,
  onChange,
  definition,
  locale,
  targets,
  onValidity,
}: {
  statement: Extract<Statement, { kind: "parallel" }>;
  onChange: (node: Statement) => void;
  definition: FlowDefinition;
  locale: Locale;
  targets: EditorTargets;
  onValidity: (path: string, message: string | null) => void;
}) {
  const writable = writableVariables(definition, statement.id);
  return (
    <fieldset>
      <legend>
        {words(locale, "合流時に受け取る結果", "Results received at the join")}
      </legend>
      <p className="automation-hint">
        {words(
          locale,
          "枝の最後で明示した結果だけを受け取ります。全枝が正常に完了したとき、型の合う既存の親変数へ一度に代入します。",
          "Only explicitly declared final branch results are received. When all branches complete normally, matching existing parent locals are assigned together.",
        )}
      </p>
      {statement.branches.map((branch, index) => {
        const sentinel = `join-output-${branch.id}`;
        const copy = structuredClone(definition);
        const location = locate(copy, statement.id)?.statement;
        if (location?.kind === "parallel")
          location.branches[index]!.body.push({ id: sentinel, kind: "end" });
        const variables = availableVariables(copy, sentinel, locale);
        const setOutputs = (
          outputs: Record<string, ValueInput>,
          mappings = statement.outputs,
        ) =>
          onChange({
            ...statement,
            branches: statement.branches.map((item) =>
              item.id === branch.id ? { ...item, outputs } : item,
            ),
            outputs: mappings,
          });
        return (
          <section key={branch.id}>
            <h4>{branch.name}</h4>
            {Object.entries(branch.outputs ?? {}).map(([outputId, input]) => {
              const mapped =
                Object.entries(statement.outputs ?? {}).find(
                  ([, binding]) =>
                    binding.branchId === branch.id &&
                    binding.outputId === outputId,
                )?.[0] ?? "";
              return (
                <fieldset key={outputId}>
                  <legend>{words(locale, "枝の結果", "Branch result")}</legend>
                  <label>
                    {words(
                      locale,
                      "結果の名前（英数字・記号）",
                      "Result identifier (letters, numbers and symbols)",
                    )}
                    <input
                      value={outputId}
                      onChange={(event) => {
                        const name = event.target.value;
                        if (
                          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(name) ||
                          name in (branch.outputs ?? {})
                        )
                          return;
                        const outputs = Object.fromEntries(
                          Object.entries(branch.outputs ?? {}).map(
                            ([key, item]) => [
                              key === outputId ? name : key,
                              item,
                            ],
                          ),
                        );
                        setOutputs(
                          outputs,
                          Object.fromEntries(
                            Object.entries(statement.outputs ?? {}).map(
                              ([key, binding]) => [
                                key,
                                binding.branchId === branch.id &&
                                binding.outputId === outputId
                                  ? { ...binding, outputId: name }
                                  : binding,
                              ],
                            ),
                          ),
                        );
                      }}
                    />
                  </label>
                  <TypeSelect
                    value={input.type}
                    locale={locale}
                    onChange={(type) =>
                      setOutputs({
                        ...branch.outputs,
                        [outputId]: missing(type),
                      })
                    }
                  />
                  <ValueSlot
                    value={input}
                    onChange={(value) =>
                      setOutputs({ ...branch.outputs, [outputId]: value })
                    }
                    locale={locale}
                    label={words(
                      locale,
                      "枝が返す値",
                      "Value returned by the branch",
                    )}
                    path={`${statement.id}.branch-output.${branch.id}.${outputId}`}
                    variables={variables}
                    targets={targets}
                    pureDefinitions={definition.pureDefinitions}
                    guildId={definition.guildId}
                    onValidity={onValidity}
                  />
                  <label>
                    {words(
                      locale,
                      "合流後に受け取る親変数",
                      "Parent local receiving this result",
                    )}
                    <select
                      value={mapped}
                      onChange={(event) => {
                        const mappings = Object.fromEntries(
                          Object.entries(statement.outputs ?? {}).filter(
                            ([, binding]) =>
                              binding.branchId !== branch.id ||
                              binding.outputId !== outputId,
                          ),
                        );
                        if (event.target.value)
                          mappings[event.target.value] = {
                            branchId: branch.id,
                            outputId,
                          };
                        onChange({ ...statement, outputs: mappings });
                      }}
                    >
                      <option value="">
                        {words(
                          locale,
                          "受け取らない",
                          "Do not publish to the parent",
                        )}
                      </option>
                      {writable
                        .filter((variable) =>
                          sameType(variable.type, input.type),
                        )
                        .map((variable) => (
                          <option key={variable.id} value={variable.id}>
                            {variable.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setOutputs(
                        Object.fromEntries(
                          Object.entries(branch.outputs ?? {}).filter(
                            ([key]) => key !== outputId,
                          ),
                        ),
                        Object.fromEntries(
                          Object.entries(statement.outputs ?? {}).filter(
                            ([, binding]) =>
                              binding.branchId !== branch.id ||
                              binding.outputId !== outputId,
                          ),
                        ),
                      )
                    }
                  >
                    {words(locale, "この結果を削除", "Delete this result")}
                  </button>
                </fieldset>
              );
            })}
            <button
              type="button"
              disabled={Object.keys(branch.outputs ?? {}).length >= 20}
              onClick={() => {
                let number = 1;
                while (`result${number}` in (branch.outputs ?? {})) number++;
                setOutputs({
                  ...branch.outputs,
                  [`result${number}`]: missing("PlainText"),
                });
              }}
            >
              {words(
                locale,
                "枝の名前付き結果を追加",
                "Add a named branch result",
              )}
            </button>
          </section>
        );
      })}
    </fieldset>
  );
}

function DeclarationList({
  values,
  onChange,
  title,
  locale,
}: {
  values: VariableDeclaration[];
  onChange: (values: VariableDeclaration[]) => void;
  title: string;
  locale: Locale;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {values.map((item, index) => (
        <div key={item.id}>
          <label>
            {words(locale, "名前", "Name")}
            <input
              value={item.name}
              onChange={(event) =>
                onChange(
                  values.map((current, i) =>
                    i === index
                      ? { ...current, name: event.target.value }
                      : current,
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
                values.map((current, i) =>
                  i === index ? { ...current, type } : current,
                ),
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...values,
            {
              id: uid(),
              name: words(locale, "新しい値", "New value"),
              type: "Number",
            },
          ])
        }
      >
        {words(locale, "項目を追加", "Add a field")}
      </button>
    </fieldset>
  );
}
function TargetPolicy({
  definition,
  targets,
  locale,
  onChange,
}: {
  definition: FlowDefinition;
  targets: EditorTargets;
  locale: Locale;
  onChange: (value: NonNullable<FlowDefinition["targets"]>) => void;
}) {
  const policy = definition.targets ?? {
    channelIds: [],
    roleIds: [],
    parentCategoryIds: [],
  };
  const [query, setQuery] = useState("");
  const groups = [
    {
      key: "channelIds" as const,
      label: words(
        locale,
        "送信・スレッド等を許可するチャンネル",
        "Allowed destinations and thread channels",
      ),
      items: targets.channels.filter(
        (item) =>
          !["4", "GuildCategory", "category"].includes(String(item.type ?? "")),
      ),
    },
    {
      key: "roleIds" as const,
      label: words(
        locale,
        "付け外しを許可する通常ロール",
        "Ordinary roles allowed for assignment/removal",
      ),
      items: targets.roles,
    },
    {
      key: "parentCategoryIds" as const,
      label: words(
        locale,
        "チャンネル作成を許可するカテゴリ",
        "Allowed parent categories for channel creation",
      ),
      items: targets.channels.filter((item) =>
        ["4", "GuildCategory", "category"].includes(String(item.type ?? "")),
      ),
    },
  ];
  return (
    <details className="automation-target-policy">
      <summary>
        {words(
          locale,
          "この自動化の操作対象を明示する",
          "Choose this automation’s allowed targets",
        )}
      </summary>
      <p>
        {words(
          locale,
          "操作の入力先とは別に、利用を許可する範囲を選びます。選ぶだけでは送信・ロール変更・有効化を行いません。現在の権限と正式承認は毎回確認します。",
          "Choose an allowed scope separately from individual step inputs. Selection alone sends nothing, changes no role and enables nothing. Current authority and formal approvals are still checked.",
        )}
      </p>
      {!targets.available ? (
        <p role="status">
          {words(
            locale,
            "対象を取得できませんでした。確認できるまで新しい対象は選べません。",
            "Targets could not be retrieved. New targets cannot be selected until they are verified.",
          )}
        </p>
      ) : (
        <>
          <label>
            {words(locale, "対象名を検索", "Search target names")}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {groups.map((group) => (
            <fieldset key={group.key}>
              <legend>{group.label}</legend>
              {group.items
                .filter((item) =>
                  item.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((item) => (
                  <label key={item.id} className="automation-target-check">
                    <input
                      type="checkbox"
                      checked={policy[group.key].includes(item.id)}
                      onChange={(event) =>
                        onChange({
                          ...policy,
                          [group.key]: event.target.checked
                            ? [...policy[group.key], item.id]
                            : policy[group.key].filter((id) => id !== item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              {group.items.length === 0 && (
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
                  `${policy[group.key].length}件を明示許可`,
                  `${policy[group.key].length} explicitly allowed`,
                )}
              </small>
            </fieldset>
          ))}
        </>
      )}
    </details>
  );
}
function collectVariables(
  definition: FlowDefinition,
  locale: Locale,
): VariableDeclaration[] {
  const result = [
    ...runBuiltinDeclarations(locale),
    ...definition.variables,
    ...("inputs" in definition.trigger ? definition.trigger.inputs : []),
  ];
  const visit = (list: Statement[]) => {
    for (const node of list) {
      if (node.kind === "declare") result.push(node.variable);
      if (
        node.kind === "random" ||
        node.kind === "readClock" ||
        node.kind === "poll" ||
        node.kind === "awaitEvent"
      )
        result.push(node.output);
      if (node.kind === "repeat") result.push(node.itemVariable);
      if (node.kind === "action" && node.output) result.push(node.output);
      if(node.kind==="action"&&node.outcome)result.push(node.outcome);
      if(node.kind==="resultBranch") {result.push(node.output);if(node.reason)result.push(node.reason);}
      if(node.kind==="optionalBranch")result.push(node.output);
      if(node.kind==="repeat")result.push(...(node.results??[]).map(item=>item.output));
      for (const branch of branches(node)) visit(branch.body);
    }
  };
  visit(definition.body);
  for (const procedure of definition.procedures ?? []) {
    result.push(...procedure.inputs, ...procedure.outputs);
    visit(procedure.body);
  }
  return result;
}
function MessagePreview({
  text,
  locale,
}: {
  text: string | undefined;
  locale: Locale;
}) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  return (
    <section className="automation-message-preview">
      <h3>{words(locale, "概略プレビュー", "Approximate preview")}</h3>
      <div
        role="group"
        aria-label={words(locale, "プレビューの幅", "Preview width")}
      >
        <button
          type="button"
          aria-pressed={width === "desktop"}
          onClick={() => setWidth("desktop")}
        >
          PC
        </button>
        <button
          type="button"
          aria-pressed={width === "mobile"}
          onClick={() => setWidth("mobile")}
        >
          {words(locale, "モバイル", "Mobile")}
        </button>
      </div>
      <div className={`automation-message is-${width}`}>
        {text ??
          words(
            locale,
            "実行時に評価します。未設定・変数は本番値へ補完しません。",
            "Evaluated at run time. Missing values and variables are not filled with example data.",
          )}
      </div>
      <small>
        {text === undefined
          ? words(
              locale,
              "展開後の長さは実行前にも検証します。",
              "Expanded length is also checked before execution.",
            )
          : `${text.length} / 2000`}
      </small>
      <strong>
        {words(
          locale,
          "メンション通知：既定で無効",
          "Mention notifications: off by default",
        )}
      </strong>
      <small>
        {words(
          locale,
          "プレビューは送信せず、Discordの実表示との完全一致を保証しません。",
          "The preview sends nothing and does not guarantee an exact Discord rendering.",
        )}
      </small>
    </section>
  );
}
function ReviewResults({
  review,
  locale,
  revision,
}: {
  review: Review;
  locale: Locale;
  revision: number;
}) {
  const checks = Object.entries(review).filter(([, value]) =>
    Boolean(value),
  ) as [keyof Review, CheckResult][];
  if (!checks.length) return null;
  return (
    <section className="automation-review">
      <h2>{words(locale, "保存版の確認結果", "Saved-revision review")}</h2>
      {checks.map(([kind, result]) => (
        <article key={kind}>
          <h3>
            {words(
              locale,
              ...({
                validate: ["構造の検証", "Structure validation"],
                test: ["送信なし試運転（模擬）", "Mocked simulation"],
                impact: ["影響確認", "Impact review"],
              }[kind] as [string, string]),
            )}{" "}
            · {words(locale, "版", "revision")} {result.revision}
          </h3>
          <p>
            {result.revision !== revision
              ? words(
                  locale,
                  "古い版の結果です。もう一度確認してください。",
                  "This result is for an older revision. Review again.",
                )
              : result.valid && result.complete
                ? words(
                    locale,
                    "この保存版の確認が完了しました。実行直前にも認可と制限を確認します。",
                    "Review completed for this saved revision. Authorization and limits are checked again before execution.",
                  )
                : words(
                    locale,
                    "不足または不正な設定があります。",
                    "Some settings are missing or invalid.",
                  )}
          </p>
          {result.issues?.length > 0 && (
            <ul>
              {result.issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {automationValidationMessage(issue, locale)}
                </li>
              ))}
            </ul>
          )}
          {kind === "test" && (
            <>
              <strong>
                {words(locale, "模擬結果", "Mock result")}:{" "}
                {words(
                  locale,
                  ...({
                    COMPLETED: ["完了", "Completed"],
                    FAILED: ["失敗", "Failed"],
                    UNDETERMINED: [
                      "未確認の入力・結果あり",
                      "Undetermined input or outcome",
                    ],
                    UNKNOWN: ["結果不明を模擬", "Unknown outcome simulated"],
                  }[review.test?.status ?? "UNDETERMINED"] as [string, string]),
                )}
              </strong>
              <p>
                {words(
                  locale,
                  "実送信 0件・本番実行 0件・承認消費 0件。模擬入力と模擬結果で評価し、実Discordの現在状態は確認しません。未指定の結果は未確認です。模擬値は本番へ反映されません。",
                  "External changes 0 · Production runs 0 · Approvals consumed 0. Evaluation uses mock inputs and outcomes, without checking live Discord state. Omitted results are undetermined. Mock values never replace production inputs.",
                )}
              </p>
              {review.test?.iterations&&<IterationResultsSummary items={review.test.iterations} locale={locale}/>}
            </>
          )}
          {kind === "impact" && (
            <>
              {review.impact?.productionAvailable !== true && (
                <p className="automation-notice">
                  {words(
                    locale,
                    "本番の利用条件を確認できていません。対象PCの測定、現在の利用権、採用済みの操作と起点がそろうまで有効化できません。",
                    "Production availability is not verified. Activation is blocked until host measurement, current entitlement, adopted actions and trigger admission are ready.",
                  )}
                </p>
              )}
              <p>
                {words(
                  locale,
                  "登録された外部操作",
                  "Registered external operations",
                )}
                :{" "}
                {Array.isArray(review.impact?.plannedActions)
                  ? review.impact.plannedActions.length
                  : words(locale, "未確認", "Unconfirmed")}{" "}
                · {words(locale, "待機", "Waits")}:{" "}
                {Array.isArray(review.impact?.waits)
                  ? review.impact.waits.length
                  : words(locale, "未確認", "Unconfirmed")}
              </p>
              <p>
                {words(
                  locale,
                  "実行期限は最大7日。再開に必要な最小状態は終了後7日以内に削除し、本文や変数の内容を実行ログへ記録しません。",
                  "The run deadline is at most seven days. Minimal resumable state is deleted within seven days after completion; execution logs do not contain message text or variable contents.",
                )}
              </p>
            </>
          )}
        </article>
      ))}
    </section>
  );
}

export default AutomationWorkspace;
