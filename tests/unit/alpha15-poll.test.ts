import { expect, it } from "vitest";
import { compileFlowDefinition, validateFlowDefinition } from "../../packages/automation/src/definition";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";
import { fixedPollBounds } from "../../packages/automation/src/poll";
import type { EvaluatedValue, FlowDefinition, Statement, ValueInput, ValueType } from "../../packages/automation/src/types";

const guildId = "884000000000000001", ticket = "intake:12345678-1234-1234-1234-123456789abc";
const recordType: ValueType = { kind: "Record", schemaId: "nexus.ticket.status.v1" };
const states: ValueType = { kind: "Enum", values: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "SNOOZED", "RESOLVED", "DISMISSED"] };
function polling(): Extract<Statement, { kind: "poll" }> {
  return { id: "poll", kind: "poll", ticket: { kind: "literal", type: "TicketRef", value: { id: ticket, guildId } },
    maxAttempts: { kind: "literal", type: "Number", value: 3 }, interval: { kind: "literal", type: "Duration", value: 10 }, until: { kind: "literal", type: "Instant", value: "2026-10-15T08:01:00.000Z" },
    output: { id: "result", name: "Ticket state", type: recordType },
    condition: { kind: "expression", type: "Boolean", expression: { operator: "compare.equal", args: [{ kind: "expression", type: states, expression: { operator: "record.field", args: [{ kind: "variable", type: recordType, variableId: "result" }], options: { key: "state" } } }, { kind: "literal", type: states, value: "RESOLVED" }] } },
    matched: [], exhausted: [], timedOut: [] };
}
function flow(poll = polling()): FlowDefinition { return { schemaVersion: 1, id: "poll-flow", guildId, name: "Synthetic bounded read", trigger: { kind: "manual", inputs: [] }, variables: [], body: [poll] }; }
const clock = "2026-10-15T08:00:00.000Z";
const output = (state: string, version = 1) => ({ type: recordType, value: { state, version } });

it("requires complete typed bounds, a positive finite interval and bounded integer attempts", () => {
  expect(validateFlowDefinition(flow()).valid).toBe(true);
  for (const attempts of [0, -1, 1.5, 101]) { const poll = polling(); poll.maxAttempts = { kind: "literal", type: "Number", value: attempts }; expect(validateFlowDefinition(flow(poll)).valid).toBe(false); }
  for (const interval of [0, -1, 604801]) { const poll = polling(); poll.interval = { kind: "literal", type: "Duration", value: interval }; expect(validateFlowDefinition(flow(poll)).valid).toBe(false); }
  const missing = polling(); missing.until = { kind: "missing", type: "Instant" }; expect(validateFlowDefinition(flow(missing))).toMatchObject({ complete: false });
  const wrong = polling(); wrong.condition = { kind: "literal", type: "ConditionResult", value: "unknown" }; expect(validateFlowDefinition(flow(wrong)).valid).toBe(false);
  const expanded = validateFlowDefinition(flow(), { limits: { maxExpandedSteps: 2 } }); expect(expanded.issues.some(issue => issue.code === "STEP_BUDGET")).toBe(true);
});

it("only exposes read-only confirmed results to predicate, matched and exhausted scopes", () => {
  const poll = polling(), value: ValueInput = { kind: "variable", type: recordType, variableId: "result" };
  poll.matched = [{ kind: "declare", id: "matched", variable: { id: "matched-result", name: "Matched", type: recordType }, value }];
  poll.exhausted = [{ kind: "declare", id: "exhausted", variable: { id: "exhausted-result", name: "Exhausted", type: recordType }, value }];
  expect(validateFlowDefinition(flow(poll)).valid).toBe(true);
  poll.timedOut = [{ kind: "declare", id: "timeout", variable: { id: "timeout-result", name: "Timeout", type: recordType }, value }];
  expect(validateFlowDefinition(flow(poll)).valid).toBe(false);
  poll.timedOut = []; poll.matched = [{ kind: "assign", id: "overwrite", variableId: "result", value }];
  expect(validateFlowDefinition(flow(poll)).issues.some(issue => issue.code === "VARIABLE_READONLY")).toBe(true);
  const after = flow(); after.body.push({ kind: "declare", id: "outside", variable: { id: "outside", name: "Outside", type: recordType }, value }); expect(validateFlowDefinition(after).valid).toBe(false);
});

it("does not persist sensitive or non-resumable bounds and refuses a deadline beyond the Run", () => {
  const value = (type: ValueType, item: number | string): EvaluatedValue => ({ type, value: item, provenance: [] });
  const bounds = { maxAttempts: value("Number", 3), interval: value("Duration", 10), until: value("Instant", "2026-10-15T08:01:00.000Z") };
  for (const key of ["maxAttempts", "interval", "until"] as const) for (const provenance of [{ source: "service" as const, sensitive: true }, { source: "service" as const, resumable: false }]) {
    const changed = structuredClone(bounds); changed[key].provenance = [provenance]; expect(() => fixedPollBounds(changed, new Date("2026-10-16T00:00:00Z"), 100)).toThrow("AUTOMATION_STATE_NOT_RESUMABLE");
  }
  expect(() => fixedPollBounds(bounds, new Date(clock), 100)).toThrow("AUTOMATION_DEADLINE_EXCEEDED");
});

