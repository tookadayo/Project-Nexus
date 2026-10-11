"use client";
import { useEffect, useRef, useState } from "react";
import {
  Attention,
  type AttentionFilter,
  type AttentionPost,
} from "./attention";
import type { AttentionPage } from "../../../packages/operations/src/attention-queue";
import type { UserFailure } from "../../../packages/shared/src/error-types";
import { FailureNotice } from "./failure-ui";

type Location = AttentionFilter & { cursor?: string };
const defaultLocation: Location = { state: "ACTIVE", channelId: "" };
function readLocation(): Location {
  const params = new URLSearchParams(window.location.search),
    state = params.get("attentionState") ?? "ACTIVE",
    channelId = params.get("attentionChannel") ?? "",
    cursor = params.get("attentionCursor") ?? undefined;
  return {
    state: [
      "ACTIVE",
      "OPEN",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "SNOOZED",
      "RESOLVED",
    ].includes(state)
      ? state
      : "ACTIVE",
    channelId: /^\d{17,20}$/.test(channelId) ? channelId : "",
    ...(cursor && cursor.length <= 2048 ? { cursor } : {}),
  };
}
function writeLocation(value: Location, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, paramValue] of [
    ["attentionState", value.state === "ACTIVE" ? "" : value.state],
    ["attentionChannel", value.channelId],
    ["attentionCursor", value.cursor ?? ""],
  ])
    if (paramValue) url.searchParams.set(key!, paramValue);
    else url.searchParams.delete(key!);
  window.history[replace ? "replaceState" : "pushState"](
    window.history.state,
    "",
    url,
  );
}
export function AttentionQueueView({
  guildId,
  locale,
  channels,
  minutes,
  ready,
  onRules,
  onScopeChanged,
  onActiveCount,
}: {
  guildId: string;
  locale: "ja" | "en";
  channels: { id: string; label: string }[];
  minutes: number;
  ready: boolean;
  onRules: () => void;
  onScopeChanged: () => void;
  onActiveCount: (count: number | null) => void;
}) {
  const [location, setLocation] = useState<Location>(defaultLocation),
    [mounted, setMounted] = useState(false),
    [page, setPage] = useState<AttentionPage | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [loadError, setLoadError] = useState<string | null>(null),
    [failure, setFailure] = useState<UserFailure | null>(null),
    [reload, setReload] = useState(0),
    [snooze, setSnooze] = useState<Record<string, "30" | "60" | "today">>({});
  const generation = useRef(0),
    scopeChanged = useRef(onScopeChanged),
    activeCountChanged = useRef(onActiveCount),
    focusAfterPage = useRef(false),
    summaryRef = useRef<HTMLDivElement>(null);
  scopeChanged.current = onScopeChanged;
  activeCountChanged.current = onActiveCount;
  useEffect(() => {
    if (page && !loading && focusAfterPage.current) {
      focusAfterPage.current = false;
      summaryRef.current?.focus();
    }
  }, [page, loading]);
  useEffect(() => {
    setLocation(readLocation());
    setMounted(true);
    const pop = () => {
      focusAfterPage.current = false;
      setPage(null);
      setLocation(readLocation());
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const abort = new AbortController(),
      current = ++generation.current;
    setLoading(true);
    setFailed(false);
    setLoadError(null);
    setFailure(null);
    setPage(null);
    const params = new URLSearchParams({ state: location.state });
    if (location.channelId) params.set("channelId", location.channelId);
    if (location.cursor) params.set("cursor", location.cursor);
    void fetch("/data/attention?" + params, {
      headers: { "X-Nexus-Guild": guildId },
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (current !== generation.current || abort.signal.aborted) return;
        if (!response.ok) {
          activeCountChanged.current(null);
          focusAfterPage.current = false;
          if (
            body.error === "SERVER_SELECTION_CHANGED" ||
            body.code === "SERVER_SELECTION_CHANGED"
          )
            scopeChanged.current();
          setLoadError(body.error ?? null);
          setFailure(body.failure ?? null);
          setFailed(true);
          return;
        }
        const result = body as AttentionPage;
        setPage(result);
        activeCountChanged.current(
          Number.isInteger(result.activeCount) && result.activeCount >= 0
            ? result.activeCount
            : null,
        );
        // The first request fixes the boundary in the URL, so a reload keeps it.
        if (!location.cursor)
          writeLocation({ ...location, cursor: result.cursor }, true);
      })
      .catch(() => {
        if (!abort.signal.aborted && current === generation.current) {
          activeCountChanged.current(null);
          focusAfterPage.current = false;
          setFailed(true);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted && current === generation.current)
          setLoading(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [guildId, location, mounted, reload]);
  function navigate(next: Location, focus = false) {
    focusAfterPage.current = focus;
    setPage(null);
    writeLocation(next);
    setLocation(next);
  }
  async function action(
    item: AttentionPost,
    status: "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED",
  ) {
    if (
      busy ||
      !page?.canOperate ||
      item.version === undefined ||
      (status === "SNOOZED" && item.status === "SNOOZED")
    )
      return;
    setBusy(true);
    activeCountChanged.current(null);
    setFailure(null);
    const choice = snooze[item.messageId] ?? "30";
    try {
      const response = await fetch("/data/attention", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nexus-Guild": guildId,
        },
        body: JSON.stringify({
          channelId: item.channelId,
          messageId: item.messageId,
          status,
          version: item.version,
          ...(status === "SNOOZED"
            ? choice === "today"
              ? { untilToday: true }
              : { minutes: Number(choice) }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setPage(null);
        setFailed(true);
        setFailure(body.failure ?? null);
        if (
          body.error === "SERVER_SELECTION_CHANGED" ||
          body.code === "SERVER_SELECTION_CHANGED"
        )
          scopeChanged.current();
        if (!body.failure) setFailed(true);
        return;
      }
      // Re-read from the same position. A deleted/changed anchor is not required to exist.
      setLocation((current) => ({ ...current, cursor: page.cursor }));
      setReload((n) => n + 1);
    } catch {
      setPage(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {failure && <FailureNotice failure={failure} locale={locale} />}
      <Attention
        ready={ready}
        items={page?.items ?? []}
        locale={locale}
        channels={channels}
        minutes={minutes}
        loading={loading}
        failed={failed}
        loadError={loadError}
        busy={busy}
        page={page}
        summaryRef={summaryRef}
        filters={location}
        canOperate={page?.canOperate ?? false}
        snooze={snooze}
        onRules={onRules}
        onRefresh={() => navigate({ ...location, cursor: undefined })}
        onFilter={(filter) => navigate({ ...filter, cursor: undefined })}
        onPage={(cursor) => navigate({ ...location, cursor }, true)}
        onSnooze={(id, value) =>
          setSnooze((current) => ({ ...current, [id]: value }))
        }
        onChange={(item, status) => void action(item, status)}
      />
    </>
  );
}
