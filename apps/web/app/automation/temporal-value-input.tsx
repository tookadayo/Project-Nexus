"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  JsonValue,
  ValueInput,
} from "../../../../packages/automation/src/types";
import {
  composeZonedValue,
  validateTemporalValue,
} from "../../../../packages/automation/src/temporal-values";
import {
  dateRangeToInstantRange,
  offsetAt,
  zonedDateTimeCandidates,
} from "../../../../packages/automation/src/datetime";
import { isInstantRangeV2Type } from "../../../../packages/automation/src/temporal-types";
import {
  DateOnlyControl,
  LocalTimeControl,
  UserInstantControl,
} from "./date-controls";

interface Props {
  value: ValueInput;
  onChange: (next: ValueInput) => void;
  locale: "ja" | "en";
  label: string;
  onValidity: (error: string | null) => void;
}
type Fields = {
  date: string;
  time: string;
  timeZone: string;
  occurrence: string;
  start: string;
  end: string;
  precision: "minute" | "second";
  explicitPrecision: boolean;
  endDayOffset: string;
  weekdays: number[];
};
function fieldsFor(value: ValueInput): Fields {
  const data =
    value.kind === "literal" &&
    value.value &&
    typeof value.value === "object" &&
    !Array.isArray(value.value)
      ? value.value
      : {};
  const text = (key: string) =>
    typeof data[key] === "string" ? (data[key] as string) : "";
  return {
    date: text("date"),
    time: text("time"),
    timeZone: text("timeZone"),
    occurrence: text("occurrence") || "requireUnique",
    start: text("start"),
    end: text("end"),
    precision: data.timePrecision === "second" ? "second" : "minute",
    explicitPrecision: Object.hasOwn(data, "timePrecision"),
    endDayOffset:
      typeof data.endDayOffset === "number" ? String(data.endDayOffset) : "",
    weekdays: Array.isArray(data.weekdays)
      ? data.weekdays.filter((day): day is number => typeof day === "number")
      : [],
  };
}
/** Date inputs are editing controls; incomplete fields never become execution defaults. */
export function TemporalValueInput({
  value,
  onChange,
  locale,
  label,
  onValidity,
}: Props) {
  const id = useId(),
    last = useRef(JSON.stringify(value));
  const [fields, setFields] = useState(() => fieldsFor(value));
  const [error, setError] = useState<string | null>(null);
  const isRangeV2 = isInstantRangeV2Type(value.type),
    isWindow = value.type === "LocalTimeWindowSpec";
  const words = (ja: string, en: string) => (locale === "ja" ? ja : en);
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== last.current) {
      last.current = next;
      setFields(fieldsFor(value));
      setError(null);
      onValidity(null);
    }
  }, [value, onValidity]);
  const update = <K extends keyof Fields>(
    key: K,
    text: Fields[K],
    patch: Partial<Fields> = {},
  ) => {
    const next = { ...fields, ...patch, [key]: text };
    setFields(next);
    let execution: ValueInput = { kind: "missing", type: value.type };
    let message: string | null = null;
    try {
      let data: JsonValue | undefined;
      if (
        value.type === "ZonedDateTimeSpec" &&
        next.date &&
        next.time &&
        next.timeZone
      )
        data = composeZonedValue(
          next.date,
          next.time,
          next.timeZone,
          next.occurrence,
          next.explicitPrecision ? next.precision : undefined,
        ) as unknown as JsonValue;
      else if (
        value.type === "DateRange" &&
        next.start &&
        next.end &&
        next.timeZone
      )
        data = {
          start: next.start,
          end: next.end,
          timeZone: next.timeZone,
          boundaryRule: "firstValidEarlier",
        };
      else if (
        (value.type === "InstantRange" || isRangeV2) &&
        next.start &&
        next.end
      )
        data = { start: next.start, end: next.end };
      else if (
        isWindow &&
        next.start &&
        next.end &&
        next.timeZone &&
        next.endDayOffset !== "" &&
        next.weekdays.length
      )
        data = {
          start: next.start,
          end: next.end,
          timeZone: next.timeZone,
          weekdays: next.weekdays,
          endDayOffset: Number(next.endDayOffset),
          ...(next.explicitPrecision ? { timePrecision: next.precision } : {}),
        };
      if (data !== undefined) {
        validateTemporalValue(value.type, data);
        execution = { kind: "literal", type: value.type, value: data };
      }
    } catch (caught) {
      const code =
        caught && typeof caught === "object" && "code" in caught
          ? String(caught.code)
          : "TEMPORAL_VALUE";
      message = words(
        `日時を確認してください。空の期間・存在しない日時・夏時間の重複・地域を確認します（${code}）。`,
        `Review the range, date/time, time zone and daylight-saving occurrence (${code}).`,
      );
    }
    setError(message);
    onValidity(message);
    last.current = JSON.stringify(execution);
    onChange(execution);
  };
  const controlValidity = (valid: boolean) => {
    const message = valid
      ? null
      : words(
          "入力形式を確認してください。新しい入力は秒までです。",
          "Review the input format. New inputs have at most second precision.",
        );
    setError(message);
    onValidity(message);
  };
  const zonePreview = (timeZone: string) => {
    if (value.type === "ZonedDateTimeSpec" && fields.date && fields.time) {
      const resolved = composeZonedValue(
        fields.date,
        fields.time,
        timeZone,
        fields.occurrence,
        fields.explicitPrecision ? fields.precision : undefined,
      );
      return `${resolved.instant} (${resolved.offset})`;
    }
    if (value.type === "DateRange" && fields.start && fields.end) {
      const range = dateRangeToInstantRange({
        start: fields.start,
        end: fields.end,
        timeZone,
        boundaryRule: "firstValidEarlier",
      });
      return `${range.start} ≤ instant < ${range.end}`;
    }
    return "";
  };
  const input = (
    key: "date" | "time" | "timeZone" | "start" | "end",
    title: string,
    type: "date" | "time" | "text" | "datetime-local",
    placeholder?: string,
  ) =>
    type === "date" ? (
      <DateOnlyControl
        id={`${id}-${key}`}
        value={fields[key]}
        onChange={(text) => update(key, text)}
        locale={locale}
        label={title}
        onValidity={controlValidity}
      />
    ) : type === "time" ? (
      <LocalTimeControl
        id={`${id}-${key}`}
        value={fields[key]}
        precision={fields.precision}
        onChange={(text) => update(key, text)}
        locale={locale}
        label={title}
        onValidity={controlValidity}
      />
    ) : type === "datetime-local" ? (
      <UserInstantControl
        id={`${id}-${key}`}
        value={fields[key]}
        onChange={(text) => update(key, text ?? "")}
        locale={locale}
        label={title}
        onValidity={controlValidity}
      />
    ) : key === "timeZone" ? (
      <TemporalZoneField
        value={fields.timeZone}
        title={title}
        locale={locale}
        onChange={(text) => update(key, text)}
        onValidity={controlValidity}
        preview={zonePreview}
      />
    ) : (
      <label htmlFor={`${id}-${key}`}>
        {title}
        <input
          id={`${id}-${key}`}
          type={type}
          value={fields[key]}
          placeholder={placeholder}
          aria-describedby={`${id}-meaning${error ? ` ${id}-error` : ""}`}
          onChange={(event) => {
            update(key, event.target.value);
          }}
        />
      </label>
    );
  let preview = "";
  try {
    if (value.kind === "literal" && value.type === "DateRange") {
      const range = dateRangeToInstantRange(
        value.value as unknown as Parameters<typeof dateRangeToInstantRange>[0],
      );
      preview = `${range.start} ≤ instant < ${range.end}`;
    } else if (value.kind === "literal" && value.type === "ZonedDateTimeSpec") {
      const data = value.value as Record<string, JsonValue>;
      preview = `${data.instant} · ${data.timeZone} (${data.offset})`;
    }
  } catch {
    /* Invalid saved values stay visible for correction; they are never executed. */
  }
  let candidates: string[] = [];
  try {
    if (fields.date && fields.time && fields.timeZone)
      candidates = zonedDateTimeCandidates({
        date: fields.date,
        time: fields.time,
        timeZone: fields.timeZone,
        ...(fields.explicitPrecision
          ? { timePrecision: fields.precision }
          : {}),
      });
  } catch {
    /* The editing error is associated with the fields above. */
  }
  return (
    <fieldset className="automation-temporal-input">
      <legend>{label}</legend>
      {(value.type === "ZonedDateTimeSpec" || isWindow) && (
        <label>
          {words("時刻の精度", "Time precision")}
          <select
            value={fields.precision}
            onChange={(event) =>
              update("precision", event.target.value as "minute" | "second", {
                explicitPrecision: true,
                time: "",
                ...(isWindow ? { start: "", end: "" } : {}),
              })
            }
          >
            <option value="minute">
              {words("分（HH:MM、秒は0）", "Minutes (HH:MM, seconds are zero)")}
            </option>
            <option value="second">
              {words("秒（HH:MM:SS）", "Seconds (HH:MM:SS)")}
            </option>
          </select>
          <small>
            {words(
              "精度変更時は入力を空にします。自動で丸めません。",
              "Changing precision clears the editing fields; it does not round values.",
            )}
          </small>
        </label>
      )}
      {value.type === "ZonedDateTimeSpec" ? (
        <>
          {input("date", words("日付", "Date"), "date")}
          {input("time", words("現地時刻", "Local time"), "time")}
          {input(
            "timeZone",
            words("地域（IANA）", "Time zone (IANA)"),
            "text",
            "Asia/Tokyo",
          )}
          <label htmlFor={`${id}-occurrence`}>
            {words("重なる時刻の選択", "Repeated-time occurrence")}
            <select
              id={`${id}-occurrence`}
              value={fields.occurrence}
              onChange={(event) => update("occurrence", event.target.value)}
            >
              <option value="requireUnique">
                {words(
                  "重ならない時刻のみ（重複なら選び直す）",
                  "Require a unique time",
                )}
              </option>
              <option value="earlier">
                {words("早い時点", "Earlier instant")}
                {candidates[0]
                  ? ` · ${candidates[0]} (${offsetAt(candidates[0], fields.timeZone)})`
                  : ""}
              </option>
              <option value="later">
                {words("遅い時点", "Later instant")}
                {candidates.length > 1
                  ? ` · ${candidates.at(-1)} (${offsetAt(candidates.at(-1)!, fields.timeZone)})`
                  : ""}
              </option>
            </select>
          </label>
        </>
      ) : isWindow ? (
        <>
          {input(
            "start",
            words("開始時刻（含む）", "Start time (included)"),
            "time",
          )}
          {input(
            "end",
            words("終了時刻（含まない）", "End time (excluded)"),
            "time",
          )}
          <label>
            {words("終了する日", "End day")}
            <select
              value={fields.endDayOffset}
              onChange={(event) => update("endDayOffset", event.target.value)}
            >
              <option value="">
                {words("選択してください", "Choose a day")}
              </option>
              <option value="0">
                {words("開始と同じ日", "Same day as the start")}
              </option>
              <option value="1">
                {words("開始の翌日", "Day after the start")}
              </option>
            </select>
          </label>
          <fieldset className="automation-window-weekdays">
            <legend>{words("開始する曜日", "Start weekdays")}</legend>
            {[
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ].map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={fields.weekdays.includes(index)}
                  onChange={(event) =>
                    update(
                      "weekdays",
                      event.target.checked
                        ? [...fields.weekdays, index].sort()
                        : fields.weekdays.filter((item) => item !== index),
                    )
                  }
                />
                {locale === "ja"
                  ? ["日", "月", "火", "水", "木", "金", "土"][index]
                  : day}
              </label>
            ))}
          </fieldset>
          {input(
            "timeZone",
            words("地域（IANA）", "Time zone (IANA)"),
            "text",
            "Asia/Tokyo",
          )}
          <small>
            {words(
              "22時から翌2時は「開始の翌日」を選択します。終了時刻は含みません。",
              "For 22:00 to 02:00 next day, choose the day after the start. The end is excluded.",
            )}
          </small>
        </>
      ) : (
        <>
          {input(
            "start",
            value.type === "DateRange"
              ? words("開始日（含む）", "Start date (included)")
              : words("開始 UTC（含む）", "Start UTC (included)"),
            value.type === "DateRange" ? "date" : "datetime-local",
          )}
          {input(
            "end",
            value.type === "DateRange"
              ? words("終了日（含む）", "End date (included)")
              : words("終了 UTC（含まない）", "End UTC (excluded)"),
            value.type === "DateRange" ? "date" : "datetime-local",
          )}
          {value.type === "DateRange" &&
            input(
              "timeZone",
              words(
                "日境界を決める地域（IANA）",
                "Local day-boundary time zone (IANA)",
              ),
              "text",
              "Asia/Tokyo",
            )}
        </>
      )}
      <small id={`${id}-meaning`}>
        {isWindow
          ? words(
              "選んだ開始曜日から終了する日までの地域時間です。開始を含み、終了を含みません。",
              "The local window begins on a selected weekday and ends on the chosen day. Start included, end excluded.",
            )
          : value.type === "DateRange"
            ? words(
                "両端の日を含みます。同じ日なら1暦日。時点への変換は地域の翌日日境界を終端（含まない）にし、24時間×日数では計算しません。0時欠落は当日の最初の有効時刻、重複は早い時点です。",
                "Both dates are included; the same date is one calendar day. Instant conversion excludes the next local day boundary, rather than multiplying days by 24 hours. A missing midnight uses the first valid time; a repeated boundary uses the earlier instant.",
              )
            : isRangeV2
              ? words(
                  "開始を含み、終了を含みません。同じ時点なら空区間です。予約受付窓には空区間を使えません。",
                  "Start included, end excluded. Equal instants form an empty interval. Booking windows must be nonempty.",
                )
              : value.type === "InstantRange"
                ? words(
                    "UTCの開始を含み、終了を含みません。同じ時点の空期間は保存できません。",
                    "The UTC start is included and the end is excluded. An empty range is invalid.",
                  )
                : words(
                    "存在しない現地日時は実行できません。地域や日付を編集すると現地時刻を保って別の時点へ変更し、プレビューで確認します。同じ時点の表示地域だけを変える場合は専用の値ブロックを使います。",
                    "A missing local date/time cannot execute. Editing the date or zone keeps the entered local time and changes the instant shown in the preview. Use the same-instant conversion block to change only the display time zone.",
                  )}
      </small>
      {preview && <output aria-live="polite">{preview}</output>}
      {error && (
        <p role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

function TemporalZoneField({
  value,
  title,
  locale,
  onChange,
  onValidity,
  preview,
}: {
  value: string;
  title: string;
  locale: "ja" | "en";
  onChange: (value: string) => void;
  onValidity: (valid: boolean) => void;
  preview: (zone: string) => string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const words = (ja: string, en: string) => (locale === "ja" ? ja : en);
  useEffect(() => {
    setPending(null);
  }, [value]);
  let before = "",
    after = "",
    valid = false;
  try {
    if (value) before = preview(value);
  } catch {
    /* Keep old saved meaning visible elsewhere. */
  }
  try {
    if (
      pending &&
      pending.length <= 64 &&
      (pending === "UTC" || pending.includes("/"))
    ) {
      new Intl.DateTimeFormat("en", { timeZone: pending }).format(0);
      valid = true;
      after = preview(pending);
    }
  } catch {
    valid = false;
  }
  return (
    <div className="automation-zone-review">
      <label>
        {title}
        <input
          value={pending ?? value}
          placeholder="Asia/Tokyo"
          onChange={(event) => {
            setPending(event.target.value);
            onValidity(false);
          }}
        />
      </label>
      {pending !== null && (
        <section>
          <p>
            {words(
              "現地の日付・時刻を維持します。変更前後の時点を確認し、新しい版として保存してください。",
              "Keep the local date and time. Review the changed instants and save a new revision.",
            )}
          </p>
          <dl>
            <dt>{words("変更前", "Before")}</dt>
            <dd>
              {value || words("未設定", "Not set")} {before}
            </dd>
            <dt>{words("変更後", "After")}</dt>
            <dd>
              {pending || words("未設定", "Not set")} {after}
            </dd>
          </dl>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              onValidity(true);
              onChange(pending);
              setPending(null);
            }}
          >
            {words("確認してこの地域を使う", "Confirm and use this region")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              onValidity(true);
            }}
          >
            {words("地域変更を取り消す", "Cancel region change")}
          </button>
        </section>
      )}
    </div>
  );
}