it("requires explicit read outcomes and typed outputs, with no production effect", () => {
  const plan = compileFlowDefinition(flow());
  expect(simulateAutomationPlan(plan, {}, clock)).toMatchObject({ status: "UNDETERMINED", steps: [{ blockId: "poll" }, { code: "MOCK_OUTCOME_REQUIRED" }] });
  expect(simulateAutomationPlan(plan, { outcomes: { poll: "SUCCEEDED" } }, clock)).toMatchObject({ status: "UNDETERMINED", steps: [{ blockId: "poll" }, { code: "MOCK_OUTPUT_REQUIRED" }] });
  const result = simulateAutomationPlan(plan, { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: output("RESOLVED") } }, clock);
  expect(result).toMatchObject({ status: "COMPLETED", plannedActions: 0, productionRuns: 0, externalChanges: 0, productionDraws: 0 }); expect(result.steps[0]?.state).toBe("SIMULATED_MATCHED");
});

it("simulates bounded snapshots, exhaustion and deadline without coercing errors or unknowns", () => {
  const plan = compileFlowDefinition(flow());
  const result = simulateAutomationPlan(plan, { pollReads: { poll: [{ outcome: "SUCCEEDED", output: output("OPEN") }, { outcome: "SUCCEEDED", output: output("RESOLVED", 2) }] } }, clock);
  expect(result.status).toBe("COMPLETED"); expect(result.transitions).toBe(2); expect(result.steps[0]?.state).toBe("SIMULATED_MATCHED");
  const exhausted = simulateAutomationPlan(plan, { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: output("OPEN") } }, clock); expect(exhausted.transitions).toBe(3); expect(exhausted.steps[0]?.state).toBe("SIMULATED_EXHAUSTED");
  const poll = polling(); poll.until = { kind: "literal", type: "Instant", value: "2026-10-15T08:00:05Z" };
  const timed = simulateAutomationPlan(compileFlowDefinition(flow(poll)), { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: output("OPEN") } }, clock); expect(timed.steps[0]?.state).toBe("SIMULATED_TIMED_OUT"); expect(timed.steps.filter(step => step.kind === "pollRead")).toHaveLength(1);
  for (const outcome of ["FAILED", "NOT_STARTED", "UNKNOWN"] as const) expect(simulateAutomationPlan(plan, { outcomes: { poll: outcome } }, clock).status).toBe(outcome === "UNKNOWN" ? "UNKNOWN" : "FAILED");
  expect(simulateAutomationPlan(plan, { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: output("FAKE") } }, clock).status).toBe("FAILED");
});

it("advances simulated elapsed time before polling instead of matching an already expired deadline", () => {
  const definition = flow(); definition.body.unshift({ id: "before-poll", kind: "wait", duration: { kind: "literal", type: "Duration", value: 120 } });
  const result = simulateAutomationPlan(compileFlowDefinition(definition), { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: output("RESOLVED") } }, clock);
  expect(result.status).toBe("COMPLETED"); expect(result.steps.find(step => step.blockId === "poll")?.state).toBe("SIMULATED_TIMED_OUT"); expect(result.steps.some(step => step.kind === "pollRead")).toBe(false);
});

it("requires explicit qualified intake events and keeps event success values out of timeout scopes", () => {
  const definition = flow();
  const wait: Extract<Statement, { kind: "awaitEvent" }> = { id: "await", kind: "awaitEvent", ticket: polling().ticket, event: "ticketUpdated", states: ["RESOLVED"], until: polling().until, output: { id: "event-result", name: "Result", type: recordType }, matched: [], timedOut: [] };
  definition.body = [wait]; const plan = compileFlowDefinition(definition);
  expect(simulateAutomationPlan(plan, {}, clock)).toMatchObject({ status: "UNDETERMINED", steps: [{ code: "MOCK_EVENT_REQUIRED" }] });
  expect(simulateAutomationPlan(plan, { awaitEvents: { await: { state: "TIMED_OUT" } } }, clock).status).toBe("COMPLETED");
  expect(simulateAutomationPlan(plan, { awaitEvents: { await: { state: "MATCHED", value: { state: "RESOLVED", version: 1 }, occurredAt: "2026-10-15T08:00:05Z" } } }, clock)).toMatchObject({ status: "COMPLETED", steps: [{ state: "MOCK_EVENT_MATCHED" }], productionRuns: 0, externalChanges: 0 });
  for (const occurredAt of [clock, "2026-10-15T08:01:00.000Z", "invalid"]) expect(simulateAutomationPlan(plan, { awaitEvents: { await: { state: "MATCHED", value: { state: "RESOLVED", version: 1 }, occurredAt } } }, clock).status).toBe("FAILED");
  definition.trigger = { kind: "manual", inputs: [{ id: "ticket-input", name: "Ticket", type: "TicketRef" }] }; wait.ticket = { kind: "variable", type: "TicketRef", variableId: "ticket-input" };
  expect(simulateAutomationPlan(compileFlowDefinition(definition), { values: { "ticket-input": { type: "TicketRef", value: { id: "884111111111111111", guildId } } }, awaitEvents: { await: { state: "MATCHED", value: { state: "RESOLVED", version: 1 }, occurredAt: "2026-10-15T08:00:05Z" } } }, clock).status).toBe("FAILED");
  wait.timedOut = [{ kind: "declare", id: "leak", variable: { id: "leak", name: "Leak", type: recordType }, value: { kind: "variable", type: recordType, variableId: "event-result" } }]; expect(validateFlowDefinition(definition).valid).toBe(false);
});
