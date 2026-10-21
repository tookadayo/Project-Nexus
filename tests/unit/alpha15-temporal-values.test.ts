import { describe, expect, it } from "vitest";
import { assertValueMatchesType, evaluateValue, validateValueInput } from "../../packages/automation/src/expression.js";
import { compileFlowDefinition, semanticHash } from "../../packages/automation/src/definition.js";
import { expressionCardsFor, instantiateExpressionCard } from "../../packages/automation/src/expression-cards.js";
import {
  DISPLAY_LOCALE_TYPE, OCCURRENCE_TYPE, TEXT_CLEAN_MODE_TYPE, WEEKDAY_TYPE,
  composeZonedValue, displayFormatType, instantInTimeZone,
} from "../../packages/automation/src/temporal-values.js";
import type { EvaluationContext, ExpressionOperator, FlowDefinition, JsonValue, ValueInput, ValueType } from "../../packages/automation/src/types.js";

const guildId = "123456789012345678";
const context: EvaluationContext = { guildId, variables: {} };
const literal = (type: ValueType, value: unknown): ValueInput => ({ kind: "literal", type, value: value as JsonValue });
const expression = (type: ValueType, operator: ExpressionOperator, args: ValueInput[]): ValueInput => ({ kind: "expression", type, expression: { operator, args } });
const n = (value: number) => literal("Number", value);
const choice = (type: ValueType, value: string) => literal(type, value);
const result = (value: ValueInput, env = context) => evaluateValue(value, env).value;
const zone = (value = "America/New_York") => literal("TimeZone", value);
const zoned = (date: string, time: string, occurrence = "requireUnique") => expression("ZonedDateTimeSpec", "zoned.compose", [literal("DateOnly", date), literal("LocalTime", time), zone(), choice(OCCURRENCE_TYPE, occurrence)]);
const dateRange = (start: string, end: string, timeZone = "Asia/Tokyo") => expression("DateRange", "dateRange.build", [literal("DateOnly", start), literal("DateOnly", end), zone(timeZone)]);

