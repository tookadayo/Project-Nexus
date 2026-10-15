/** Registered pure date/time, range and display contracts. No clock or external I/O. */
import {
  addCalendarDays,
  assertTimeZone,
  dateRangeToInstantRange,
  isWithinInstantRange,
  offsetAt,
  parseDateOnly,
  parseInstant,
  parseLocalTime,
  resolveZonedDateTime,
  validateInstantRange,
  zonedDateTimeCandidates,
} from "./datetime";
import type {
  DateRange,
  InstantRange,
  JsonValue,
  ValueType,
  ZonedDateTimeSpec,
} from "./types";

export class TemporalValueError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TemporalValueError";
  }
}
const fail = (code: string, message: string): never => {
  throw new TemporalValueError(code, message);
};
export const WEEKDAY_TYPE: ValueType = {
  kind: "Enum",
  values: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
};
export const OCCURRENCE_TYPE: ValueType = {
  kind: "Enum", values: ["requireUnique", "earlier", "later"],
};
export const DISPLAY_LOCALE_TYPE: ValueType = {
  kind: "Enum", values: ["ja-JP", "en-US"],
};
export const TEXT_CLEAN_MODE_TYPE: ValueType = {
  kind: "Enum", values: ["trim", "lineFeed", "horizontalSpaces", "blankLines"],
};
export const TEMPORAL_OPERATORS = [
  "time.compose", "zoned.compose", "zoned.fromInstant", "zoned.resolve",
  "zoned.addDays", "date.weekdayEnum", "zoned.weekday", "temporal.format",
  "dateRange.build", "instantRange.build", "dateRange.toInstants", "range.contains",
  "number.format", "text.clean",
] as const;
export type TemporalOperator = (typeof TEMPORAL_OPERATORS)[number];
export function isTemporalOperator(operator: string): operator is TemporalOperator {
  return (TEMPORAL_OPERATORS as readonly string[]).includes(operator);
}
export interface ZonedDateTimeValue extends ZonedDateTimeSpec {
  /** Preserve the precise instant when merely changing its displayed time zone. */
  instant: string;
  offset: string;
}
const object = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("TEMPORAL_VALUE", "A registered structured date/time value is required.");
  return value as Record<string, JsonValue>;
};
const string = (value: JsonValue | undefined): string => {
  if (typeof value !== "string") fail("TEMPORAL_TEXT", "A typed date/time or registered choice is required.");
  return value as string;
};
function exactKeys(value: Record<string, JsonValue>, required: string[], optional: string[] = []) {
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => ![...required, ...optional].includes(key)))
    fail("TEMPORAL_SCHEMA", "Choose the registered date/time fields only.");
}
function integer(value: JsonValue | undefined, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    fail("TEMPORAL_INTEGER", "Enter an integer within the displayed limits.");
  return value as number;
}
function enumChoice(type: ValueType, value: JsonValue | undefined): string {
  const text = string(value);
  if (typeof type === "string" || type.kind !== "Enum" || !type.values.includes(text))
    fail("TEMPORAL_CHOICE", "Choose a registered format, language or time occurrence.");
  return text;
}
export function temporalTypesEqual(a:ValueType,b:ValueType):boolean {
  if(typeof a==='string'||typeof b==='string')return a===b;
  return a.kind==='Enum'&&b.kind==='Enum'&&a.values.length===b.values.length&&a.values.every((value,index)=>value===b.values[index]);
}
const sameType=temporalTypesEqual;

