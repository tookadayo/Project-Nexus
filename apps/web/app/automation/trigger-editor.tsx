"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  FlowDefinition,
  ElapsedScheduleSpec,
  RecurrenceSpec,
  TriggerDefinition,
  ZonedDateTimeSpec,
  ValueType,
} from "../../../../packages/automation/src/types";
import {
  nextScheduleOccurrences,
  offsetAt,
  zonedDateTimeCandidates,
} from "../../../../packages/automation/src/datetime";
import { nextElapsedOccurrences } from "../../../../packages/automation/src/elapsed-schedule";
import {
  parseUserInstantInput,
  localTimeType,
  INSTANT_RANGE_V2_TYPE,
} from "../../../../packages/automation/src/temporal-types";
import {
  DateOnlyControl,
  LocalTimeControl,
  UserInstantControl,
} from "./date-controls";
import { words, uid, typeName, type Locale } from "./model";
import { AUTOMATION_CATALOG } from "../../../../packages/automation/src/catalog";
import { TypeSelect } from "./type-picker";
import {
  INTERNAL_EVENT_FIELDS,
  INTERACTION_EVENT_FIELDS,
} from "../../../../packages/automation/src/event-contract";

export function elapsedInputInstant(value: string): string {
  if (!value) return "";
  try {
    return parseUserInstantInput(value);
  } catch {
    return value;
  }
}

