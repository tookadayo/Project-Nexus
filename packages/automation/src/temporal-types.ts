/** Fixed date/time descriptors. Parsing user edits is separate from persisted values. */
import type { InstantRangeV2Type, JsonValue, LocalTimeType, TemporalPrecision, ValueType, ZonedDateTimeSpec } from "./types";

export const DATE_CALENDAR_SCHEMA = "iso8601.calendar.v1" as const;
export const LOCAL_TIME_SCHEMA = "iso8601.local-time.v1" as const;
export const INSTANT_RANGE_V2_TYPE: InstantRangeV2Type = Object.freeze({ kind: "InstantRange", schemaId: "nexus.instant-range.v2" });
export const localTimeType = (precision: TemporalPrecision): LocalTimeType => ({ kind: "LocalTime", schemaId: LOCAL_TIME_SCHEMA, precision });
export function isLocalTimeDescriptor(type: ValueType): type is LocalTimeType {
  return typeof type === "object" && type.kind === "LocalTime" && type.schemaId === LOCAL_TIME_SCHEMA &&
    ["minute", "second"].includes(type.precision) && Object.keys(type).length === 3;
}
export function isLocalTimeType(type: ValueType): boolean { return type === "LocalTime" || isLocalTimeDescriptor(type); }
export function localTimePrecision(type: ValueType): TemporalPrecision | undefined {
  return type === "LocalTime" ? "minute" : isLocalTimeDescriptor(type) ? type.precision : undefined;
}
export function isInstantRangeV2Type(type: ValueType): type is InstantRangeV2Type {
  return typeof type === "object" && type.kind === "InstantRange" && type.schemaId === INSTANT_RANGE_V2_TYPE.schemaId && Object.keys(type).length === 2;
}
export class TemporalInputError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "TemporalInputError"; }
}
export function parseLocalTimeForPrecision(value: string, precision: TemporalPrecision): string {
  if(precision!=='minute'&&precision!=='second')throw new TemporalInputError('TIME_SCHEMA','Choose minute or second precision.');
  const valid = precision === "minute" ? /^([01]\d|2[0-3]):[0-5]\d$/ : /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  if (typeof value !== "string" || !valid.test(value)) throw new TemporalInputError("TIME_FORMAT", `Enter a local time with ${precision} precision.`);
  return value;
}
export function parseUserDateInput(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TemporalInputError("DATE_FORMAT", "Enter a complete ISO date (YYYY-MM-DD).");
  const [year, month, day] = value.split("-").map(Number), at = new Date(Date.UTC(year!, month! - 1, day));
  if (year! < 100 || year! > 9999 || at.getUTCFullYear() !== year || at.getUTCMonth() + 1 !== month || at.getUTCDate() !== day)
    throw new TemporalInputError("DATE_INVALID", "Choose an existing calendar date.");
  return value;
}
/** A new user input may omit seconds (meaning :00), but never includes fractions. */
export function parseUserInstantInput(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?Z?$/.test(value))
    throw new TemporalInputError("INSTANT_INPUT_PRECISION", "Enter a UTC date/time to minutes or seconds; fractional seconds are not an input precision.");
  const raw = value.endsWith("Z") ? value.slice(0, -1) : value;
  parseUserDateInput(raw.slice(0, 10));
  return `${raw.length === 16 ? `${raw}:00` : raw}.000Z`;
}
export function temporalValueKey(type: ValueType, value: JsonValue): string {
  // JSONb and editor reconstruction may reorder object fields. Arrays retain
  // their order and scalar values remain exact; this grants no value conversion.
  const canonical=(item:unknown):string=>Array.isArray(item)?`[${item.map(canonical).join(',')}]`:
    item!==null&&typeof item==='object'?`{${Object.entries(item).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,entry])=>`${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`:JSON.stringify(item);
  return canonical({type,value});
}
/** Validate persisted local fields without consulting a possibly updated time-zone database. */
export function validateFixedZonedDateTimeSpec(value:ZonedDateTimeSpec):void {
  parseUserDateInput(value.date);parseLocalTimeForPrecision(value.time,value.timePrecision??'minute');
  if(typeof value.timeZone!=='string'||value.timeZone.length>64||value.timeZone!=='UTC'&&!/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/.test(value.timeZone))
    throw new TemporalInputError('TIME_ZONE','A saved IANA time zone is required.');
  if(value.occurrence!==undefined&&!['earlier','later'].includes(value.occurrence))throw new TemporalInputError('TEMPORAL_CHOICE','Choose a saved time occurrence.');
}
export interface TemporalResolutionContext {
  temporalResolution?: "resolve" | "fixed";
  fixedTemporalValues?: ReadonlySet<string>;
}
export function isFixedTemporalValue(type: ValueType, value: JsonValue, context: TemporalResolutionContext): boolean {
  return context.temporalResolution === "fixed" || context.fixedTemporalValues?.has(temporalValueKey(type, value)) === true;
}