export function displayFormatType(type: ValueType): ValueType {
  return { kind: "Enum", values: type === "DateOnly"
    ? ["iso", "date", "weekday"]
    : type === "LocalTime" ? ["iso", "time"]
      : ["iso", "date", "time", "dateTime", "weekday"] };
}
/** Stable stored enum keys have ordinary, translated labels in value inputs. */
export function temporalChoiceLabel(type: ValueType, value: string, locale: "ja" | "en"): string {
  const word=(ja:string,en:string)=>locale==='ja'?ja:en;
  if(sameType(type,DISPLAY_LOCALE_TYPE))return value==='ja-JP'?word('日本語（日本）','Japanese (Japan)'):word('英語（米国）','English (US)');
  if(sameType(type,OCCURRENCE_TYPE))return ({requireUnique:word('重ならない時刻だけ','Require a unique time'),earlier:word('重なる場合は早い時点','Earlier instant in a fold'),later:word('重なる場合は遅い時点','Later instant in a fold')} as Record<string,string>)[value]??value;
  if(sameType(type,TEXT_CLEAN_MODE_TYPE))return ({trim:word('前後の空白を除く','Trim surrounding whitespace'),lineFeed:word('改行を LF にそろえる','Normalize newlines to LF'),horizontalSpaces:word('横の空白を1つにする','Collapse horizontal spaces'),blankLines:word('連続する空行を1つにする','Collapse consecutive blank lines')} as Record<string,string>)[value]??value;
  if(sameType(type,WEEKDAY_TYPE))return ({monday:word('月曜日','Monday'),tuesday:word('火曜日','Tuesday'),wednesday:word('水曜日','Wednesday'),thursday:word('木曜日','Thursday'),friday:word('金曜日','Friday'),saturday:word('土曜日','Saturday'),sunday:word('日曜日','Sunday')} as Record<string,string>)[value]??value;
  if(['DateOnly','LocalTime','Instant'].some(candidate=>sameType(type,displayFormatType(candidate as ValueType))))return ({iso:word('ISO形式（時点はUTC）','ISO (instants in UTC)'),date:word('日付','Date'),time:word('時刻','Time'),dateTime:word('日付と時刻','Date and time'),weekday:word('曜日','Weekday')} as Record<string,string>)[value]??value;
  return value;
}
export interface TemporalSignature { arguments: ValueType[]; output: ValueType }
/** This signature is used by both recursive server validation and the editor. */
export function temporalSignature(operator: TemporalOperator, args: readonly ValueType[]): TemporalSignature {
  const n: ValueType = "Number", date: ValueType = "DateOnly", z: ValueType = "ZonedDateTimeSpec";
  let signature: TemporalSignature;
  switch (operator) {
    case "time.compose": signature = { arguments: [n, n], output: "LocalTime" }; break;
    case "zoned.compose": signature = { arguments: [date, "LocalTime", "TimeZone", OCCURRENCE_TYPE], output: z }; break;
    case "zoned.fromInstant": signature = { arguments: ["Instant", "TimeZone"], output: z }; break;
    case "zoned.resolve": signature = { arguments: [z], output: "Instant" }; break;
    case "zoned.addDays": signature = { arguments: [z, n, OCCURRENCE_TYPE], output: z }; break;
    case "date.weekdayEnum": signature = { arguments: [date], output: WEEKDAY_TYPE }; break;
    case "zoned.weekday": signature = { arguments: [z], output: WEEKDAY_TYPE }; break;
    case "dateRange.build": signature = { arguments: [date, date, "TimeZone"], output: "DateRange" }; break;
    case "instantRange.build": signature = { arguments: ["Instant", "Instant"], output: "InstantRange" }; break;
    case "dateRange.toInstants": signature = { arguments: ["DateRange"], output: "InstantRange" }; break;
    case "range.contains": {
      const range = args[0] === "DateOnly" ? "DateRange" : "InstantRange";
      signature = { arguments: [range === "DateRange" ? "DateOnly" : "Instant", range], output: "Boolean" };
      break;
    }
    case "number.format": signature = { arguments: [n, n, DISPLAY_LOCALE_TYPE], output: "PlainText" }; break;
    case "text.clean": signature = { arguments: ["PlainText", TEXT_CLEAN_MODE_TYPE], output: "PlainText" }; break;
    case "temporal.format": {
      const type = args[0]!;
      if (!["DateOnly", "LocalTime", "Instant", "ZonedDateTimeSpec"].includes(String(type)))
        fail("TEMPORAL_TYPE", "Choose a date, local time, instant or zoned date/time.");
      signature = { arguments: [type, "TimeZone", displayFormatType(type), DISPLAY_LOCALE_TYPE], output: "PlainText" };
      break;
    }
  }
  if (args.length !== signature.arguments.length || args.some((type, i) => !sameType(type, signature.arguments[i]!)))
    fail("TEMPORAL_TYPE", "The date/time expression inputs do not match its registered types.");
  return signature;
}

