import { expect, it } from "vitest";
import {
  INTERNAL_EVENT_FIELDS,
  INTERACTION_EVENT_FIELDS,
  validateEventTriggerInputs,
} from "../../packages/automation/src/event-contract";
import {
  automationEventValues,
  type AutomationEventRow,
} from "../../packages/automation/src/events";
import type { FlowDefinition } from "../../packages/automation/src/types";
const guildId = "884111111111111111";
const base: FlowDefinition = {
  schemaVersion: 1,
  id: "event-test",
  name: "Event test",
  guildId,
  trigger: {
    kind: "internal",
    event: "ticketCreated",
    inputs: [...INTERNAL_EVENT_FIELDS],
  },
  variables: [],
  body: [{ kind: "end", id: "end" }],
};
const event: AutomationEventRow = {
  organization_id: "synthetic",
  guild_id: guildId,
  source: "INTERNAL",
  event_id: "synthetic-event",
  flow_id: base.id,
  revision: 1,
  generation: 1,
  kind: "ticketCreated",
  ticket_id: "884222222222222222",
  ticket_state: "OPEN",
  ticket_version: 1,
  channel_id: null,
  actor_hash: null,
  actor_ciphertext: null,
  beta_generation: null,
  occurred_at: new Date("2026-10-15T00:00:00Z"),
  created_at: new Date("2026-10-15T00:00:00Z"),
  deadline_at: new Date("2026-10-16T00:00:00Z"),
  state: "PENDING",
  run_id: null,
  reason: null,
};
it("allows only registered typed metadata, never arbitrary IDs or message content", () => {
  expect(validateEventTriggerInputs(base.trigger)).toBe(true);
  expect(
    validateEventTriggerInputs({
      kind: "internal",
      event: "ticketCreated",
      inputs: [{ id: "event.body", name: "Body", type: "PlainText" }],
    }),
  ).toBe(false);
  expect(
    validateEventTriggerInputs({
      kind: "interaction",
      inputs: [{ id: "interaction.member", name: "Person", type: "PlainText" }],
    }),
  ).toBe(false);
  expect(
    validateEventTriggerInputs({
      kind: "interaction",
      inputs: [...INTERACTION_EVENT_FIELDS, ...INTERACTION_EVENT_FIELDS],
    }),
  ).toBe(false);
  expect(validateEventTriggerInputs({ kind: "interaction", inputs: [] })).toBe(
    true,
  );
});
it("maps only adopted ticket metadata and propagates same-guild resumable provenance", () => {
  const values = automationEventValues(base, event, guildId);
  expect(Object.keys(values)).toEqual(
    INTERNAL_EVENT_FIELDS.map((field) => field.id),
  );
  expect(values["event.ticket"]).toMatchObject({
    type: "TicketRef",
    value: { id: event.ticket_id, guildId },
    provenance: [{ source: "service", guildId, resumable: true }],
  });
  expect(values["event.occurredAt"]!.value).toBe("2026-10-15T00:00:00.000Z");
  expect(() =>
    automationEventValues(base, { ...event, kind: "ticketUpdated" }, guildId),
  ).toThrow("AUTOMATION_EVENT_KIND_INVALID");
});
it("derives interaction person from the actual verified caller and never from the enabler", () => {
  const definition: FlowDefinition = {
    ...base,
    trigger: { kind: "interaction", inputs: [...INTERACTION_EVENT_FIELDS] },
  };
  const values = automationEventValues(
    definition,
    {
      ...event,
      source: "INTERACTION",
      kind: "interaction",
      channel_id: "884333333333333333",
    },
    guildId,
    "884444444444444444",
  );
  expect(values["interaction.member"]!.value).toEqual({
    id: "884444444444444444",
    guildId,
  });
  expect(values["interaction.channel"]!.value).toEqual({
    id: "884333333333333333",
    guildId,
  });
});