describe("alpha15 original typed temporal and display contracts", () => {
  it("composes local times from exact typed integers without fixing invalid input", () => {
    expect(result(expression("LocalTime", "time.compose", [n(9), n(5)]))).toBe("09:05");
    for (const args of [[n(24), n(0)], [n(-1), n(0)], [n(1), n(1.5)]])
      expect(() => result(expression("LocalTime", "time.compose", args))).toThrow();
    const missing: ValueInput = { kind: "missing", type: "Number" };
    expect(() => result(expression("LocalTime", "time.compose", [missing, n(0)]))).toThrow();
  });
  it("rejects DST gaps and requires a fold selection while preserving its offset", () => {
    expect(() => result(zoned("2027-03-14", "02:30"))).toThrow();
    expect(() => result(zoned("2027-11-07", "01:30"))).toThrow();
    const earlier = result(zoned("2027-11-07", "01:30", "earlier")) as Record<string, JsonValue>;
    const later = result(zoned("2027-11-07", "01:30", "later")) as Record<string, JsonValue>;
    expect([earlier.instant, earlier.offset, later.instant, later.offset]).toEqual(["2027-11-07T05:30:00.000Z", "-04:00", "2027-11-07T06:30:00.000Z", "-05:00"]);
  });
  it("changes only the displayed zone without losing the instant's seconds or milliseconds", () => {
    const instant = "2027-11-07T06:30:42.123Z";
    const value = result(expression("ZonedDateTimeSpec", "zoned.fromInstant", [literal("Instant", instant), zone()]));
    expect(value).toMatchObject({ date: "2027-11-07", time: "01:30", occurrence: "later", instant, offset: "-05:00" });
    expect(result(expression("Instant", "zoned.resolve", [literal("ZonedDateTimeSpec", value)]))).toBe(instant);
    expect(instantInTimeZone("2026-10-15T00:00:42.999Z", "Asia/Tokyo")).toMatchObject({ instant: "2026-10-15T00:00:42.999Z", offset: "+09:00", time: "09:00" });
    expect(instantInTimeZone("2026-10-15T00:00:42.999Z", "UTC")).toMatchObject({ offset: "+00:00" });
  });
  it("keeps one calendar day distinct from 24 elapsed hours across DST", () => {
    const first = zoned("2027-03-13", "09:00");
    const next = expression("ZonedDateTimeSpec", "zoned.addDays", [first, n(1), choice(OCCURRENCE_TYPE, "requireUnique")]);
    expect(result(next)).toMatchObject({ date: "2027-03-14", time: "09:00", instant: "2027-03-14T13:00:00.000Z" });
    const elapsed = expression("Instant", "instant.add", [expression("Instant", "zoned.resolve", [first]), literal("Duration", 86400)]);
    expect(result(expression("ZonedDateTimeSpec", "zoned.fromInstant", [elapsed, zone()]))).toMatchObject({ time: "10:00", instant: "2027-03-14T14:00:00.000Z" });
  });
  it("supports negative calendar movement and requires a new fold choice at the destination", () => {
    const first = zoned("2027-11-08", "01:30");
    const move = (selected: string) => expression("ZonedDateTimeSpec", "zoned.addDays", [first, n(-1), choice(OCCURRENCE_TYPE, selected)]);
    expect(() => result(move("requireUnique"))).toThrow();
    expect(result(move("later"))).toMatchObject({ date: "2027-11-07", instant: "2027-11-07T06:30:00.000Z" });
  });
  it("returns a registered weekday enum, retaining the existing numeric weekday operation", () => {
    expect(result(expression(WEEKDAY_TYPE, "date.weekdayEnum", [literal("DateOnly", "2026-10-15")]))).toBe("thursday");
    expect(result(expression(WEEKDAY_TYPE, "zoned.weekday", [zoned("2027-11-07", "01:30", "later")]))).toBe("sunday");
    expect(result(expression("Number", "date.weekday", [literal("DateOnly", "2026-10-15")]))).toBe(4);
  });
  it("includes both selected dates but excludes the resolved following local boundary", () => {
    const range = dateRange("2026-10-15", "2026-10-15");
    expect(result(expression("Boolean", "range.contains", [literal("DateOnly", "2026-10-15"), range]))).toBe(true);
    expect(result(expression("Boolean", "range.contains", [literal("DateOnly", "2026-10-16"), range]))).toBe(false);
    const instants = expression("InstantRange", "dateRange.toInstants", [range]);
    expect(result(instants)).toEqual({ start: "2026-10-14T15:00:00.000Z", end: "2026-10-15T15:00:00.000Z" });
    expect(result(expression("Boolean", "range.contains", [literal("Instant", "2026-10-15T14:59:59Z"), instants]))).toBe(true);
    expect(result(expression("Boolean", "range.contains", [literal("Instant", "2026-10-15T15:00:00Z"), instants]))).toBe(false);
  });
  it.each([["2027-03-14", 23], ["2027-11-07", 25]])("resolves %s as an actual %i-hour calendar day", (date, hours) => {
    const range = result(expression("InstantRange", "dateRange.toInstants", [dateRange(date, date, "America/New_York")])) as { start: string; end: string };
    expect(Date.parse(range.end) - Date.parse(range.start)).toBe(hours * 3600000);
  });
  it("rejects reversed or empty ranges and nonexistent calendar boundaries", () => {
    expect(() => result(dateRange("2026-10-16", "2026-10-15"))).toThrow();
    expect(() => result(dateRange("2011-12-30", "2011-12-30", "Pacific/Apia"))).toThrow();
    const at = literal("Instant", "2026-10-15T00:00:00Z");
    expect(() => result(expression("InstantRange", "instantRange.build", [at, at]))).toThrow();
  });
  it("rejects mixed period types and forged or unknown structured fields", () => {
    expect(() => result(expression("Boolean", "range.contains", [literal("Instant", "2026-10-15T00:00:00Z"), dateRange("2026-10-15", "2026-10-15")]))).toThrow();
    const correct = composeZonedValue("2027-11-07", "01:30", "America/New_York", "later");
    expect(() => assertValueMatchesType("ZonedDateTimeSpec", { ...correct, offset: "-04:00" }, context)).toThrow();
    expect(() => assertValueMatchesType("ZonedDateTimeSpec", { ...correct, extra: true }, context)).toThrow();
    expect(() => assertValueMatchesType("DateRange", { start: "2026-10-15", end: "2026-10-15", timeZone: "Asia/Tokyo", boundaryRule: "firstValidEarlier", inclusiveEnd: false }, context)).toThrow();
  });
  it("formats dates without turning DateOnly into a time-zone-dependent instant", () => {
    const format = (type: ValueType, value: JsonValue, mode: string, locale = "ja-JP", region = "America/New_York") => expression("PlainText", "temporal.format", [literal(type, value), zone(region), choice(displayFormatType(type), mode), choice(DISPLAY_LOCALE_TYPE, locale)]);
    expect(result(format("DateOnly", "2026-10-15", "date"))).toBe("2026/10/15");
    expect(result(format("DateOnly", "2026-10-15", "date", "en-US"))).toBe("10/15/2026");
    expect(result(format("DateOnly", "2026-10-15", "weekday"))).toBe("木曜日");
    expect(result(format("Instant", "2026-10-15T00:00:00Z", "dateTime"))).toBe("2026/10/14 20:00 America/New_York (-04:00)");
  });
  it("formats finite numbers with an explicit locale/digits without changing the original", () => {
    const input = n(12345.678);
    expect(result(expression("PlainText", "number.format", [input, n(2), choice(DISPLAY_LOCALE_TYPE, "en-US")]))).toBe("12,345.68");
    expect(result(input)).toBe(12345.678);
    for (const digits of [-1, 1.5, 9]) expect(() => result(expression("PlainText", "number.format", [input, n(digits), choice(DISPLAY_LOCALE_TYPE, "ja-JP")]))).toThrow();
    expect(() => result(expression("PlainText", "number.format", [n(Infinity), n(0), choice(DISPLAY_LOCALE_TYPE, "ja-JP")]))).toThrow();
  });
  it("applies only the explicitly selected registered whitespace/newline rule", () => {
    const clean = (text: string, mode: string) => result(expression("PlainText", "text.clean", [literal("PlainText", text), choice(TEXT_CLEAN_MODE_TYPE, mode)]));
    expect(clean("  a\r\nb  ", "trim")).toBe("a\r\nb");
    expect(clean("  a\r\nb\rc  ", "lineFeed")).toBe("  a\nb\nc  ");
    expect(clean("a\t　 b\n@everyone", "horizontalSpaces")).toBe("a b\n@everyone");
    expect(clean("a\r\n\r\n  \r\n\r\nb", "blankLines")).toBe("a\n\nb");
  });
  it("shares evaluation, text-size and provenance restrictions with other pure operations", () => {
    const source: ValueInput = { kind: "variable", type: "Number", variableId: "restricted" };
    const expressionValue = expression("PlainText", "number.format", [source, n(0), choice(DISPLAY_LOCALE_TYPE, "ja-JP")]);
    const env: EvaluationContext = { guildId, variables: { restricted: { type: "Number", value: 123, provenance: [{ source: "service", allowedChannelIds: ["223456789012345678"], resumable: true }] } } };
    expect(evaluateValue(expressionValue, env).provenance).toContainEqual(expect.objectContaining({ allowedChannelIds: ["223456789012345678"] }));
    expect(() => result(expressionValue, { ...env, limits: { maxEvaluations: 2 } })).toThrow();
    expect(() => result(expressionValue, { ...env, limits: { maxTextLength: 2 } })).toThrow();
  });
  it("offers typed temporal cards with missing execution inputs and rejects invented options", () => {
    for (const type of ["ZonedDateTimeSpec", "DateRange", "InstantRange", "LocalTime", "PlainText", "Boolean", WEEKDAY_TYPE] as ValueType[]) {
      const cards = expressionCardsFor(type);
      const temporal = cards.filter((card) => ["time.compose", "zoned.compose", "dateRange.build", "instantRange.build", "temporal.format", "number.format", "text.clean", "range.contains", "date.weekdayEnum"].includes(card.operator));
      expect(temporal.length).toBeGreaterThan(0);
      for (const card of temporal) {
        const value = instantiateExpressionCard(card);
        expect(value.kind === "expression" && value.expression.args.every((arg) => arg.kind === "missing")).toBe(true);
        expect(() => validateValueInput(value, context)).not.toThrow();
      }
    }
    const invalid = expression("PlainText", "text.clean", [literal("PlainText", "test"), choice(TEXT_CLEAN_MODE_TYPE, "trim")]);
    if (invalid.kind === "expression") invalid.expression.options = { key: "arbitrary" };
    expect(() => validateValueInput(invalid, context)).toThrow();
  });
  it("saves structured range and zoned values as semantic inputs and retains exact fixed instants", () => {
    const definition: FlowDefinition = { schemaVersion: 1, id: "temporal-flow", guildId, name: "Temporal", trigger: { kind: "manual", inputs: [] }, variables: [], body: [
      { id: "range", kind: "declare", variable: { id: "range-value", name: "range", type: "DateRange" }, value: dateRange("2026-10-15", "2026-10-15") },
      { id: "time", kind: "declare", variable: { id: "zoned-value", name: "time", type: "ZonedDateTimeSpec" }, value: literal("ZonedDateTimeSpec", instantInTimeZone("2027-11-07T06:30:42.123Z", "America/New_York")) },
    ] };
    const saved = JSON.parse(JSON.stringify(definition)) as FlowDefinition;
    expect(compileFlowDefinition(saved).definition).toEqual(definition);
    expect(semanticHash(saved)).toBe(semanticHash(definition));
    const changed = structuredClone(saved);
    const statement = changed.body[0]!;
    if (statement.kind === "declare" && statement.value.kind === "expression") statement.value.expression.args[2] = zone("UTC");
    expect(semanticHash(changed)).not.toBe(semanticHash(definition));
  });
});