export function instantInTimeZone(instantInput: string, timeZone: string): ZonedDateTimeValue {
  const instant = parseInstant(instantInput);
  assertTimeZone(timeZone);
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = parseDateOnly(`${values.year!.padStart(4, "0")}-${values.month}-${values.day}`);
  const time = parseLocalTime(`${values.hour}:${values.minute}`);
  const offset = offsetAt(instant, timeZone);
  const candidates = zonedDateTimeCandidates({ date, time, timeZone });
  const minute = new Date(Math.floor(Date.parse(instant) / 60000) * 60000).toISOString();
  const occurrence = candidates.length > 1 ? (candidates.at(-1) === minute ? "later" : "earlier") : undefined;
  return { date, time, timeZone, ...(occurrence ? { occurrence } : {}), instant, offset };
}
export function composeZonedValue(date: string, time: string, timeZone: string, occurrence: string): ZonedDateTimeValue {
  const selected = enumChoice(OCCURRENCE_TYPE, occurrence);
  const spec: ZonedDateTimeSpec = { date: parseDateOnly(date), time: parseLocalTime(time), timeZone,
    ...(selected === "requireUnique" ? {} : { occurrence: selected as "earlier" | "later" }) };
  return instantInTimeZone(resolveZonedDateTime(spec), timeZone);
}
export function validateTemporalValue(type: ValueType, value: JsonValue): boolean {
  if (!["ZonedDateTimeSpec", "DateRange", "InstantRange"].includes(String(type))) return false;
  const entry = object(value);
  if (type === "ZonedDateTimeSpec") {
    exactKeys(entry, ["date", "time", "timeZone", "instant", "offset"], ["occurrence"]);
    const canonical = instantInTimeZone(string(entry.instant), string(entry.timeZone));
    if (Object.entries(canonical).some(([key, data]) => entry[key] !== data) ||
        Object.keys(entry).some((key) => !Object.hasOwn(canonical, key)))
      fail("ZONED_MEANING", "The saved local time, offset and instant disagree. Review the time-zone meaning.");
  } else if (type === "DateRange") {
    exactKeys(entry, ["start", "end", "timeZone", "boundaryRule"]);
    if (parseDateOnly(string(entry.start)) !== entry.start || parseDateOnly(string(entry.end)) !== entry.end)
      fail("DATE_FORMAT", "Use normalized dates for the range.");
    dateRangeToInstantRange(entry as unknown as DateRange);
  } else {
    exactKeys(entry, ["start", "end"]);
    validateInstantRange(entry as unknown as InstantRange);
  }
  return true;
}
function weekday(date: string): string {
  const day = new Date(`${parseDateOnly(date)}T00:00:00Z`).getUTCDay();
  return (WEEKDAY_TYPE as { kind: "Enum"; values: string[] }).values[(day + 6) % 7]!;
}
function formatTemporal(value: JsonValue, type: ValueType, timeZone: string, format: string, locale: string): string {
  assertTimeZone(timeZone);
  const style = enumChoice(displayFormatType(type), format);
  enumChoice(DISPLAY_LOCALE_TYPE, locale);
  let date: string | undefined, time: string | undefined, instant: string | undefined;
  if (type === "DateOnly") date = parseDateOnly(string(value));
  else if (type === "LocalTime") time = parseLocalTime(string(value));
  else {
    instant = type === "Instant" ? parseInstant(string(value)) : string(object(value).instant);
    const zoned = instantInTimeZone(instant, timeZone);
    date = zoned.date; time = zoned.time;
  }
  if (style === "iso") return instant ?? date ?? time!;
  if (style === "time") return time!;
  const [year, month, day] = date!.split("-");
  const displayDate = locale === "ja-JP" ? `${year}/${month}/${day}` : `${month}/${day}/${year}`;
  if (style === "date") return displayDate;
  if (style === "dateTime") return `${displayDate} ${time} ${timeZone} (${offsetAt(instant!, timeZone)})`;
  const names = locale === "ja-JP"
    ? ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"]
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return names[(WEEKDAY_TYPE as { kind: "Enum"; values: string[] }).values.indexOf(weekday(date!))]!;
}
export function evaluateTemporalOperator(operator: TemporalOperator, args: JsonValue[], inputTypes: readonly ValueType[]): JsonValue {
  temporalSignature(operator, inputTypes);
  const a = args[0]!, b = args[1]!, c = args[2]!;
  switch (operator) {
    case "time.compose": return `${String(integer(a, 0, 23)).padStart(2, "0")}:${String(integer(b, 0, 59)).padStart(2, "0")}`;
    case "zoned.compose": return composeZonedValue(string(a), string(b), string(c), string(args[3])) as unknown as JsonValue;
    case "zoned.fromInstant": return instantInTimeZone(string(a), string(b)) as unknown as JsonValue;
    case "zoned.resolve": validateTemporalValue("ZonedDateTimeSpec", a); return object(a).instant!;
    case "zoned.addDays": {
      validateTemporalValue("ZonedDateTimeSpec", a);
      const original = a as unknown as ZonedDateTimeValue;
      const moved = composeZonedValue(addCalendarDays(original.date, integer(b, -36600, 36600)), original.time, original.timeZone, string(c));
      const remainder = ((Date.parse(original.instant) % 60000) + 60000) % 60000;
      return instantInTimeZone(new Date(Date.parse(moved.instant) + remainder).toISOString(), original.timeZone) as unknown as JsonValue;
    }
    case "date.weekdayEnum": return weekday(string(a));
    case "zoned.weekday": validateTemporalValue("ZonedDateTimeSpec", a); return weekday(string(object(a).date));
    case "dateRange.build": {
      const range: DateRange = { start: parseDateOnly(string(a)), end: parseDateOnly(string(b)), timeZone: string(c), boundaryRule: "firstValidEarlier" };
      dateRangeToInstantRange(range); return range as unknown as JsonValue;
    }
    case "instantRange.build": return validateInstantRange({ start: string(a), end: string(b) }) as unknown as JsonValue;
    case "dateRange.toInstants": validateTemporalValue("DateRange", a); return dateRangeToInstantRange(a as unknown as DateRange) as unknown as JsonValue;
    case "range.contains": {
      if (inputTypes[0] === "DateOnly") {
        validateTemporalValue("DateRange", b);
        const date = parseDateOnly(string(a)), range = b as unknown as DateRange;
        return date >= range.start && date <= range.end;
      }
      return isWithinInstantRange(string(a), b as unknown as InstantRange);
    }
    case "number.format": {
      if (typeof a !== "number" || !Number.isFinite(a)) fail("FINITE_NUMBER", "A finite number is required.");
      const digits = integer(b, 0, 8), locale = enumChoice(DISPLAY_LOCALE_TYPE, c);
      return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true }).format(a as number);
    }
    case "text.clean": {
      const text = string(a), mode = enumChoice(TEXT_CLEAN_MODE_TYPE, b);
      if (mode === "trim") return text.trim();
      if (mode === "lineFeed") return text.replace(/\r\n?/g, "\n");
      if (mode === "horizontalSpaces") return text.replace(/[\t \u00a0\u3000]+/g, " ");
      return text.replace(/\r\n?/g, "\n").replace(/\n(?:[\t \u00a0\u3000]*\n){2,}/g, "\n\n");
    }
    case "temporal.format": return formatTemporal(a, inputTypes[0]!, string(b), string(c), string(args[3]));
  }
}
