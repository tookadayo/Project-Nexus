import {describe, expect, it} from "vitest";
import {compileFlowDefinition} from "../../packages/automation/src/definition";
import {simulateAutomationPlan} from "../../packages/automation/src/simulation";
import {collectFixedTemporalValues} from "../../packages/automation/src/temporal-edit";
import {validateTemporalValue} from "../../packages/automation/src/temporal-values";
import type {FlowDefinition, JsonValue, Statement, ValueInput, ValueType} from "../../packages/automation/src/types";

const guildId = "884000000000000001", clock = "2026-10-16T00:00:00.123Z";
const oldRange: JsonValue = {start: "2011-12-30", end: "2011-12-30", timeZone: "Pacific/Apia", boundaryRule: "firstValidEarlier"};
const oldZoned: JsonValue = {date: "2027-07-01", time: "01:30", timeZone: "America/New_York", instant: "2027-07-01T06:30:00.000Z", offset: "-05:00"};
const literal = (type: ValueType, value: JsonValue): ValueInput => ({kind: "literal", type, value});
const flow = (body: Statement[]): FlowDefinition => ({schemaVersion: 1, semanticProfile: "scratch.v1", id: "datetime-simulation-trust", guildId, name: "Synthetic retained temporal values", trigger: {kind: "manual", inputs: []}, variables: [], body});
const trusted = (definition: FlowDefinition) => {
  // Mirrors a server-loaded persisted revision; a browser cannot submit these
  // capabilities through the strict API request schema.
  const capabilities = {temporalResolution: "fixed" as const, fixedTemporalValues: collectFixedTemporalValues(definition)};
  return {plan: compileFlowDefinition(definition, capabilities), capabilities};
};
const declaration = (id: string, type: ValueType, value: ValueInput): Statement => ({kind: "declare", id: `${id}.declare`, variable: {id, name: id, type}, value});

describe("DT03/DT11 simulation separates retained definitions from fresh user mocks", () => {
  it("retains an old absent calendar day when a trusted saved List<DateRange> is sampled", () => {
    expect(() => validateTemporalValue("DateRange", oldRange)).toThrow();
    const listType: ValueType = {kind: "List", element: "DateRange"};
    const definition = flow([
      {kind: "random", id: "draw", mode: "sample", list: literal(listType, [oldRange]), count: literal("Number", 1), output: {id: "selected", name: "Selected range", type: listType}},
    ]);
    const {plan, capabilities} = trusted(definition), before = JSON.stringify(plan);
    const result = simulateAutomationPlan(plan, {inspectVariables: ["selected"]}, clock, capabilities);
    expect(result.status).toBe("COMPLETED");
    expect(result.steps).toContainEqual({blockId: "draw", kind: "random", state: "MOCK_DRAW"});
    expect(result.inspection?.values).toContainEqual({variableId: "selected", type: listType, value: [oldRange], blockId: "draw"});
    expect(result.productionDraws).toBe(0); expect(result.externalChanges).toBe(0);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("rejects a fresh user DateRange mock even when its exact value is retained in the trusted plan", () => {
    const definition = flow([
      declaration("retained", "DateRange", literal("DateRange", oldRange)),
      declaration("captured", "DateRange", {kind: "variable", type: "DateRange", variableId: "candidate"}),
    ]);
    definition.trigger = {kind: "manual", inputs: [{id: "candidate", name: "Fresh range", type: "DateRange"}]};
    const {plan, capabilities} = trusted(definition);
    const result = simulateAutomationPlan(plan, {values: {candidate: {type: "DateRange", value: oldRange}}}, clock, capabilities);
    expect(result.status).toBe("FAILED");
    expect(result.steps).toContainEqual(expect.objectContaining({blockId: "simulation", kind: "error", state: "FAILED"}));
    expect(result.steps.some(step => step.kind === "declare")).toBe(false);
  });

  it("rejects a fresh user zoned mock whose saved offset differs from current rules", () => {
    expect(() => validateTemporalValue("ZonedDateTimeSpec", oldZoned)).toThrow();
    const definition = flow([
      declaration("retained", "ZonedDateTimeSpec", literal("ZonedDateTimeSpec", oldZoned)),
      declaration("captured", "ZonedDateTimeSpec", {kind: "variable", type: "ZonedDateTimeSpec", variableId: "candidate"}),
    ]);
    definition.trigger = {kind: "manual", inputs: [{id: "candidate", name: "Fresh local date/time", type: "ZonedDateTimeSpec"}]};
    const {plan, capabilities} = trusted(definition);
    const result = simulateAutomationPlan(plan, {values: {candidate: {type: "ZonedDateTimeSpec", value: oldZoned}}}, clock, capabilities);
    expect(result.status).toBe("FAILED");
    expect(result.steps).toContainEqual(expect.objectContaining({blockId: "simulation", kind: "error", state: "FAILED"}));
    expect(result.steps.some(step => step.kind === "declare")).toBe(false);
  });

  it("preserves fractional internal clocks, Run start time and an existing fractional wait", () => {
    const definition = flow([
      {kind: "readClock", id: "before-clock", output: {id: "before", name: "Before", type: "Instant"}},
      {kind: "wait", id: "fractional-wait", duration: literal("Duration", 0.125)},
      {kind: "readClock", id: "after-clock", output: {id: "after", name: "After", type: "Instant"}},
    ]);
    const {plan, capabilities} = trusted(definition);
    const result = simulateAutomationPlan(plan, {inspectVariables: ["before", "after", "run.startedAt"]}, clock, capabilities);
    expect(result.status).toBe("COMPLETED");
    expect(result.inspection?.values).toEqual(expect.arrayContaining([
      expect.objectContaining({variableId: "before", value: clock}),
      expect.objectContaining({variableId: "after", value: "2026-10-16T00:00:00.248Z"}),
      expect.objectContaining({variableId: "run.startedAt", value: clock}),
    ]));
    expect(result.productionRuns).toBe(0); expect(result.externalChanges).toBe(0);
  });
});
