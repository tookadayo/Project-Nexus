"use client";

import { useMemo } from "react";
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
  parseInstant,
  zonedDateTimeCandidates,
} from "../../../../packages/automation/src/datetime";
import {nextElapsedOccurrences} from '../../../../packages/automation/src/elapsed-schedule';
import { words, uid, typeName, type Locale } from "./model";
import { AUTOMATION_CATALOG } from "../../../../packages/automation/src/catalog";
import {
  INTERNAL_EVENT_FIELDS,
  INTERACTION_EVENT_FIELDS,
} from "../../../../packages/automation/src/event-contract";

export function elapsedInputInstant(value:string):string {
  if(!value)return '';
  try{return parseInstant(value+(value.length===16?':00Z':'Z'));}catch{return value;}
}

export function TriggerEditor({
  trigger,
  onChange,
  locale,
  timeZone = "UTC",
}: {
  trigger: TriggerDefinition;
  onChange: (next: TriggerDefinition) => void;
  locale: Locale;
  timeZone?: string;
}) {
  const preview = useMemo(() => {
    if (trigger.kind !== "schedule") return { items: [], error: "" };
    try {
      const rule = trigger.schedule;
      if(rule.kind==='elapsed')return {items:nextElapsedOccurrences(rule,new Date(),5),error:''};
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
      if(trigger.schedule.kind==='elapsed')return {items:[],error:words(locale,'基準日時・終了日時（UTC）と、正の整数の経過秒を入力してください。終了日時は基準日時より後の100年以内です。','Enter UTC anchor and end instants, and a positive whole number of elapsed seconds. The end must follow the anchor within 100 years.')};
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
      : { date: "", time: "", timeZone };
  const recurring: RecurrenceSpec =
    trigger.kind === "schedule" && trigger.schedule.kind === "recurring"
      ? trigger.schedule
      : {
          kind: "recurring",
          frequency: "weekly",
          time: "",
          timeZone,
          startDate: "",
          endDate: "",
          weekdays: [],
          missingTime: "skip",
          repeatedTime: "earlier",
          pastOccurrences: "skip",
        };
  const elapsed:ElapsedScheduleSpec=trigger.kind==='schedule'&&trigger.schedule.kind==='elapsed'?trigger.schedule:{kind:'elapsed',anchor:'',intervalSeconds:Number.NaN,end:'',pastOccurrences:'skip'};
  const setElapsed=(patch:Partial<ElapsedScheduleSpec>)=>onChange({kind:'schedule',schedule:{...elapsed,...patch}});
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
            const kind = event.target.value;
            if (kind === "once")
              onChange({
                kind: "schedule",
                schedule: { kind: "once", at: once },
              });
            else if (kind === "recurring")
              onChange({ kind: "schedule", schedule: recurring });
            else if(kind==='elapsed')onChange({kind:'schedule',schedule:elapsed});
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
          <option value="elapsed">{words(locale,'経過時間ごとに新しい処理を開始','Start a new run after each elapsed interval')}</option>
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
          {trigger.schedule.kind==='elapsed'?(
            <div className="automation-date-grid">
              <label>{words(locale,'基準日時（UTC・含む）','Anchor instant (UTC, included)')}<input type="datetime-local" step="1" value={elapsed.anchor.endsWith('Z')?elapsed.anchor.slice(0,19):elapsed.anchor} onChange={event=>setElapsed({anchor:elapsedInputInstant(event.target.value)})}/></label>
              <label>{words(locale,'間隔（経過秒）','Interval (elapsed seconds)')}<input type="number" min="1" step="1" value={Number.isFinite(elapsed.intervalSeconds)?elapsed.intervalSeconds:''} onChange={event=>setElapsed({intervalSeconds:event.target.value===''?Number.NaN:Number(event.target.value)})}/></label>
              <label>{words(locale,'終了日時（UTC・含まない）','End instant (UTC, excluded)')}<input type="datetime-local" step="1" value={elapsed.end.endsWith('Z')?elapsed.end.slice(0,19):elapsed.end} onChange={event=>setElapsed({end:elapsedInputInstant(event.target.value)})}/></label>
              <p className="automation-hint">{words(locale,'基準日時から同じ経過時間ごとに、別の処理を開始します。夏時間で間隔は変わりません。終了日時以降や過ぎた回は実行しません。各処理の期限は最大7日です。','Starts an independent run at each interval from the fixed anchor. Daylight saving does not change the elapsed interval. The end instant and missed occurrences are excluded. Each run lasts at most seven days.')}</p>
            </div>
          ):trigger.schedule.kind === "once" ? (
            <div className="automation-date-grid">
              <label>
                {words(locale, "日付", "Date")}
                <input
                  type="date"
                  value={once.date}
                  onChange={(event) => setOnce({ date: event.target.value })}
                />
              </label>
              <label>
                {words(locale, "現地の時刻", "Local time")}
                <input
                  type="time"
                  value={once.time}
                  onChange={(event) => setOnce({ time: event.target.value })}
                />
              </label>
              <TimeZoneInput
                value={once.timeZone}
                locale={locale}
                onChange={(value) => setOnce({ timeZone: value })}
              />
            </div>
          ) : (
            <>
              <div className="automation-date-grid">
                <label>
                  {words(locale, "開始日（含む）", "Start date (included)")}
                  <input
                    type="date"
                    value={recurring.startDate}
                    onChange={(event) =>
                      setRecurring({ startDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  {words(locale, "終了日（含む）", "End date (included)")}
                  <input
                    type="date"
                    value={recurring.endDate}
                    onChange={(event) =>
                      setRecurring({ endDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  {words(locale, "現地の時刻", "Local time")}
                  <input
                    type="time"
                    value={recurring.time}
                    onChange={(event) =>
                      setRecurring({ time: event.target.value })
                    }
                  />
                </label>
                <TimeZoneInput
                  value={recurring.timeZone}
                  locale={locale}
                  onChange={(value) => setRecurring({ timeZone: value })}
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
              {recurring.frequency === "monthly" && (
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
          {trigger.schedule.kind!=='elapsed'&&<p className="automation-notice">{words(locale,'地域の時刻規則が変わった場合は、将来の開始を停止します。新しい版を保存し、候補日時を再確認して有効にしてください。','If regional time rules change, future starts stop. Save a new revision, review the candidate dates, then explicitly enable it.')}</p>}
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
function TimeZoneInput({
  value,
  onChange,
  locale,
}: {
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
}) {
  return (
    <label>
      {words(locale, "地域（IANAタイムゾーン）", "Region (IANA time zone)")}
      <input
        value={value}
        list="automation-time-zones"
        placeholder="Asia/Tokyo"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id="automation-time-zones">
        <option value="UTC" />
        <option value="Asia/Tokyo" />
        <option value="America/New_York" />
        <option value="Europe/London" />
      </datalist>
    </label>
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
  "Instant",
  "TimeZone",
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
              <label>
                {words(locale, "入力の種類", "Input type")}
                <select
                  value={JSON.stringify(input.type)}
                  onChange={(e) => {
                    const type = INPUT_TYPES.find(
                      (item) => JSON.stringify(item) === e.target.value,
                    );
                    if (type)
                      onChange({
                        ...trigger,
                        inputs: trigger.inputs.map((item) =>
                          item.id === input.id ? { ...item, type } : item,
                        ),
                      });
                  }}
                >
                  {INPUT_TYPES.map((type) => (
                    <option
                      key={JSON.stringify(type)}
                      value={JSON.stringify(type)}
                    >
                      {typeName(type)}
                    </option>
                  ))}
                </select>
              </label>
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
