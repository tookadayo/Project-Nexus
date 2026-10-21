import type {
  TriggerDefinition,
  ValueType,
  VariableDeclaration,
} from "./types";

/** Deliberately metadata-only. Input labels are editable; IDs and types identify
 * a registered source, never a caller-selected property or Discord message. */
export const INTERNAL_EVENT_FIELDS: ReadonlyArray<VariableDeclaration> = [
  { id: "event.ticket", name: "Ticket", type: "TicketRef" },
  {
    id: "event.state",
    name: "Ticket state",
    type: {
      kind: "Enum",
      values: [
        "OPEN",
        "ACKNOWLEDGED",
        "IN_PROGRESS",
        "SNOOZED",
        "RESOLVED",
        "DISMISSED",
      ],
    },
  },
  { id: "event.version", name: "Ticket version", type: "Number" },
  { id: "event.occurredAt", name: "Event time", type: "Instant" },
];
export const INTERACTION_EVENT_FIELDS: ReadonlyArray<VariableDeclaration> = [
  {
    id: "interaction.member",
    name: "Person who pressed the button",
    type: "MemberRef",
  },
  { id: "interaction.channel", name: "Button channel", type: "ChannelRef" },
  { id: "interaction.occurredAt", name: "Button press time", type: "Instant" },
];
export function eventTypeEqual(left: ValueType, right: ValueType) {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function validateEventTriggerInputs(
  trigger: TriggerDefinition,
): boolean {
  if (trigger.kind !== "internal" && trigger.kind !== "interaction")
    return true;
  const fields =
    trigger.kind === "internal"
      ? INTERNAL_EVENT_FIELDS
      : INTERACTION_EVENT_FIELDS;
  return (
    trigger.inputs.length <= fields.length &&
    new Set(trigger.inputs.map((input) => input.id)).size ===
      trigger.inputs.length &&
    trigger.inputs.every((input) =>
      fields.some(
        (field) =>
          field.id === input.id && eventTypeEqual(field.type, input.type),
      ),
    )
  );
}
