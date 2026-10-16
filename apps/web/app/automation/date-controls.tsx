"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  parseLocalTimeForPrecision,
  parseUserDateInput,
  parseUserInstantInput,
} from "../../../../packages/automation/src/temporal-types";
import { words, type Locale } from "./model";

interface ControlProps {
  locale: Locale;
  label: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  onValidity?: (valid: boolean) => void;
}

const dateText = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const validDate = (value: string) => {
  try {
    return parseUserDateInput(value);
  } catch {
    return undefined;
  }
};
const browserToday = () => {
  const now = new Date();
  return dateText(now.getFullYear(), now.getMonth() + 1, now.getDate());
};
const monthDays = (year: number, month: number) =>
  new Date(`${dateText(year, month, 1)}T00:00:00.000Z`).getUTCMonth() === 1
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/** Calendar navigation never mutates the selected date or interprets a time zone. */
export function calendarMove(value: string, days: number): string {
  const date = new Date(`${parseUserDateInput(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const moved = date.toISOString().slice(0, 10);
  return validDate(moved) ?? value;
}
export function calendarMonth(value: string, months: number): string {
  const [year, month, day] = parseUserDateInput(value).split("-").map(Number);
  const serial = year! * 12 + month! - 1 + months;
  const nextYear = Math.floor(serial / 12),
    nextMonth = (((serial % 12) + 12) % 12) + 1;
  if (nextYear < 100 || nextYear > 9999) return value;
  return dateText(
    nextYear,
    nextMonth,
    Math.min(day!, monthDays(nextYear, nextMonth)),
  );
}

/** A zero fraction is display syntax; nonzero fractions stay entirely untouched. */
export function instantInputState(value: string | undefined): {
  draft: string;
  preserved: boolean;
} {
  if (!value) return { draft: "", preserved: false };
  const noZeroFraction = value.replace(/\.0+Z$/, "Z");
  try {
    parseUserInstantInput(noZeroFraction);
    return { draft: noZeroFraction.replace(/Z$/, ""), preserved: false };
  } catch {
    return { draft: "", preserved: true };
  }
}

function useValidity(onValidity: ControlProps["onValidity"]) {
  const callback = useRef(onValidity);
  callback.current = onValidity;
  useEffect(() => () => callback.current?.(true), []);
  return (valid: boolean) => callback.current?.(valid);
}

export function DateOnlyControl({
  value,
  onChange,
  locale,
  label,
  disabled,
  id,
  onValidity,
  todayDate,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  /** An explicit Today action may use the saved guild's date supplied by its caller. */
  todayDate?: string;
}) {
  const generated = useId(),
    inputId = id ?? generated;
  const [draft, setDraft] = useState(value),
    [error, setError] = useState(false);
  const [open, setOpen] = useState(false),
    [cursor, setCursor] = useState(value || "2000-01-01");
  const current = useRef(value),
    calendar = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  const needsFocus = useRef(false),
    validity = useValidity(onValidity);
  useEffect(() => {
    if (value === current.current) return;
    current.current = value;
    setDraft(value);
    setError(false);
    onValidity?.(true);
    setOpen(false);
  }, [value, onValidity]);
  useEffect(() => {
    if (open && needsFocus.current) {
      needsFocus.current = false;
      calendar.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)
        ?.focus();
    }
  }, [open, cursor]);
  const choose = (next: string) => {
    setDraft(next);
    setError(false);
    validity(true);
    current.current = next;
    onChange(next);
  };
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const move = (next: string) => {
    needsFocus.current = true;
    setCursor(next);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string | undefined;
    if (event.key === "ArrowLeft") next = calendarMove(day, -1);
    if (event.key === "ArrowRight") next = calendarMove(day, 1);
    if (event.key === "ArrowUp") next = calendarMove(day, -7);
    if (event.key === "ArrowDown") next = calendarMove(day, 7);
    const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    if (event.key === "Home") next = calendarMove(day, -weekday);
    if (event.key === "End") next = calendarMove(day, 6 - weekday);
    if (event.key === "PageUp")
      next = calendarMonth(day, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown")
      next = calendarMonth(day, event.shiftKey ? 12 : 1);
    if (next) {
      event.preventDefault();
      move(next);
    }
  };
  const validCursor = validDate(cursor) ?? "2000-01-01";
  const [year, month] = validCursor.split("-").map(Number);
  const leading =
    (new Date(`${dateText(year!, month!, 1)}T00:00:00.000Z`).getUTCDay() + 6) %
    7;
  const cells = Array.from(
    { length: Math.ceil((leading + monthDays(year!, month!)) / 7) * 7 },
    (_, index) => {
      const day = index - leading + 1;
      return day >= 1 && day <= monthDays(year!, month!)
        ? dateText(year!, month!, day)
        : undefined;
    },
  );
  return (
    <div className="automation-date-control" style={{ minWidth: 0 }}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        disabled={disabled}
        value={draft}
        aria-invalid={error || undefined}
        aria-describedby={[
          `${inputId}-hint`,
          error && `${inputId}-error`,
          describedBy,
        ]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!next || validDate(next)) choose(next);
          else {
            setError(true);
            validity(false);
          }
        }}
      />
      <small id={`${inputId}-hint`}>
        {words(
          locale,
          "年4桁-月2桁-日2桁。地域や時刻を含まない日付です。",
          "YYYY-MM-DD: a calendar date without a time or time zone.",
        )}
      </small>
      {error && (
        <p role="alert" id={`${inputId}-error`}>
          {words(
            locale,
            "存在する日付を YYYY-MM-DD で入力してください。省略や曖昧な日付は補完しません。",
            "Enter an existing date as YYYY-MM-DD. Incomplete or ambiguous dates are not filled in.",
          )}
        </p>
      )}
      <button
        ref={toggle}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`${inputId}-calendar`}
        onClick={() => {
          if (open) return close();
          needsFocus.current = true;
          setCursor(
            validDate(draft) ?? validDate(todayDate ?? "") ?? browserToday(),
          );
          setOpen(true);
        }}
      >
        {words(locale, "カレンダーを開く", "Open calendar")}
      </button>
      {open && (
        <div
          ref={calendar}
          id={`${inputId}-calendar`}
          role="dialog"
          aria-label={words(
            locale,
            `${label}のカレンダー`,
            `Calendar for ${label}`,
          )}
          style={{
            border: "1px solid currentColor",
            padding: "0.5rem",
            maxWidth: "24rem",
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            <button
              type="button"
              disabled={disabled || year === 100}
              onClick={() => move(calendarMonth(validCursor, -12))}
            >
              {words(locale, "前年", "Previous year")}
            </button>
            <button
              type="button"
              disabled={disabled || (year === 100 && month === 1)}
              onClick={() => move(calendarMonth(validCursor, -1))}
            >
              {words(locale, "前月", "Previous month")}
            </button>
            <label>
              {words(locale, "年", "Year")}
              <input
                type="number"
                min={100}
                max={9999}
                step={1}
                value={year}
                style={{ width: "6em" }}
                disabled={disabled}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isSafeInteger(next) && next >= 100 && next <= 9999)
                    setCursor(dateText(next, month!, 1));
                }}
              />
            </label>
            <label>
              {words(locale, "月", "Month")}
              <select
                value={month}
                disabled={disabled}
                onChange={(event) =>
                  setCursor(dateText(year!, Number(event.target.value), 1))
                }
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={disabled || (year === 9999 && month === 12)}
              onClick={() => move(calendarMonth(validCursor, 1))}
            >
              {words(locale, "翌月", "Next month")}
            </button>
            <button
              type="button"
              disabled={disabled || year === 9999}
              onClick={() => move(calendarMonth(validCursor, 12))}
            >
              {words(locale, "翌年", "Next year")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => move(validDate(todayDate ?? "") ?? browserToday())}
            >
              {words(locale, "今日へ戻る", "Go to today")}
            </button>
          </div>
          <p aria-live="polite">{`${year}-${String(month).padStart(2, "0")}`}</p>
          <table
            role="grid"
            aria-label={words(locale, "日付を選択", "Choose a date")}
            style={{ width: "100%", tableLayout: "fixed" }}
          >
            <thead>
              <tr>
                {(locale === "ja"
                  ? ["月", "火", "水", "木", "金", "土", "日"]
                  : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                ).map((day) => (
                  <th key={day} scope="col">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, row) => (
                <tr key={row}>
                  {cells.slice(row * 7, row * 7 + 7).map((day, column) => (
                    <td
                      key={column}
                      role="gridcell"
                      aria-selected={day ? day === value : undefined}
                    >
                      {day && (
                        <button
                          data-date={day}
                          type="button"
                          disabled={disabled}
                          tabIndex={day === validCursor ? 0 : -1}
                          aria-label={day}
                          aria-current={
                            day ===
                            (validDate(todayDate ?? "") ?? browserToday())
                              ? "date"
                              : undefined
                          }
                          style={{
                            width: "100%",
                            minWidth: 0,
                            padding: "0.3rem 0",
                            border:
                              day === value
                                ? "2px solid currentColor"
                                : undefined,
                          }}
                          onKeyDown={(event) => keyboard(event, day)}
                          onClick={() => {
                            choose(day);
                            close();
                          }}
                        >
                          {Number(day.slice(8))}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <small>
            {words(
              locale,
              "矢印で日・週、PageUp/PageDownで月、Shiftと併用で年を移動。Enterで選択、Escで閉じます。",
              "Arrows move days or weeks. PageUp/PageDown move months; add Shift for years. Enter selects; Esc closes.",
            )}
          </small>
          <button type="button" onClick={close}>
            {words(locale, "閉じる", "Close")}
          </button>
        </div>
      )}
    </div>
  );
}

export function LocalTimeControl({
  value,
  onChange,
  precision,
  locale,
  label,
  disabled,
  id,
  onValidity,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  precision: "minute" | "second";
}) {
  const generated = useId(),
    inputId = id ?? generated;
  const [draft, setDraft] = useState(value),
    [error, setError] = useState(false);
  const current = useRef(value),
    validity = useValidity(onValidity);
  useEffect(() => {
    if (value === current.current) return;
    current.current = value;
    setDraft(value);
    setError(false);
    onValidity?.(true);
  }, [value, onValidity]);
  return (
    <div className="automation-time-control">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="time"
        step={precision === "minute" ? 60 : 1}
        disabled={disabled}
        value={draft}
        aria-invalid={error || undefined}
        aria-describedby={[
          `${inputId}-hint`,
          error && `${inputId}-error`,
          describedBy,
        ]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            // Native time inputs may omit an explicitly entered :00 component.
            // The fixed second descriptor and visible explanation make it :00,
            // rather than changing the descriptor or treating it as a whole minute.
            const parsed =
              precision === "second" && /^\d{2}:\d{2}$/.test(next)
                ? `${next}:00`
                : next;
            if (parsed) parseLocalTimeForPrecision(parsed, precision);
            setError(false);
            validity(true);
            current.current = parsed;
            onChange(parsed);
          } catch {
            setError(true);
            validity(false);
          }
        }}
      />
      <small id={`${inputId}-hint`}>
        {precision === "minute"
          ? words(
              locale,
              "分精度（HH:MM）。秒は00です。18:30は18:30台全体を表しません。",
              "Minute precision (HH:MM): seconds are 00. 18:30 is not the whole minute.",
            )
          : words(
              locale,
              "秒精度（HH:MM:SS）。秒の省略は00秒です。ミリ秒は入力しません。",
              "Second precision (HH:MM:SS). Omitted seconds mean 00. Fractional seconds are not an input precision.",
            )}
      </small>
      {error && (
        <p id={`${inputId}-error`} role="alert">
          {words(
            locale,
            "表示された精度で有効な時刻を入力してください。",
            "Enter a valid time using the displayed precision.",
          )}
        </p>
      )}
    </div>
  );
}

export function UserInstantControl({
  value,
  onChange,
  locale,
  label,
  disabled,
  id,
  onValidity,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const generated = useId(),
    inputId = id ?? generated;
  const [state, setState] = useState(() => instantInputState(value)),
    [error, setError] = useState(false),
    [replacing, setReplacing] = useState(false);
  const current = useRef(value),
    validity = useValidity(onValidity);
  useEffect(() => {
    if (value === current.current) return;
    current.current = value;
    setState(instantInputState(value));
    setError(false);
    setReplacing(false);
    onValidity?.(true);
  }, [value, onValidity]);
  const edit = !state.preserved || replacing;
  return (
    <div className="automation-instant-control">
      {state.preserved && (
        <>
          <label htmlFor={`${inputId}-saved`}>{label}</label>
          <input
            id={`${inputId}-saved`}
            type="text"
            value={value ?? ""}
            readOnly
            aria-describedby={`${inputId}-saved-hint`}
          />
          <small id={`${inputId}-saved-hint`}>
            {words(
              locale,
              "保存済みの精度をそのまま表示しています。他の欄を編集してもこの値は変更されません。",
              "The complete saved precision is shown. Editing other fields preserves this value.",
            )}
          </small>
          {!replacing && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setReplacing(true);
                setState({ ...state, draft: "" });
                validity(false);
              }}
            >
              {words(
                locale,
                "日時を明示的に置き換える",
                "Explicitly replace date and time",
              )}
            </button>
          )}
        </>
      )}
      {edit && (
        <>
          <label htmlFor={inputId}>
            {state.preserved
              ? words(
                  locale,
                  `${label}の置換値（UTC）`,
                  `Replacement for ${label} (UTC)`,
                )
              : label}
          </label>
          <input
            id={inputId}
            type="datetime-local"
            step={1}
            value={state.draft}
            disabled={disabled}
            aria-invalid={error || undefined}
            aria-describedby={[
              `${inputId}-hint`,
              error && `${inputId}-error`,
              describedBy,
            ]
              .filter(Boolean)
              .join(" ")}
            onChange={(event) => {
              const next = event.target.value;
              setState({ ...state, draft: next });
              try {
                const parsed = next ? parseUserInstantInput(next) : undefined;
                setError(false);
                validity(true);
                current.current = parsed;
                if (state.preserved) {
                  setState(instantInputState(parsed));
                  setReplacing(false);
                }
                onChange(parsed);
              } catch {
                setError(true);
                validity(false);
              }
            }}
          />
          <small id={`${inputId}-hint`}>
            {words(
              locale,
              "UTCの年月日と時刻。分または秒まで入力できます。秒を省略すると00秒です。ミリ秒は入力できません。",
              "UTC date and time to minutes or seconds. Omitted seconds mean 00. Fractional seconds are not accepted.",
            )}
          </small>
          {error && (
            <p id={`${inputId}-error`} role="alert">
              {words(
                locale,
                "有効な年月日と時刻を秒までで入力してください。小数秒は使えません。",
                "Enter a valid date and time to seconds. Fractional seconds are not accepted.",
              )}
            </p>
          )}
          {state.preserved && (
            <button
              type="button"
              onClick={() => {
                setState(instantInputState(value));
                setReplacing(false);
                setError(false);
                validity(true);
              }}
            >
              {words(locale, "置換を取り消す", "Cancel replacement")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
