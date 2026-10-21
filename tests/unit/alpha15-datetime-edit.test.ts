import {describe, expect, it} from "vitest";
import {assertTemporalUserEdits, collectFixedTemporalValues} from "../../packages/automation/src/temporal-edit";
import {INSTANT_RANGE_V2_TYPE} from "../../packages/automation/src/temporal-types";
import {groupRecordType} from "../../packages/automation/src/structured-values";
import type {FlowDefinition, JsonValue, ValueType} from "../../packages/automation/src/types";

const precise = "2026-10-16T08:15:42.123Z";
const seconds = "2026-10-16T08:15:42.000Z";
const none: ReadonlySet<string> = new Set();
function definition(type: ValueType = "Instant", value: JsonValue = seconds): FlowDefinition {
  return {schemaVersion: 1, id: "datetime-edit", guildId: "884000000000000001", name: "Date/time edits", trigger: {kind: "manual", inputs: []}, variables: [], body: [
    {kind: "declare", id: "value", variable: {id: "value", name: "Value", type}, value: {kind: "literal", type, value}},
  ]};
}
const zoned = (instant: string): JsonValue => ({date: "2026-10-16", time: "08:15", timeZone: "UTC", instant, offset: "+00:00"});
const cases: [string, ValueType, JsonValue][] = [
  ["Instant", "Instant", precise],
  ["zoned fixed instant", "ZonedDateTimeSpec", zoned(precise)],
  ["legacy range start", "InstantRange", {start: precise, end: "2026-10-16T09:00:00Z"}],
  ["versioned range end", INSTANT_RANGE_V2_TYPE, {start: seconds, end: precise}],
  ["list item", {kind: "List", element: "Instant"}, [precise]],
  ["optional payload", {kind: "Optional", value: "Instant"}, {state: "set", value: precise}],
  ["registered record field", groupRecordType("PlainText", "Instant"), {key: "group", items: [precise]}],
  ["rich text timestamp", "RichTextSpec", [{kind: "bold", children: [{kind: "timestamp", instant: precise, format: "F"}]}]],
  ["embed timestamp", "EmbedSpec", {title: "Synthetic", timestamp: precise}],
  ["legacy message embed", "LegacyMessageSpec", {kind: "legacy", embeds: [{timestamp: precise}]}],
  ["legacy message rich text", "LegacyMessageSpec", {kind: "legacy", richText: [{kind: "timestamp", instant: precise, format: "R"}]}],
];

describe("alpha15 DT03 user-edit precision and persisted value boundary", () => {
  it("accepts minute/second representation without imposing a millisecond rule on Duration or ordinary text", () => {
    for (const value of ["2026-10-16T08:15:00Z", "2026-10-16T08:15:42Z", seconds])
      expect(() => assertTemporalUserEdits(definition("Instant", value), none)).not.toThrow();
    expect(() => assertTemporalUserEdits(definition("Duration", 0.125), none)).not.toThrow();
    expect(() => assertTemporalUserEdits(definition("PlainText", precise), none)).not.toThrow();
  });

  it.each(cases)("rejects a newly introduced nonzero fraction in %s", (_label, type, value) => {
    expect(() => assertTemporalUserEdits(definition(type, value), none)).toThrow();
  });

  it.each(cases)("preserves an unchanged saved %s through unrelated flow edits", (_label, type, value) => {
    const before = definition(type, value), after = structuredClone(before);
    after.name = "Renamed without editing the saved value";
    expect(() => assertTemporalUserEdits(after, collectFixedTemporalValues(before))).not.toThrow();
    expect(after.body).toEqual(before.body);
  });

  it("does not authorize a different fractional instant merely because the old value had fractions", () => {
    const before = definition("Instant", precise), after = definition("Instant", "2026-10-16T08:15:42.124Z");
    expect(() => assertTemporalUserEdits(after, collectFixedTemporalValues(before))).toThrow();
    expect(() => assertTemporalUserEdits(definition("Instant", seconds), collectFixedTemporalValues(before))).not.toThrow();
  });

  it.each([
    ["list", {kind: "List", element: "Instant"}, [precise], [precise, seconds]],
    ["record", groupRecordType("PlainText", "Instant"), {key: "before", items: [precise]}, {key: "after", items: [precise]}],
    ["v2 range", INSTANT_RANGE_V2_TYPE, {start: precise, end: "2026-10-16T09:00:00Z"}, {start: precise, end: "2026-10-16T10:00:00Z"}],
    ["rich text", "RichTextSpec", [{kind: "timestamp", instant: precise, format: "F"}], [{kind: "text", text: "Added text"}, {kind: "timestamp", instant: precise, format: "F"}]],
    ["embed", "EmbedSpec", {title: "Before", timestamp: precise}, {title: "After", timestamp: precise}],
    ["message", "LegacyMessageSpec", {kind: "legacy", embeds: [{timestamp: precise}]}, {kind: "legacy", content: "Added text", embeds: [{timestamp: precise}]}],
  ] as [string, ValueType, JsonValue, JsonValue][])("retains the fixed Instant inside %s when a non-precision field changes", (_label, type, before, after) => {
    expect(() => assertTemporalUserEdits(definition(type, after), collectFixedTemporalValues(definition(type, before)))).not.toThrow();
  });

  it.each(["anchor", "end"] as const)("checks a new elapsed schedule %s without changing an old fixed schedule", field => {
    const before = definition();
    before.trigger = {kind: "schedule", schedule: {kind: "elapsed", anchor: "2026-10-16T08:00:00.000Z", intervalSeconds: 60, end: "2026-10-17T08:00:00.000Z", pastOccurrences: "skip"}};
    const after = structuredClone(before);
    if (after.trigger.kind !== "schedule" || after.trigger.schedule.kind !== "elapsed") throw new Error("Fixture schedule mismatch");
    after.trigger.schedule[field] = precise;
    expect(() => assertTemporalUserEdits(after, collectFixedTemporalValues(before))).toThrow();
    const retained = structuredClone(after); retained.name = "Unrelated edit";
    expect(() => assertTemporalUserEdits(retained, collectFixedTemporalValues(after))).not.toThrow();
  });

  it("checks values in pure definitions and detached blocks as well as executable statements", () => {
    const fresh = definition();
    fresh.pureDefinitions = [{id: "precise", name: "Precise", revision: 1, inputs: [], outputType: "Instant", value: {kind: "literal", type: "Instant", value: precise}}];
    expect(() => assertTemporalUserEdits(fresh, none)).toThrow();
    delete fresh.pureDefinitions;
    fresh.detached = definition("Instant", precise).body;
    expect(() => assertTemporalUserEdits(fresh, none)).toThrow();
    expect(() => assertTemporalUserEdits(fresh, collectFixedTemporalValues(fresh))).not.toThrow();
  });

  it("cannot gain fixed-value authority from client metadata", () => {
    const forged = {...definition("Instant", precise), temporalResolution: "fixed", fixedTemporalValues: [precise]};
    expect(() => assertTemporalUserEdits(forged, none)).toThrow();
  });
});
