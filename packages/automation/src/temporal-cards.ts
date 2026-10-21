import type { TypedExpressionCard, ExpressionCardInput } from "./expression-cards";
import type { ValueType } from "./types";
import {
  DISPLAY_LOCALE_TYPE, OCCURRENCE_TYPE, TEXT_CLEAN_MODE_TYPE, WEEKDAY_TYPE, END_DAY_TYPE,
  displayFormatType, temporalTypesEqual, type TemporalOperator,
} from "./temporal-values";
import { INSTANT_RANGE_V2_TYPE, isLocalTimeType, localTimePrecision, localTimeType } from './temporal-types';

/** Existing typed selector presentation; this does not introduce the pending Scratch UI. */
export function temporalExpressionCards(expectedType: ValueType, _types: readonly ValueType[] = []): TypedExpressionCard[] {
  const cards: TypedExpressionCard[] = [];
  const arg = (type: ValueType, ja: string, en: string, integer = false, minimum?: number, maximum?: number): ExpressionCardInput => ({
    type, label: { ja, en }, ...(integer ? { integer } : {}), ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }),
  });
  const add = (operator: TemporalOperator, ja: string, en: string, outputType: ValueType, inputs: ExpressionCardInput[]) => {
    if (!temporalTypesEqual(outputType,expectedType)) return;
    cards.push({ id: `${operator}:${JSON.stringify(inputs.map((input) => input.type))}`, operator, label: { ja, en }, outputType, inputs });
  };
  const date = () => arg("DateOnly", "日付", "Date"), zone = () => arg("TimeZone", "表示・解決する地域", "Time zone"),
    instant = () => arg("Instant", "UTCの時点", "UTC instant"), zoned = () => arg("ZonedDateTimeSpec", "地域と時点を固定した日時", "Zoned date and time"),
    occurrence = () => arg(OCCURRENCE_TYPE, "重なる時刻の選択（uniqueは重複拒否）", "Time occurrence (unique rejects a fold)"),
    locale = () => arg(DISPLAY_LOCALE_TYPE, "表示言語（固定）", "Display language (fixed)");
  add("time.compose", "時刻を組み立てる", "Compose a local time", "LocalTime", [arg("Number", "時", "Hour", true, 0, 23), arg("Number", "分", "Minute", true, 0, 59)]);
  const localTypes:ValueType[]=['LocalTime',localTimeType('minute'),localTimeType('second')];
  for(const type of localTypes) {
    const precision=localTimePrecision(type)!;
    if(typeof type!=='string')add('time.compose',precision==='second'?'秒までの時刻を組み立てる':'分精度の時刻を組み立てる',`Compose a local time (${precision})`,type,[arg('Number','時','Hour',true,0,23),arg('Number','分','Minute',true,0,59),...(precision==='second'?[arg('Number','秒','Second',true,0,59)]:[])]);
    if(isLocalTimeType(expectedType)&&!temporalTypesEqual(type,expectedType))add('time.convertPrecision',localTimePrecision(expectedType)==='minute'?'時刻を明示的に分へ変える（秒を除く）':'時刻を明示的に秒へ変える（省略秒は0）',localTimePrecision(expectedType)==='minute'?'Convert to minutes explicitly (discard seconds)':'Convert to seconds explicitly (omitted seconds are zero)',expectedType,[arg(type,'変換元の時刻','Source local time')]);
    if(typeof type!=='string')add('zoned.compose','精度を指定した地域の日時を組み立てる','Compose a zoned date/time with explicit precision','ZonedDateTimeSpec',[date(),arg(type,'時刻（精度を固定）','Local time (fixed precision)'),zone(),occurrence()]);
    add('window.build','曜日と翌日を指定して夜間窓を作る','Build a time window with weekdays and an explicit end day','LocalTimeWindowSpec',[arg(type,'開始時刻（含む）','Start time (included)'),arg(type,'終了時刻（含まない）','End time (excluded)'),arg(END_DAY_TYPE,'終了日（同日か翌日）','End day (same or next)'),arg({kind:'List',element:WEEKDAY_TYPE},'開始する曜日','Start weekdays'),zone()]);
    if(typeof type!=='string')add('temporal.format','精度を保って時刻を表示する','Format a local time with its precision','PlainText',[arg(type,'表示する時刻','Local time'),zone(),arg(displayFormatType(type),'表示形式','Display format'),locale()]);
  }
  add("zoned.compose", "地域の日時を組み立てる", "Compose a zoned date and time", "ZonedDateTimeSpec", [date(), arg("LocalTime", "時刻", "Local time"), zone(), occurrence()]);
  add("zoned.fromInstant", "同じ時点を別の地域で表示する", "Show the same instant in a time zone", "ZonedDateTimeSpec", [instant(), zone()]);
  add("zoned.resolve", "地域の日時から固定時点を読む", "Read the resolved instant", "Instant", [zoned()]);
  add("zoned.addDays", "同じ現地時刻で暦日を動かす", "Move by calendar days at the same local time", "ZonedDateTimeSpec", [zoned(), arg("Number", "暦日数（24時間と別）", "Calendar days (distinct from 24 hours)", true, -36600, 36600), occurrence()]);
  add("date.weekdayEnum", "日付の曜日を選択値で読む", "Read the registered weekday of a date", WEEKDAY_TYPE, [date()]);
  add("zoned.weekday", "地域の日時の曜日を読む", "Read the zoned weekday", WEEKDAY_TYPE, [zoned()]);
  add("dateRange.build", "開始日と終了日を含む期間を作る", "Build an inclusive date range", "DateRange", [arg("DateOnly", "開始日（含む）", "Start date (included)"), arg("DateOnly", "終了日（含む）", "End date (included)"), zone()]);
  add("instantRange.build", "開始を含み終了を含まない期間を作る", "Build a half-open instant range", "InstantRange", [arg("Instant", "開始（含む）", "Start (included)"), arg("Instant", "終了（含まない）", "End (excluded)")]);
  add('instantRange.build','空区間も表せる時点の期間を作る','Build an instant range (an equal endpoint is empty)',INSTANT_RANGE_V2_TYPE,[arg('Instant','開始（含む）','Start (included)'),arg('Instant','終了（含まない）','End (excluded)')]);
  add('dateRange.toInstants','日付の期間を地域の日境界へ変える（v2）','Resolve a date range at local day boundaries (v2)',INSTANT_RANGE_V2_TYPE,[arg('DateRange','両端の日を含む期間','Inclusive date range')]);
  add("dateRange.toInstants", "日付の期間を地域の日境界へ変える", "Resolve a date range at local day boundaries", "InstantRange", [arg("DateRange", "両端の日を含む期間", "Inclusive date range")]);
  add("range.contains", "日付が期間内か", "Date is in the range", "Boolean", [date(), arg("DateRange", "日付の期間", "Date range")]);
  add("range.contains", "時点が期間内か", "Instant is in the range", "Boolean", [instant(), arg("InstantRange", "開始を含み終了を含まない期間", "Half-open instant range")]);
  add('range.contains','時点が期間v2内か（空区間は常に範囲外）','Instant is in a v2 range (an empty range contains nothing)','Boolean',[instant(),arg(INSTANT_RANGE_V2_TYPE,'開始を含み終了を含まない期間v2','Half-open instant range v2')]);
  add('window.contains','時点が曜日・翌日指定の窓内か','Instant is within the weekday/local-time window','Boolean',[instant(),arg('LocalTimeWindowSpec','開始曜日と終了日を固定した窓','Window with fixed start weekdays and end day')]);
  add("number.format", "数値を桁数と言語を指定して表示する", "Format a number with fixed digits and language", "PlainText", [arg("Number", "表示する数値（元の値は不変）", "Number (original value unchanged)"), arg("Number", "小数桁数", "Fraction digits", true, 0, 8), locale()]);
  add("text.clean", "空白や改行を明示した規則で整える", "Clean spaces or newlines with an explicit rule", "PlainText", [arg("PlainText", "文字", "Text"), arg(TEXT_CLEAN_MODE_TYPE, "整形規則", "Cleanup rule")]);
  for (const type of ["DateOnly", "LocalTime", "Instant", "ZonedDateTimeSpec"] as const)
    add("temporal.format", `${type}を形式と言語を指定して表示する`, `Format ${type} with a fixed style and language`, "PlainText", [arg(type, "表示する日時", "Date or time"), zone(), arg(displayFormatType(type), "表示形式", "Display format"), locale()]);
  return cards;
}