export function TriggerEditor({
  trigger,
  onChange,
  locale,
  timeZone,
  timeZoneCandidate,
  guildId,
  onValidity,
}: {
  trigger: TriggerDefinition;
  onChange: (next: TriggerDefinition) => void;
  locale: Locale;
  timeZone?: string | null;
  timeZoneCandidate?: string | null;
  guildId?: string;
  onValidity?: (error: string | null) => void;
}) {
  const preview = useMemo(() => {
    if (trigger.kind !== "schedule") return { items: [], error: "" };
    try {
      const rule = trigger.schedule;
      if (rule.kind === "elapsed")
        return {
          items: nextElapsedOccurrences(rule, new Date(), 5),
          error: "",
        };
      if (rule.kind === "once") {
        const candidates = zonedDateTimeCandidates(rule.at);
        if (!candidates.length)
          return {
            items: [],
            error: words(
              locale,
              "この地域では、この日時は存在しません。別の時刻を選んでください。",
              "This local date and time does not exist. Choose another time.",
            ),
          };
        return {
          items: candidates.map((instant) => ({
            instant,
            localDate: rule.at.date,
            localTime: rule.at.time,
            timeZone: rule.at.timeZone,
            offset: offsetAt(instant, rule.at.timeZone),
          })),
          error:
            candidates.length > 1 && !rule.at.occurrence
              ? words(
                  locale,
                  "この時刻は2回あります。UTC差分を確認して選んでください。",
                  "This time occurs twice. Choose an occurrence by its UTC offset.",
                )
              : "",
        };
      }
      return {
        items: nextScheduleOccurrences(rule, new Date().toISOString(), 5),
        error: "",
      };
    } catch {
      if (trigger.schedule.kind === "elapsed")
        return {
          items: [],
          error: words(
            locale,
            "基準日時・終了日時（UTC）と、正の整数の経過秒を入力してください。終了日時は基準日時より後の100年以内です。",
            "Enter UTC anchor and end instants, and a positive whole number of elapsed seconds. The end must follow the anchor within 100 years.",
          ),
        };
      return {
        items: [],
        error: words(
          locale,
          "日付・時刻・地域・期間を入力してください。終了日は開始日以降を選びます。",
          "Enter a date, time, region and range. The end date must not precede the start date.",
        ),
      };
    }
  }, [trigger, locale]);
  const once: ZonedDateTimeSpec =
    trigger.kind === "schedule" && trigger.schedule.kind === "once"
      ? trigger.schedule.at
      : { date: "", time: "", timeZone: timeZone ?? "" };
  const recurring: RecurrenceSpec =
    trigger.kind === "schedule" && trigger.schedule.kind === "recurring"
      ? trigger.schedule
      : {
          kind: "recurring",
          frequency: "weekly",
          time: "",
          timeZone: timeZone ?? "",
          startDate: "",
          endDate: "",
          weekdays: [],
          missingTime: "skip",
          repeatedTime: "earlier",
          pastOccurrences: "skip",
        };
  const elapsed: ElapsedScheduleSpec =
    trigger.kind === "schedule" && trigger.schedule.kind === "elapsed"
      ? trigger.schedule
      : {
          kind: "elapsed",
          anchor: "",
          intervalSeconds: Number.NaN,
          end: "",
          pastOccurrences: "skip",
        };
  const setElapsed = (patch: Partial<ElapsedScheduleSpec>) =>
    onChange({ kind: "schedule", schedule: { ...elapsed, ...patch } });
  const setOnce = (patch: Partial<ZonedDateTimeSpec>) =>
    onChange({
      kind: "schedule",
      schedule: {
        kind: "once",
        at: {
          ...once,
          ...patch,
          ...("date" in patch || "time" in patch || "timeZone" in patch
            ? { occurrence: undefined }
            : {}),
        },
      },
    });
  const setRecurring = (patch: Partial<RecurrenceSpec>) =>
    onChange({ kind: "schedule", schedule: { ...recurring, ...patch } });
  const controlValidity = (valid: boolean) =>
    onValidity?.(
      valid
        ? null
        : words(
            locale,
            "日時の形式を確認してください。新しい入力は秒までです。",
            "Review the date/time input. New inputs have at most second precision.",
          ),
    );
  const zoneReview = (zone: string) => {
    if (trigger.kind !== "schedule" || trigger.schedule.kind === "elapsed")
      return [];
    if (trigger.schedule.kind === "once")
      return zonedDateTimeCandidates({ ...once, timeZone: zone }).map(
        (instant) =>
          `${once.date} ${once.time} · ${zone} · UTC${offsetAt(instant, zone)} · ${instant}`,
      );
    return nextScheduleOccurrences(
      { ...recurring, timeZone: zone },
      new Date().toISOString(),
      5,
    ).map(
      (item) =>
        `${item.localDate} ${item.localTime} · ${item.timeZone} · UTC${item.offset} · ${item.instant}`,
    );
  };
  return (
    <section className="automation-trigger">
      <span className="automation-kind-label">
        {words(locale, "きっかけ · 開始", "Start trigger")}
      </span>
      <h3>
        {words(
          locale,
          "いつ、この手順を始めますか",
          "When should these steps start?",
        )}
      </h3>
      <label>
        {words(locale, "開始方法", "Start method")}
        <select
          value={
            trigger.kind === "schedule" ? trigger.schedule.kind : trigger.kind
          }
          onChange={(event) => {
            onValidity?.(null);
            const kind = event.target.value;
            if (kind === "once")
              onChange({
                kind: "schedule",
                schedule: { kind: "once", at: once },
              });
            else if (kind === "recurring")
              onChange({ kind: "schedule", schedule: recurring });
            else if (kind === "elapsed")
              onChange({ kind: "schedule", schedule: elapsed });
            else if (kind === "internal")
              onChange({
                kind: "internal",
                event: "ticketCreated",
                inputs: [],
              });
            else if (kind === "interaction")
              onChange({ kind: "interaction", inputs: [] });
            else onChange({ kind: "manual", inputs: [] });
          }}
        >
          <option value="manual">
            {words(locale, "手動で開始", "Manual start")}
          </option>
          <option value="once">
            {words(
              locale,
              "一度だけ、指定日時に開始",
              "Start once at a local date and time",
            )}
          </option>
          <option value="recurring">
            {words(locale, "地域の時刻で繰り返す", "Repeat at a local time")}
          </option>
          <option value="elapsed">
            {words(
              locale,
              "経過時間ごとに新しい処理を開始",
              "Start a new run after each elapsed interval",
            )}
          </option>
          <option
            value="internal"
            disabled={
              AUTOMATION_CATALOG.find((item) => item.id === "TR05")
                ?.availability !== "available"
            }
          >
            {words(locale, "受付の状態変化で開始", "Start from a ticket event")}
          </option>
          <option
            value="interaction"
            disabled={
              AUTOMATION_CATALOG.find((item) => item.id === "TR04")
                ?.availability !== "available"
            }
          >
            {words(
              locale,
              "NEXUSのボタン操作で開始",
              "Start from a NEXUS button interaction",
            )}
          </option>
        </select>
      </label>
      {((trigger.kind === "internal" &&
        AUTOMATION_CATALOG.find((item) => item.id === "TR05")?.availability !==
          "available") ||
        (trigger.kind === "interaction" &&
          AUTOMATION_CATALOG.find((item) => item.id === "TR04")
            ?.availability !== "available") ||
        trigger.kind === "messageMetadata") && (
        <p className="automation-notice">
          {words(
            locale,
            "この起点は安全な本人・期限・重複の確認経路が準備中です。構造を保持しますが、本番へ有効化できません。",
            "The safe identity, expiry and duplicate-admission path for this trigger is not ready. Its structure is preserved, but production activation is unavailable.",
          )}
        </p>
      )}
      {(trigger.kind === "manual" ||
        trigger.kind === "internal" ||
        trigger.kind === "interaction") && (
        <TriggerInputs trigger={trigger} onChange={onChange} locale={locale} />
      )}
      {trigger.kind === "internal" && (
        <label>
          {words(locale, "受付イベント", "Ticket event")}
          <select
            value={trigger.event}
            onChange={(event) =>
              onChange({
                ...trigger,
                event: event.target.value as "ticketCreated" | "ticketUpdated",
              })
            }
          >
            <option value="ticketCreated">
              {words(
                locale,
                "受付が作成されたとき",
                "When a ticket is created",
              )}
            </option>
            <option value="ticketUpdated">
              {words(
                locale,
                "受付が更新されたとき",
                "When a ticket is updated",
              )}
            </option>
          </select>
        </label>
      )}
      {trigger.kind === "schedule" && (
        <>
          {trigger.schedule.kind !== "elapsed" &&
            !(trigger.schedule.kind === "once"
              ? once.timeZone
              : recurring.timeZone) && (
              <section className="automation-zone-review">
                <p>
                  {words(
                    locale,
                    "共有予定の地域を確認してください。表示言語や端末の移動で予定を変更しません。",
                    "Confirm the region for this shared schedule. Display language and device travel do not change schedules.",
                  )}
                </p>
                {!timeZone && timeZoneCandidate ? (
                  <button
                    type="button"
                    onClick={() => {
                      onValidity?.(null);
                      if (trigger.schedule.kind === "once")
                        setOnce({ timeZone: timeZoneCandidate });
                      else setRecurring({ timeZone: timeZoneCandidate });
                    }}
                  >
                    {words(
                      locale,
                      `端末の地域候補 ${timeZoneCandidate} を使用`,
                      `Use device region candidate ${timeZoneCandidate}`,
                    )}
                  </button>
                ) : (
                  <p>
                    {words(
                      locale,
                      "地域を選択してください。UTCを自動で適用しません。",
                      "Choose a region. UTC is not applied automatically.",
                    )}
                  </p>
                )}
                <a
                  href={
                    guildId
                      ? `/setup?guild=${encodeURIComponent(guildId)}&edit=1`
                      : "/servers"
                  }
                >
                  {words(
                    locale,
                    "共有する地域の設定を確認",
                    "Review the shared region setting",
                  )}
                </a>
              </section>
            )}
          {trigger.schedule.kind === "elapsed" ? (
            <div className="automation-date-grid">
              <UserInstantControl
                value={elapsed.anchor}
                onChange={(text) => setElapsed({ anchor: text ?? "" })}
                locale={locale}
                label={words(
                  locale,
                  "基準日時（UTC・含む）",
                  "Anchor instant (UTC, included)",
                )}
                onValidity={controlValidity}
              />
              <label>
                {words(locale, "間隔（経過秒）", "Interval (elapsed seconds)")}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={
                    Number.isFinite(elapsed.intervalSeconds)
                      ? elapsed.intervalSeconds
                      : ""
                  }
                  onChange={(event) =>
                    setElapsed({
                      intervalSeconds:
                        event.target.value === ""
                          ? Number.NaN
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <UserInstantControl
                value={elapsed.end}
                onChange={(text) => setElapsed({ end: text ?? "" })}
                locale={locale}
                label={words(
                  locale,
                  "終了日時（UTC・含まない）",
                  "End instant (UTC, excluded)",
                )}
                onValidity={controlValidity}
              />
              <p className="automation-hint">
                {words(
                  locale,
                  "基準日時から同じ経過時間ごとに、別の処理を開始します。夏時間で間隔は変わりません。終了日時以降や過ぎた回は実行しません。各処理の期限は最大7日です。",
                  "Starts an independent run at each interval from the fixed anchor. Daylight saving does not change the elapsed interval. The end instant and missed occurrences are excluded. Each run lasts at most seven days.",
                )}
              </p>
            </div>
          ) : trigger.schedule.kind === "once" ? (
            <div className="automation-date-grid">
              <DateOnlyControl
                value={once.date}
                onChange={(text) => setOnce({ date: text })}
                locale={locale}
                label={words(locale, "日付", "Date")}
                onValidity={controlValidity}
              />
              <TimePrecisionSelect
                value={once.timePrecision ?? "minute"}
                locale={locale}
                onChange={(precision) =>
                  setOnce({ time: "", timePrecision: precision })
                }
              />
              <LocalTimeControl
                value={once.time}
                precision={once.timePrecision ?? "minute"}
                onChange={(text) => setOnce({ time: text })}
                locale={locale}
                label={words(locale, "現地時刻", "Local time")}
                onValidity={controlValidity}
              />
              <TimeZoneInput
                value={once.timeZone}
                locale={locale}
                onChange={(value) => setOnce({ timeZone: value })}
                onValidity={controlValidity}
                preview={zoneReview}
              />
            </div>
          ) : (
            <>
              <div className="automation-date-grid">
                <DateOnlyControl
                  value={recurring.startDate}
                  onChange={(text) => setRecurring({ startDate: text })}
                  locale={locale}
                  label={words(
                    locale,
                    "開始日（含む）",
                    "Start date (included)",
                  )}
                  onValidity={controlValidity}
                />
                <DateOnlyControl
                  value={recurring.endDate}
                  onChange={(text) => setRecurring({ endDate: text })}
                  locale={locale}
                  label={words(locale, "終了日（含む）", "End date (included)")}
                  onValidity={controlValidity}
                />
                <TimePrecisionSelect
                  value={recurring.timePrecision ?? "minute"}
                  locale={locale}
                  onChange={(precision) =>
                    setRecurring({ time: "", timePrecision: precision })
                  }
                />
                <LocalTimeControl
                  value={recurring.time}
                  precision={recurring.timePrecision ?? "minute"}
                  onChange={(text) => setRecurring({ time: text })}
                  locale={locale}
                  label={words(locale, "現地時刻", "Local time")}
                  onValidity={controlValidity}
                />
                <TimeZoneInput
                  value={recurring.timeZone}
                  locale={locale}
                  onChange={(value) => setRecurring({ timeZone: value })}
                  onValidity={controlValidity}
                  preview={zoneReview}
                />
              </div>
              <label>
                {words(locale, "繰り返し", "Repeat")}
                <select
                  value={recurring.frequency}
                  onChange={(event) =>
                    setRecurring({
                      frequency: event.target
                        .value as RecurrenceSpec["frequency"],
                    })
                  }
                >
                  <option value="daily">
                    {words(locale, "毎日", "Every day")}
                  </option>
                  <option value="weekly">
                    {words(locale, "毎週", "Every week")}
                  </option>
                  <option value="monthly">
                    {words(locale, "毎月", "Every month")}
                  </option>
                  <option value="yearly">
                    {words(locale, "毎年", "Every year")}
                  </option>
                </select>
              </label>
              {recurring.frequency === "weekly" && (
                <fieldset>
                  <legend>
                    {words(locale, "開始する曜日", "Start weekdays")}
                  </legend>
                  <div className="automation-weekdays">
                    {["日", "月", "火", "水", "木", "金", "土"].map(
                      (day, index) => (
                        <label key={day}>
                          <input
                            type="checkbox"
                            checked={
                              recurring.weekdays?.includes(index) ?? false
                            }
                            onChange={(event) =>
                              setRecurring({
                                weekdays: event.target.checked
                                  ? [
                                      ...(recurring.weekdays ?? []),
                                      index,
                                    ].sort()
                                  : (recurring.weekdays ?? []).filter(
                                      (item) => item !== index,
                                    ),
                              })
                            }
                          />
                          {locale === "ja"
                            ? day
                            : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                                index
                              ]}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
              )}
              {recurring.frequency === "yearly" && (
                <label>
                  {words(locale, "毎年の月", "Month each year")}
                  <select
                    value={recurring.month ?? ""}
                    onChange={(event) =>
                      setRecurring({ month: Number(event.target.value) })
                    }
                  >
                    <option value="">
                      {words(locale, "月を選択", "Choose a month")}
                    </option>
                    {Array.from({ length: 12 }, (_item, index) => (
                      <option key={index + 1} value={index + 1}>
                        {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(recurring.frequency === "monthly" ||
                recurring.frequency === "yearly") && (
                <label>
                  {words(locale, "毎月の日付", "Day each month")}
                  <select
                    value={recurring.monthDay ?? ""}
                    onChange={(event) =>
                      setRecurring({
                        monthDay:
                          event.target.value === "last"
                            ? "last"
                            : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">
                      {words(locale, "選択してください", "Choose a day")}
                    </option>
                    {Array.from({ length: 31 }, (_item, index) => (
                      <option key={index + 1} value={index + 1}>
                        {index + 1}
                      </option>
                    ))}
                    <option value="last">
                      {words(locale, "月末日", "Last day of the month")}
                    </option>
                  </select>
                </label>
              )}
              <p className="automation-hint">
                {words(
                  locale,
                  "終了日を含む地域の暦で判断します。存在しない時刻・日付の回はスキップ、重複時刻は早い側を1回。過去分は追送しません。",
                  "The local calendar includes the end date. Missing dates or times are skipped; repeated times run once at the earlier offset. Past occurrences are not replayed.",
                )}
              </p>
            </>
          )}
          {trigger.schedule.kind === "once" && preview.items.length > 1 && (
            <fieldset>
              <legend>
                {words(
                  locale,
                  "同じ現地時刻のどちらを使いますか",
                  "Which occurrence should be used?",
                )}
              </legend>
              {preview.items.map((item, index) => (
                <label key={item.instant}>
                  <input
                    type="radio"
                    name="automation-occurrence"
                    checked={
                      once.occurrence === (index === 0 ? "earlier" : "later")
                    }
                    onChange={() =>
                      setOnce({ occurrence: index === 0 ? "earlier" : "later" })
                    }
                  />
                  UTC{item.offset} · {item.instant}
                </label>
              ))}
            </fieldset>
          )}
          {preview.error ? (
            <p role="status" className="automation-field-error">
              {preview.error}
            </p>
          ) : (
            <section className="automation-schedule-preview">
              <h4>
                {words(
                  locale,
                  "実行候補（予約の確定前）",
                  "Upcoming candidates (not reserved)",
                )}
              </h4>
              {preview.items.length ? (
                <ol>
                  {preview.items.map((item) => (
                    <li key={item.instant}>
                      {item.localDate} {item.localTime} · {item.timeZone} · UTC
                      {item.offset}
                      <small>{item.instant}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  {words(
                    locale,
                    "これからの実行候補はありません。",
                    "There are no future occurrences.",
                  )}
                </p>
              )}
            </section>
          )}
          {trigger.schedule.kind !== "elapsed" && (
            <p className="automation-notice">
              {words(
                locale,
                "地域の時刻規則が変わった場合は、将来の開始を停止します。新しい版を保存し、候補日時を再確認して有効にしてください。",
                "If regional time rules change, future starts stop. Save a new revision, review the candidate dates, then explicitly enable it.",
              )}
            </p>
          )}
        </>
      )}
      {trigger.kind === "manual" && (
        <p className="automation-hint">
          {words(
            locale,
            "保存や試運転だけでは本番を開始しません。",
            "Saving or simulating does not start a production run.",
          )}
        </p>
      )}
    </section>
  );
}
function TimePrecisionSelect({
  value,
  locale,
  onChange,
}: {
  value: "minute" | "second";
  locale: Locale;
  onChange: (precision: "minute" | "second") => void;
}) {
  return (
    <label>
      {words(locale, "時刻の精度", "Time precision")}
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as "minute" | "second")
        }
      >
        <option value="minute">
          {words(
            locale,
            "分（HH:MM、秒は0）",
            "Minutes (HH:MM, seconds are zero)",
          )}
        </option>
        <option value="second">
          {words(locale, "秒（HH:MM:SS）", "Seconds (HH:MM:SS)")}
        </option>
      </select>
      <small>
        {words(
          locale,
          "精度変更時は時刻を入力し直します。自動で丸めません。",
          "Re-enter the time after changing precision. Values are not automatically rounded.",
        )}
      </small>
    </label>
  );
}
function TimeZoneInput({
  value,
  onChange,
  locale,
  onValidity,
  preview,
}: {
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  onValidity?: (valid: boolean) => void;
  preview?: (zone: string) => string[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    setPending(null);
  }, [value]);
  let valid = false,
    before: string[] = [],
    after: string[] = [];
  try {
    if (value) before = preview?.(value) ?? [];
  } catch {
    /* Existing incomplete fields remain editable. */
  }
  try {
    if (
      pending &&
      pending.length <= 64 &&
      (pending === "UTC" || pending.includes("/"))
    ) {
      new Intl.DateTimeFormat("en", { timeZone: pending }).format(0);
      valid = true;
    }
  } catch {
    valid = false;
  }
  try {
    if (valid) after = preview?.(pending!) ?? [];
  } catch {
    /* The main preview explains incomplete local fields after confirmation. */
  }
  return (
    <div className="automation-zone-review">
      <label>
        {words(locale, "地域（IANAタイムゾーン）", "Region (IANA time zone)")}
        <input
          value={pending ?? value}
          list="automation-time-zones"
          placeholder="Asia/Tokyo"
          onChange={(event) => {
            setPending(event.target.value);
            onValidity?.(false);
          }}
        />
        <datalist id="automation-time-zones">
          <option value="UTC" />
          <option value="Asia/Tokyo" />
          <option value="America/New_York" />
          <option value="Europe/London" />
        </datalist>
      </label>
      {pending !== null && (
        <section
          aria-label={words(locale, "地域変更の確認", "Review region change")}
        >
          <p>
            {words(
              locale,
              "現地の日付・時刻を維持し、実行時点を変更します。差分を確認して新しい版として保存してください。",
              "Keep the local date and time and change the execution instants. Review the difference and save a new revision.",
            )}
          </p>
          <h5>
            {words(locale, "変更前", "Before")} ·{" "}
            {value || words(locale, "未設定", "Not set")}
          </h5>
          <ul>
            {before.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h5>
            {words(locale, "変更後", "After")} · {pending}
          </h5>
          <ul>
            {after.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              onValidity?.(true);
              onChange(pending);
              setPending(null);
            }}
          >
            {words(
              locale,
              "確認してこの地域を使う",
              "Confirm and use this region",
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              onValidity?.(true);
            }}
          >
            {words(locale, "地域変更を取り消す", "Cancel region change")}
          </button>
        </section>
      )}
    </div>
  );
}
export type { FlowDefinition };
const INPUT_TYPES: ValueType[] = [
  "Number",
  "Boolean",
  "PlainText",
  "Duration",
  "DateOnly",
  "LocalTime",
  localTimeType("minute"),
  localTimeType("second"),
  "Instant",
  "TimeZone",
  "ZonedDateTimeSpec",
  "DateRange",
  INSTANT_RANGE_V2_TYPE,
  "LocalTimeWindowSpec",
  "ChannelRef",
  "RoleRef",
  { kind: "List", element: "Number" },
  { kind: "List", element: "PlainText" },
];
function eventFieldName(id: string, locale: Locale) {
  const names: Record<string, [string, string]> = {
    "event.ticket": ["受付の参照", "Ticket reference"],
    "event.state": ["受付の状態", "Ticket state"],
    "event.version": ["受付の版", "Ticket version"],
    "event.occurredAt": ["変更した日時", "Event time"],
    "interaction.member": [
      "ボタンを押した本人",
      "Person who pressed the button",
    ],
    "interaction.channel": ["ボタンのチャンネル", "Button channel"],
    "interaction.occurredAt": ["ボタンを押した日時", "Button press time"],
  };
  return words(locale, ...(names[id] ?? [id, id]));
}
function TriggerInputs({
  trigger,
  onChange,
  locale,
}: {
  trigger: Extract<
    TriggerDefinition,
    { kind: "manual" | "internal" | "interaction" }
  >;
  onChange: (trigger: TriggerDefinition) => void;
  locale: Locale;
}) {
  return (
    <fieldset className="automation-trigger-inputs">
      <legend>
        {words(locale, "開始時に受け取る値", "Values received at the start")}
      </legend>
      {trigger.kind === "manual" ? (
        <>
          <p className="automation-hint">
            {words(
              locale,
              "手動開始時に型の合う値を入力します。空欄は値になりません。名前を変えても参照は保持されます。",
              "Enter matching typed values when starting manually. Blank values stay unset. Renaming preserves references.",
            )}
          </p>
          {trigger.inputs.map((input) => (
            <div key={input.id} className="automation-input-declaration">
              <label>
                {words(locale, "入力の名前", "Input name")}
                <input
                  maxLength={100}
                  value={input.name}
                  onChange={(e) =>
                    onChange({
                      ...trigger,
                      inputs: trigger.inputs.map((item) =>
                        item.id === input.id
                          ? { ...item, name: e.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <TypeSelect
                locale={locale}
                value={input.type}
                allowed={INPUT_TYPES}
                allowChoices
                label={words(locale, "入力の種類", "Input type")}
                onChange={(type) =>
                  onChange({
                    ...trigger,
                    inputs: trigger.inputs.map((item) =>
                      item.id === input.id ? { ...item, type } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...trigger,
                    inputs: trigger.inputs.filter(
                      (item) => item.id !== input.id,
                    ),
                  })
                }
              >
                {words(locale, "この入力を削除", "Delete this input")}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={trigger.inputs.length >= 20}
            onClick={() =>
              onChange({
                ...trigger,
                inputs: [
                  ...trigger.inputs,
                  {
                    id: uid(),
                    name: words(
                      locale,
                      `入力 ${trigger.inputs.length + 1}`,
                      `Input ${trigger.inputs.length + 1}`,
                    ),
                    type: "PlainText",
                  },
                ],
              })
            }
          >
            {words(locale, "型付き入力を追加", "Add a typed input")}
          </button>
        </>
      ) : (
        <>
          <p>
            {words(
              locale,
              "確認済みのイベント情報だけを受け取ります。本文・プロフィールは取得しません。IDと種類は固定され、表示名だけを変更できます。",
              "Receive only verified event metadata. Message bodies and profiles are not collected. Identifiers and types are fixed; display names are editable.",
            )}
          </p>
          {(trigger.kind === "internal"
            ? INTERNAL_EVENT_FIELDS
            : INTERACTION_EVENT_FIELDS
          ).map((field) => {
            const current = trigger.inputs.find(
              (input) => input.id === field.id,
            );
            return (
              <div key={field.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(current)}
                    onChange={(e) =>
                      onChange({
                        ...trigger,
                        inputs: e.target.checked
                          ? [
                              ...trigger.inputs,
                              {
                                ...field,
                                name: eventFieldName(field.id, locale),
                              },
                            ]
                          : trigger.inputs.filter(
                              (input) => input.id !== field.id,
                            ),
                      })
                    }
                  />
                  {eventFieldName(field.id, locale)} · {typeName(field.type)}
                </label>
                {current && (
                  <label>
                    {words(locale, "値の表示名", "Value display name")}
                    <input
                      maxLength={100}
                      value={current.name}
                      onChange={(e) =>
                        onChange({
                          ...trigger,
                          inputs: trigger.inputs.map((input) =>
                            input.id === field.id
                              ? { ...input, name: e.target.value }
                              : input,
                          ),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
          <p className="automation-notice">
            {trigger.kind === "interaction"
              ? words(
                  locale,
                  "DiscordのNEXUSパネル → Automationで対象を選び、本人に結び付いた15分間・1回限りのボタンで開始します。Web画面から操作した本人を名乗ることはできません。",
                  "In the Discord NEXUS panel, choose Automation and a flow, then use your identity-bound button within 15 minutes, once. The Web screen cannot impersonate a Discord interaction.",
                )
              : words(
                  locale,
                  "NEXUSが検証した受付の作成・変更から開始します。同じ受付バージョンを重ねて開始しません。",
                  "Starts from verified Operations Intake requests. The same request version is not admitted twice.",
                )}
          </p>
        </>
      )}
    </fieldset>
  );
}
