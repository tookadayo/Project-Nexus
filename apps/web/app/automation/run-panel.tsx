"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlowDefinition,
  ValueInput,
} from "../../../../packages/automation/src/types";
import { ConfirmationDialog } from "../confirmation-dialog";
import {
  automationClient,
  AutomationRequestError,
  type EditorTargets,
  type RuntimeOverview,
  type AutomationRunDetail,
  type ParallelRunStatus,
  type IterationResultSummary,
  type IterationState,
} from "./client";
import { PALETTE, uid, words, type Locale } from "./model";
import { ValueSlot } from "./value-slot";

type Approval = Awaited<
  ReturnType<ReturnType<typeof automationClient>["approvals"]>
>["items"][number];
const statusName = (locale: Locale, state: string) => {
  const labels: Record<string, [string, string]> = {
    QUEUED: ["開始待ち", "Queued"],
    RUNNING: ["実行中", "Running"],
    WAITING: ["待機中", "Waiting"],
    WAITING_APPROVAL: ["承認待ち", "Awaiting approval"],
    SUCCEEDED: ["完了", "Completed"],
    COMPLETED: ["完了", "Completed"],
    FAILED: ["失敗", "Failed"],
    CANCELLED: ["中止", "Cancelled"],
    EXPIRED: ["期限切れ", "Expired"],
    UNKNOWN: ["結果不明・再送停止", "Result unknown · resending stopped"],
    RUNNABLE: ["実行可能", "Runnable"],
    RECONCILING: ["結果を照合中", "Checking result"],
    STARTED: ["開始を受付済み", "Start admitted"],
    ADMITTED: ["開始を受付済み", "Start admitted"],
    DISCARDED: ["開始しない", "Not started"],
    DUPLICATE: ["重複を除外", "Duplicate skipped"],
    PENDING: ["イベント受付待ち", "Event pending admission"],
    SKIPPED: ["開始しない", "Not started"],
  };
  return words(
    locale,
    ...(labels[state] ?? ["状態の確認が必要", "Status needs review"]),
  );
};
export function AutomationRunPanel({
  locale,
  guildId,
  endpoint,
  definition,
  activeRevision,
  draftRevision,
  dirty,
  targets,
  disabled,
  highlightRunId,
}: {
  locale: Locale;
  guildId: string;
  endpoint: string;
  definition: FlowDefinition;
  activeRevision: number | null;
  draftRevision: number;
  dirty: boolean;
  targets: EditorTargets;
  disabled: boolean;
  highlightRunId?: string;
}) {
  const client = useMemo(
    () => automationClient(endpoint, guildId),
    [endpoint, guildId],
  );
  const [overview, setOverview] = useState<RuntimeOverview | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState<string | null>(null),
    [values, setValues] = useState<Record<string, ValueInput>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [approvals, setApprovals] = useState<Approval[] | null>(null),
    [review, setReview] = useState<
      | { kind: "start" }
      | { kind: "approval"; item: Approval; decision: "APPROVE" | "REJECT" }
      | { kind: "cancel"; runId: string }
      | null
    >(null);
  const flight = useRef(false);
  const [runDetails, setRunDetails] = useState<
    Record<string, AutomationRunDetail>
  >({});
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [eventReceipts, setEventReceipts] = useState<
    Awaited<ReturnType<typeof client.eventReceipts>>["items"] | null
  >(null);
  const [eventError, setEventError] = useState(false);
  useEffect(() => {
    setRunDetails({});
    setDetailError(null);
    setEventReceipts(null);
    setEventError(false);
  }, [definition.id]);
  const loadDetail = async (runId: string) => {
    if (detailBusy) return;
    setDetailBusy(runId);
    setDetailError(null);
    try {
      const detail = await client.run(runId);
      if (detail.id !== runId || detail.flowId !== definition.id)
        throw new Error("RUN_SCOPE");
      setRunDetails((previous) => ({ ...previous, [runId]: detail }));
    } catch {
      setDetailError(
        words(
          locale,
          "実行の詳細を確認できません。現在の状態を成功扱いにはしていません。",
          "Run details could not be verified. This has not been treated as success.",
        ),
      );
    } finally {
      setDetailBusy(null);
    }
  };
  const flowRuns =
    overview?.runs.filter((run) => run.flowId === definition.id) ?? [];
  useEffect(() => {
    if (highlightRunId && flowRuns.some((run) => run.id === highlightRunId)) {
      const target = document.getElementById(
        `automation-run-${highlightRunId}`,
      );
      target?.scrollIntoView({ block: "center" });
      target?.focus();
    }
  }, [overview, highlightRunId, definition.id]);
  const refresh = useCallback(async () => {
    try {
      setOverview(await client.overview());
    } catch {
      setOverview(null);
      setMessage(
        words(
          locale,
          "実行と利用枠を取得できませんでした。0件とは判定していません。",
          "Runs and usage could not be retrieved. This has not been treated as zero.",
        ),
      );
    }
  }, [client, locale]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const validity = useCallback(
    (path: string, error: string | null) =>
      setErrors((previous) => {
        const next = { ...previous };
        if (error) next[path] = error;
        else delete next[path];
        return next;
      }),
    [],
  );
  const inputs =
    definition.trigger.kind === "manual" ? definition.trigger.inputs : [];
  const complete =
    inputs.every((input) => values[input.id]?.kind === "literal") &&
    Object.keys(errors).length === 0;
  const canStart = Boolean(
    !disabled &&
    !dirty &&
    definition.trigger.kind === "manual" &&
    activeRevision !== null &&
    activeRevision === draftRevision &&
    complete &&
    overview?.status === "AVAILABLE",
  );
  const mutate = async () => {
    if (!review || flight.current || uncertain) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    const requestId = uid();
    try {
      if (review.kind === "start") {
        if (!canStart) return;
        await client.start(
          definition.id,
          Object.fromEntries(
            inputs.map((input) => {
              const value = values[input.id];
              if (value?.kind !== "literal") throw new Error("MISSING_INPUT");
              return [input.id, { type: input.type, value: value.value }];
            }),
          ),
          requestId,
        );
        setMessage(
          words(
            locale,
            "本番実行の受付を確認しました。状態は下の記録で確認してください。",
            "Production run admission was confirmed. Review its status below.",
          ),
        );
      } else if (review.kind === "approval") {
        await client.decide(
          review.item.id,
          review.decision,
          review.item.fingerprint,
          requestId,
          review.item.policyFingerprint ?? undefined,
        );
        setApprovals(await client.approvals().then((result) => result.items));
        setMessage(
          words(
            locale,
            "固定された内容への判断を保存しました。現在の権限は操作前にも再確認します。",
            "The decision for the fixed request was saved. Current authority is checked again before the operation.",
          ),
        );
      } else {
        await client.cancel(review.runId, requestId);
        setMessage(
          words(
            locale,
            "中止要求を確認しました。開始済みの外部操作は結果を確認します。",
            "Cancellation was requested. Already-started external actions still require result confirmation.",
          ),
        );
      }
      setReview(null);
      await refresh();
    } catch (error) {
      if (error instanceof AutomationRequestError && error.uncertain) {
        setUncertain(requestId);
        setReview(null);
        setMessage(
          words(
            locale,
            "操作の結果を確認できません。同じ要求は再送せず、新しい変更を停止しています。実行記録と管理者の照合を確認してください。",
            "The result is unknown. The request has not been resent and new changes are stopped. Review the run evidence and reconciliation.",
          ),
        );
      } else
        setMessage(
          words(
            locale,
            "操作を受け付けたことを確認できません。現在の権限・利用枠・対象・保存版を確認してください。",
            "Admission could not be confirmed. Check current authority, usage, targets and the saved revision.",
          ),
        );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const refLabel = (key: string, value: unknown) => {
    if (value && typeof value === "object" && "value" in value)
      value = (value as { value: unknown }).value;
    if (value && typeof value === "object" && "id" in value) {
      const id = String((value as { id: unknown }).id);
      return (
        [...targets.roles, ...targets.channels].find((item) => item.id === id)
          ?.name ?? `${words(locale, "対象参照", "Target reference")}: ${id}`
      );
    }
    return words(
      locale,
      key === "member" ? "本人に結び付いた対象メンバー" : "固定された対象",
      "Fixed target",
    );
  };
  return (
    <section className="automation-run-panel">
      <h2>
        {words(locale, "実行・承認・利用枠", "Runs, approvals and usage")}
      </h2>
      {message && (
        <p role="status" className="automation-notice">
          {message}
        </p>
      )}
      {uncertain && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (flight.current) return;
            flight.current = true;
            setBusy(true);
            try {
              const result = await client.lookup(uncertain);
              if (result.state !== "CONFIRMED") throw new Error("UNCONFIRMED");
              setUncertain(null);
              setMessage(
                words(
                  locale,
                  "要求の受付結果を照合しました。外部操作の成否は実行記録で確認してください。",
                  "The request was reconciled. Check run evidence for the outcome of external actions.",
                ),
              );
              await refresh();
            } catch {
              setMessage(
                words(
                  locale,
                  "要求の結果はまだ確認できません。再送はしていません。",
                  "The request is still unconfirmed. It has not been resent.",
                ),
              );
            } finally {
              flight.current = false;
              setBusy(false);
            }
          }}
        >
          {words(locale, "要求の結果を照合", "Check pending request")}
        </button>
      )}
      {overview ? (
        <>
          <dl className="automation-usage">
            {(
              [
                ["limit", "枠の上限", "Limit"],
                ["consumed", "消費済み", "Consumed"],
                ["reserved", "予約中", "Reserved"],
                ["compensated", "補填", "Compensated"],
                ["remaining", "残り", "Remaining"],
              ] as const
            ).map(([key, ja, en]) => (
              <div key={key}>
                <dt>{words(locale, ja, en)}</dt>
                <dd>{overview.usage[key]}</dd>
              </div>
            ))}
          </dl>
          <p className="automation-hint">
            {words(locale, "更新時刻", "Updated")} {overview.usage.updatedAt} ·{" "}
            {words(
              locale,
              "1トップレベル実行で1回。保存・送信なし試運転は0回。",
              "One top-level run uses one execution. Saving and simulation use zero.",
            )}
          </p>
          {overview.status !== "AVAILABLE" && (
            <p className="automation-notice">
              {words(
                locale,
                "対象PCの容量測定が未確認のため、本番開始は停止しています。下書きと試運転は使えます。",
                "Production starts are stopped until host capacity is verified. Drafts and simulation remain available.",
              )}
            </p>
          )}
        </>
      ) : (
        <p>
          {words(
            locale,
            "実行記録・利用枠は未取得です。",
            "Run evidence and usage are unavailable.",
          )}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        {words(locale, "実行状態を再取得", "Refresh run status")}
      </button>
      {definition.trigger.kind === "manual" && (
        <details>
          <summary>
            {words(locale, "本番の手動実行", "Manual production run")}
          </summary>
          <p>
            {words(
              locale,
              "本番実行はDiscordの投稿・ロール等を変更し、1回分の枠を使います。試運転とは別です。",
              "A production run may change Discord messages, roles or other permitted targets, and uses one execution. This is separate from simulation.",
            )}
          </p>
          <fieldset disabled={disabled || busy || Boolean(uncertain)}>
            {inputs.map((input) => (
              <ValueSlot
                key={input.id}
                value={
                  values[input.id] ?? { kind: "missing", type: input.type }
                }
                onChange={(value) =>
                  setValues((previous) => ({ ...previous, [input.id]: value }))
                }
                locale={locale}
                label={input.name}
                path={`production-${input.id}`}
                modes={["literal"]}
                variables={[]}
                targets={targets}
                guildId={guildId}
                onValidity={validity}
              />
            ))}
            <button
              type="button"
              disabled={!canStart || Boolean(uncertain)}
              onClick={() => setReview({ kind: "start" })}
            >
              {words(
                locale,
                "対象を確認して本番を開始",
                "Review and start production",
              )}
            </button>
          </fieldset>
        </details>
      )}
      {(definition.trigger.kind === "internal" ||
        definition.trigger.kind === "interaction") && (
        <details className="automation-event-receipts">
          <summary>
            {words(
              locale,
              "イベントの受付と開始結果",
              "Event admission and start results",
            )}
          </summary>
          <p>
            {words(
              locale,
              "有効な固定版、現在の権限、期限と重複をサービス側で確認します。拒否されたイベントをこの画面から再送しません。",
              "The service verifies the enabled revision, current authority, expiry and duplicates. Rejected events are not resent from this screen.",
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              try {
                const response = await client.eventReceipts(definition.id);
                setEventReceipts(
                  response.items.filter(
                    (item) => item.flowId === definition.id,
                  ),
                );
                setEventError(false);
              } catch {
                setEventReceipts(null);
                setEventError(true);
              }
            }}
          >
            {words(locale, "イベント受付を確認", "Load event admissions")}
          </button>
          {eventError && (
            <p role="status">
              {words(
                locale,
                "イベント受付を取得できません。0件とは判定していません。",
                "Event admissions could not be retrieved. This has not been treated as zero.",
              )}
            </p>
          )}
          {eventReceipts?.length === 0 && (
            <p>
              {words(
                locale,
                "取得した範囲にイベント受付はありません。",
                "No event admissions were found in the retrieved range.",
              )}
            </p>
          )}
          {eventReceipts?.map((item) => (
            <article key={`${item.source}:${item.eventId}:${item.revision}`}>
              <strong>{statusName(locale, item.state)}</strong>
              <p>
                {words(locale, "固定版", "Fixed revision")} {item.revision} ·{" "}
                {item.occurredAt}
              </p>
              <p>
                {item.source === "INTERACTION"
                  ? words(
                      locale,
                      "確認済みのボタン操作",
                      "Verified button interaction",
                    )
                  : words(
                      locale,
                      "運用依頼のイベント",
                      "Operations request event",
                    )}
              </p>
              {item.reason && (
                <small>
                  {words(locale, "状態コード", "Status code")}: {item.reason}
                </small>
              )}
              {item.runId && (
                <button
                  type="button"
                  disabled={detailBusy !== null}
                  onClick={() => void loadDetail(item.runId!)}
                >
                  {words(locale, "開始した実行を確認", "Review admitted run")}
                </button>
              )}
              {item.runId && runDetails[item.runId] && (
                <RunDetails detail={runDetails[item.runId]!} locale={locale} />
              )}
            </article>
          ))}
        </details>
      )}
      <details>
        <summary>
          {words(locale, "正式な承認の待ち一覧", "Pending formal approvals")}
        </summary>
        <p>
          {words(
            locale,
            "この一覧は現在の承認資格をAPIで確認してから取得します。真偽値で承認を代用できません。",
            "The API verifies your current approval authority before returning this list. A Boolean cannot replace approval.",
          )}
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            try {
              setApprovals((await client.approvals()).items);
            } catch {
              setApprovals(null);
              setMessage(
                words(
                  locale,
                  "承認資格または一覧を確認できません。権限外の対象は表示していません。",
                  "Approval authority or the list could not be verified. Unauthorized targets are not shown.",
                ),
              );
            }
          }}
        >
          {words(locale, "承認待ちを確認", "Load pending approvals")}
        </button>
        {approvals?.length === 0 && (
          <p>
            {words(
              locale,
              "確認できた承認待ちはありません。",
              "There are no verified pending approvals.",
            )}
          </p>
        )}
        {approvals?.map((item) => (
          <article key={item.id}>
            <h3>
              {PALETTE.find((card) => card.operation === item.operation)?.[
                locale
              ] ?? words(locale, "許可操作", "Permitted action")}
            </h3>
            <p>
              {words(locale, "固定版", "Fixed revision")} {item.revision} ·{" "}
              {words(locale, "期限", "Expires")} {item.expiresAt}
            </p>
            {!item.policyFingerprint && (
              <p className="automation-notice">
                {words(
                  locale,
                  "ロールが与えるチャンネル権限の確認が完了していないため、承認できません。",
                  "Approval is unavailable until the role’s channel permission impact has been verified.",
                )}
              </p>
            )}
            {item.policyFingerprint && (
              <p>
                {words(
                  locale,
                  "ロールで権限が変化するチャンネル数",
                  "Channels whose permissions change with the role",
                )}
                :{" "}
                {item.changedChannelCount ??
                  words(locale, "未確認", "Unverified")}
              </p>
            )}
            {Object.entries(item.inputs)
              .filter(([key]) =>
                ["member", "role", "channel", "parent"].includes(key),
              )
              .map(([key, value]) => (
                <p key={key}>
                  {words(
                    locale,
                    key === "role"
                      ? "ロール"
                      : key === "member"
                        ? "メンバー"
                        : "対象",
                    key === "role"
                      ? "Role"
                      : key === "member"
                        ? "Member"
                        : "Target",
                  )}
                  : {refLabel(key, value)}
                </p>
              ))}
            <button
              disabled={
                disabled ||
                busy ||
                Boolean(uncertain) ||
                !item.policyFingerprint
              }
              onClick={() =>
                setReview({ kind: "approval", item, decision: "APPROVE" })
              }
            >
              {words(locale, "内容を確認して承認", "Review and approve")}
            </button>
            <button
              disabled={disabled || busy || Boolean(uncertain)}
              onClick={() =>
                setReview({ kind: "approval", item, decision: "REJECT" })
              }
            >
              {words(locale, "拒否する", "Reject")}
            </button>
          </article>
        ))}
      </details>
      {overview && (
        <div className="automation-run-list">
          {highlightRunId &&
            !flowRuns.some((run) => run.id === highlightRunId) && (
              <p role="status">
                {words(
                  locale,
                  "今回取得した実行では、指定された対象を確認できません。",
                  "The requested run was not verified in the retrieved range.",
                )}
              </p>
            )}
          <h3>{words(locale, "最近の実行", "Recent runs")}</h3>
          {detailError && <p role="status">{detailError}</p>}
          {flowRuns.length ? (
            flowRuns.map((run) => (
              <article
                key={run.id}
                id={`automation-run-${run.id}`}
                tabIndex={run.id === highlightRunId ? -1 : undefined}
                data-focused={run.id === highlightRunId}
              >
                <strong>{statusName(locale, run.state)}</strong>
                <span>{run.startedAt}</span>
                {run.dueAt && (
                  <small>
                    {words(locale, "再開予定（UTC）", "Resume time (UTC)")}{" "}
                    {run.dueAt}
                  </small>
                )}
                <button
                  type="button"
                  disabled={detailBusy !== null}
                  onClick={() => void loadDetail(run.id)}
                >
                  {words(
                    locale,
                    "枝ごとの状態と実行詳細を確認",
                    "Load branch states and run details",
                  )}
                </button>
                {runDetails[run.id] && (
                  <RunDetails
                    detail={runDetails[run.id]!}
                    locale={locale}
                    definition={
                      !dirty && runDetails[run.id]!.revision === draftRevision
                        ? definition
                        : undefined
                    }
                  />
                )}
                {!run.endedAt && (
                  <button
                    type="button"
                    disabled={disabled || busy || Boolean(uncertain)}
                    onClick={() => setReview({ kind: "cancel", runId: run.id })}
                  >
                    {words(locale, "中止を確認", "Review cancellation")}
                  </button>
                )}
              </article>
            ))
          ) : (
            <p>
              {words(
                locale,
                "今回取得した範囲に、この自動化の実行記録はありません。",
                "No evidence for this flow was found in the retrieved range.",
              )}
            </p>
          )}
        </div>
      )}
      {review && (
        <ConfirmationDialog
          label={words(
            locale,
            review.kind === "start"
              ? "本番開始の確認"
              : review.kind === "cancel"
                ? "中止の確認"
                : "固定内容の承認確認",
            review.kind === "start"
              ? "Confirm production start"
              : review.kind === "cancel"
                ? "Confirm cancellation"
                : "Review the fixed approval",
          )}
          busy={busy}
          onCancel={() => setReview(null)}
          className="automation-dialog"
        >
          <h2>
            {words(
              locale,
              review.kind === "start"
                ? "この版で本番を開始しますか"
                : review.kind === "cancel"
                  ? "新しい外部変更を止めますか"
                  : "表示した固定内容への判断を保存しますか",
              review.kind === "start"
                ? "Start this revision in production?"
                : review.kind === "cancel"
                  ? "Stop new external changes?"
                  : "Save a decision for the fixed request?",
            )}
          </h2>
          <p>
            {review.kind === "start"
              ? words(
                  locale,
                  `有効版 ${activeRevision}、操作対象と入力を確認してください。1回分の枠を消費し、外部変更が発生する可能性があります。`,
                  `Review enabled revision ${activeRevision}, targets and inputs. This uses one execution and can make external changes.`,
                )
              : review.kind === "cancel"
                ? words(
                    locale,
                    "新しい変更を停止します。すでに開始した操作が未送信だったとは保証せず、確認済み成功を消しません。",
                    "New changes will stop. Already-started actions may have been sent; confirmed successes are preserved.",
                  )
                : words(
                    locale,
                    `固定版 ${review.item.revision}、${review.item.operation.includes("remove") ? "解除" : "付与"}、期限 ${review.item.expiresAt}。対象や内容が変わればこの承認は使いません。`,
                    `Fixed revision ${review.item.revision}, ${review.item.operation.includes("remove") ? "remove" : "add"}, expires ${review.item.expiresAt}. This decision cannot be reused for changed targets or content.`,
                  )}
          </p>
          {review.kind === "approval" &&
            Object.entries(review.item.inputs)
              .filter(([key]) =>
                ["member", "role", "channel", "parent"].includes(key),
              )
              .map(([key, value]) => <p key={key}>{refLabel(key, value)}</p>)}
          {review.kind === "approval" && (
            <p>
              {words(
                locale,
                "このロールで権限が変わるチャンネル数",
                "Channels whose permissions change with this role",
              )}
              :{" "}
              {review.item.changedChannelCount ??
                words(locale, "未確認", "Unverified")}
              .{" "}
              {words(
                locale,
                "承認の対象は確認済みの権限差分に固定されます。変更後はこの承認を使えません。",
                "Approval is bound to the verified permission changes. It cannot authorize a changed policy.",
              )}
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => setReview(null)}>
            {words(locale, "取消", "Cancel")}
          </button>
          <button
            type="button"
            disabled={busy || Boolean(uncertain)}
            onClick={() => void mutate()}
          >
            {words(
              locale,
              review.kind === "start"
                ? "本番を開始"
                : review.kind === "cancel"
                  ? "中止を要求"
                  : review.decision === "APPROVE"
                    ? "承認を保存"
                    : "拒否を保存",
              review.kind === "start"
                ? "Start production"
                : review.kind === "cancel"
                  ? "Request cancellation"
                  : review.decision === "APPROVE"
                    ? "Save approval"
                    : "Save rejection",
            )}
          </button>
        </ConfirmationDialog>
      )}
    </section>
  );
}

function RunDetails({
  detail,
  locale,
  definition,
}: {
  detail: AutomationRunDetail;
  locale: Locale;
  definition?: FlowDefinition;
}) {
  return (
    <section
      className="automation-run-detail"
      aria-label={words(locale, "確認した実行状態", "Verified run state")}
    >
      <p>
        {words(locale, "固定版", "Fixed revision")} {detail.revision} ·{" "}
        {statusName(locale, detail.state)}
      </p>
      {detail.reason && (
        <p>
          {words(locale, "状態コード", "Status code")}: {detail.reason}
        </p>
      )}
      {detail.parallel && (
        <ParallelStatus
          state={detail.parallel}
          locale={locale}
          definition={definition}
        />
      )}
      {detail.iterations&&<IterationResultsSummary items={detail.iterations} locale={locale}/>}
      <p className="automation-hint">
        {words(
          locale,
          "実行記録には本文や変数の中身を表示しません。待機・承認待ち・結果不明は完了ではありません。",
          "Run evidence does not show message bodies or variable contents. Waiting, pending approval and unknown outcomes are not completion.",
        )}
      </p>
    </section>
  );
}
export function IterationResultsSummary({items,locale}:{items:IterationResultSummary[];locale:Locale}) {
  const names:Record<IterationState,[string,string]>={SUCCEEDED:["確認済み成功","Confirmed success"],FAILED:["確認済み失敗","Confirmed failure"],NOT_STARTED:["未開始","Not started"],SKIPPED:["スキップ","Skipped"],CANCELLED:["中止","Cancelled"],UNKNOWN:["結果不明","Unknown"]};
  const states=Object.keys(names) as IterationState[];
  return <section className="automation-iteration-summary"><h4>{words(locale,"繰り返しの結果（内容を除く）","Iteration results (without payloads)")}</h4>
    {!items.length?<p>{words(locale,"確認した繰り返しの記録はありません。","No iteration records were returned.")}</p>:items.map((item,index)=><article key={`${item.blockId}:${item.identity}:${index}`}>
      <p>{words(locale,`繰り返し ${index+1}`,`Repeat ${index+1}`)}</p>
      <dl>{states.map(state=><div key={state}><dt>{words(locale,...names[state])}</dt><dd>{Number.isSafeInteger(item.counts?.[state])&&item.counts[state]>=0?item.counts[state]:words(locale,"未確認","Unconfirmed")}</dd></div>)}</dl>
      <details><summary>{words(locale,"各回の確認状態","Verified state of each iteration")}</summary><ol>{item.states.map((state,i)=><li key={i}>{names[state]?words(locale,...names[state]):words(locale,"状態を確認できません","State could not be verified")}</li>)}</ol></details>
    </article>)}
    <p className="automation-hint">{words(locale,"本文・入力値・戻り値の内容を実行記録へ表示しません。結果不明を失敗や成功へ置き換えません。","Run evidence does not show message text, input values or output payloads. Unknown outcomes do not become failure or success.")}</p>
  </section>;
}
function ParallelStatus({
  state,
  locale,
  definition,
}: {
  state: ParallelRunStatus;
  locale: Locale;
  definition?: FlowDefinition;
}) {
  const names = new Map<string, string>();
  const visit = (body: FlowDefinition["body"]) => {
    for (const node of body) {
      if (node.kind === "parallel")
        for (const branch of node.branches) {
          names.set(branch.id, branch.name);
          visit(branch.body);
        }
      else if (node.kind === "branch") {
        visit(node.then);
        visit(node.otherwise);
        visit(node.unknown);
      } else if (node.kind === "repeat") visit(node.body);
    }
  };
  if (definition) {
    visit(definition.body);
    for (const procedure of definition.procedures ?? []) visit(procedure.body);
  }
  return (
    <div className="automation-parallel-status">
      <p>
        {words(
          locale,
          "合流：すべての枝の完了を待つ",
          "Join: wait for every branch to complete",
        )}
      </p>
      <ul>
        {state.branches.map((branch, index) => (
          <li key={branch.id}>
            <strong>
              {names.get(branch.id) ??
                words(locale, `枝 ${index + 1}`, `Branch ${index + 1}`)}
            </strong>{" "}
            · {statusName(locale, branch.state)}
            {branch.dueAt && (
              <small>
                {words(locale, "再開予定（UTC）", "Resume time (UTC)")}{" "}
                {branch.dueAt}
              </small>
            )}
            {branch.parallel && (
              <ParallelStatus
                state={branch.parallel}
                locale={locale}
                definition={definition}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
