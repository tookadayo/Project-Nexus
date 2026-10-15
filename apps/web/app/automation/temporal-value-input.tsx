"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { JsonValue, ValueInput } from "../../../../packages/automation/src/types";
import {
  composeZonedValue, validateTemporalValue,
} from "../../../../packages/automation/src/temporal-values";
import { dateRangeToInstantRange, offsetAt, parseInstant, zonedDateTimeCandidates } from "../../../../packages/automation/src/datetime";

interface Props {
  value: ValueInput;
  onChange: (next: ValueInput) => void;
  locale: "ja" | "en";
  label: string;
  onValidity: (error: string | null) => void;
}
type Fields = { date: string; time: string; timeZone: string; occurrence: string; start: string; end: string };
function fieldsFor(value: ValueInput): Fields {
  const data = value.kind === "literal" && value.value && typeof value.value === "object" && !Array.isArray(value.value)
    ? value.value : {};
  const text = (key: string) => typeof data[key] === "string" ? data[key] as string : "";
  return { date: text("date"), time: text("time"), timeZone: text("timeZone"), occurrence: text("occurrence") || "requireUnique", start: text("start"), end: text("end") };
}
function utcInput(value: string): string { return value.endsWith("Z") ? value.slice(0, -1) : value; }
function utcValue(value: string): string {
  if (!value) return "";
  return parseInstant(`${value.length === 16 ? `${value}:00` : value}Z`);
}
/** Date inputs are editing controls; incomplete fields never become execution defaults. */
export function TemporalValueInput({ value, onChange, locale, label, onValidity }: Props) {
  const id = useId(), last = useRef(JSON.stringify(value));
  const [fields, setFields] = useState(() => fieldsFor(value));
  const [error, setError] = useState<string | null>(null);
  const words = (ja: string, en: string) => locale === "ja" ? ja : en;
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== last.current) { last.current = next; setFields(fieldsFor(value)); setError(null); onValidity(null); }
  }, [value, onValidity]);
  const update = (key: keyof Fields, text: string) => {
    const next = { ...fields, [key]: text }; setFields(next);
    let execution: ValueInput = { kind: "missing", type: value.type };
    let message: string | null = null;
    try {
      let data: JsonValue | undefined;
      if (value.type === "ZonedDateTimeSpec" && next.date && next.time && next.timeZone)
        data = composeZonedValue(next.date, next.time, next.timeZone, next.occurrence) as unknown as JsonValue;
      else if (value.type === "DateRange" && next.start && next.end && next.timeZone)
        data = { start: next.start, end: next.end, timeZone: next.timeZone, boundaryRule: "firstValidEarlier" };
      else if (value.type === "InstantRange" && next.start && next.end)
        data = { start: next.start, end: next.end };
      if (data !== undefined) {
        validateTemporalValue(value.type, data);
        execution = { kind: "literal", type: value.type, value: data };
      }
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "TEMPORAL_VALUE";
      message = words(`日時を確認してください。空の期間・存在しない日時・夏時間の重複・地域を確認します（${code}）。`, `Review the range, date/time, time zone and daylight-saving occurrence (${code}).`);
    }
    setError(message); onValidity(message); last.current = JSON.stringify(execution); onChange(execution);
  };
  const input = (key: keyof Fields, title: string, type: "date" | "time" | "text" | "datetime-local", placeholder?: string) => (
    <label htmlFor={`${id}-${key}`}>
      {title}
      <input id={`${id}-${key}`} type={type} step={type === "datetime-local" ? "0.001" : undefined}
        value={type === "datetime-local" ? utcInput(fields[key]) : fields[key]} placeholder={placeholder}
        aria-describedby={`${id}-meaning${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          if (type !== "datetime-local") return update(key, event.target.value);
          try { update(key, utcValue(event.target.value)); }
          catch { update(key, event.target.value); }
        }} />
    </label>
  );
  let preview = "";
  try {
    if (value.kind === "literal" && value.type === "DateRange") {
      const range = dateRangeToInstantRange(value.value as unknown as Parameters<typeof dateRangeToInstantRange>[0]);
      preview = `${range.start} ≤ instant < ${range.end}`;
    } else if (value.kind === "literal" && value.type === "ZonedDateTimeSpec") {
      const data = value.value as Record<string, JsonValue>;
      preview = `${data.instant} · ${data.timeZone} (${data.offset})`;
    }
  } catch { /* Invalid saved values stay visible for correction; they are never executed. */ }
  let candidates: string[] = [];
  try {
    if (fields.date && fields.time && fields.timeZone)
      candidates = zonedDateTimeCandidates({ date: fields.date, time: fields.time, timeZone: fields.timeZone });
  } catch { /* The editing error is associated with the fields above. */ }
  return <fieldset className="automation-temporal-input">
    <legend>{label}</legend>
    {value.type === "ZonedDateTimeSpec" ? <>
      {input("date", words("日付", "Date"), "date")}
      {input("time", words("現地時刻", "Local time"), "time")}
      {input("timeZone", words("地域（IANA）", "Time zone (IANA)"), "text", "Asia/Tokyo")}
      <label htmlFor={`${id}-occurrence`}>{words("重なる時刻の選択", "Repeated-time occurrence")}
        <select id={`${id}-occurrence`} value={fields.occurrence} onChange={(event) => update("occurrence", event.target.value)}>
          <option value="requireUnique">{words("重ならない時刻のみ（重複なら選び直す）", "Require a unique time")}</option>
          <option value="earlier">{words("早い時点", "Earlier instant")}{candidates[0] ? ` · ${candidates[0]} (${offsetAt(candidates[0], fields.timeZone)})` : ""}</option>
          <option value="later">{words("遅い時点", "Later instant")}{candidates.length > 1 ? ` · ${candidates.at(-1)} (${offsetAt(candidates.at(-1)!, fields.timeZone)})` : ""}</option>
        </select>
      </label>
    </> : <>
      {input("start", value.type === "DateRange" ? words("開始日（含む）", "Start date (included)") : words("開始 UTC（含む）", "Start UTC (included)"), value.type === "DateRange" ? "date" : "datetime-local")}
      {input("end", value.type === "DateRange" ? words("終了日（含む）", "End date (included)") : words("終了 UTC（含まない）", "End UTC (excluded)"), value.type === "DateRange" ? "date" : "datetime-local")}
      {value.type === "DateRange" && input("timeZone", words("日境界を決める地域（IANA）", "Local day-boundary time zone (IANA)"), "text", "Asia/Tokyo")}
    </>}
    <small id={`${id}-meaning`}>{value.type === "DateRange"
      ? words("両端の日を含みます。同じ日なら1暦日。時点への変換は地域の翌日日境界を終端（含まない）にし、24時間×日数では計算しません。0時欠落は当日の最初の有効時刻、重複は早い時点です。", "Both dates are included; the same date is one calendar day. Instant conversion excludes the next local day boundary, rather than multiplying days by 24 hours. A missing midnight uses the first valid time; a repeated boundary uses the earlier instant.")
      : value.type === "InstantRange"
        ? words("UTCの開始を含み、終了を含みません。同じ時点の空期間は保存できません。", "The UTC start is included and the end is excluded. An empty range is invalid.")
        : words("存在しない現地日時は実行できません。地域や日付を編集すると現地時刻を保って別の時点へ変更し、プレビューで確認します。同じ時点の表示地域だけを変える場合は専用の値ブロックを使います。", "A missing local date/time cannot execute. Editing the date or zone keeps the entered local time and changes the instant shown in the preview. Use the same-instant conversion block to change only the display time zone.")}</small>
    {preview && <output aria-live="polite">{preview}</output>}
    {error && <p role="alert" id={`${id}-error`}>{error}</p>}
  </fieldset>;
}
