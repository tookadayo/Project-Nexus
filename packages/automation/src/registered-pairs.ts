import type { AtomicType, RecordSchema, ValueType } from "./types";

/** Atomic identifiers remain compatible; compound pairs use the fixed generic
 * schema with explicit type arguments. Pairing never grants construction of a
 * service-owned value: the expression validator recursively checks its fields.
 */
export const REGISTERED_PAIR_TYPES = Object.freeze([
  "Number",
  "Boolean",
  "PlainText",
  "Instant",
  "Duration",
  "DateOnly",
  "LocalTime",
  "TimeZone",
  "ConditionResult",
  "ChannelRef",
  "RoleRef",
  "MemberRef",
  "ThreadRef",
  "MessageRef",
  "TicketRef",
  "EventRef",
] as const satisfies readonly AtomicType[]);
const registeredTypes = new Set<string>(REGISTERED_PAIR_TYPES);

export function registeredPairType(
  first: ValueType,
  second: ValueType,
): ValueType | undefined {
  if (
    typeof first === "string" &&
    typeof second === "string" &&
    registeredTypes.has(first) &&
    registeredTypes.has(second)
  )
    return { kind: "Record", schemaId: `nexus.pair.${first}.${second}.v1` };
  return {
    kind: "Record",
    schemaId: "nexus.pair.v1",
    typeArgs: [structuredClone(first), structuredClone(second)],
  };
}

export function registeredPairFields(
  type: ValueType,
): { first: ValueType; second: ValueType } | undefined {
  if (typeof type === "string" || type.kind !== "Record") return undefined;
  if (type.schemaId === "nexus.pair.v1")
    return type.typeArgs?.length === 2
      ? { first: type.typeArgs[0]!, second: type.typeArgs[1]! }
      : undefined;
  if (type.typeArgs?.length) return undefined;
  const match = /^nexus\.pair\.([A-Za-z]+)\.([A-Za-z]+)\.v1$/.exec(
    type.schemaId,
  );
  if (
    !match ||
    !registeredTypes.has(match[1]!) ||
    !registeredTypes.has(match[2]!)
  )
    return undefined;
  return {
    first: match[1] as AtomicType,
    second: match[2] as AtomicType,
  };
}

export function registeredPairSchema(
  schema: string | ValueType,
): RecordSchema | undefined {
  const fields = registeredPairFields(
    typeof schema === "string" ? { kind: "Record", schemaId: schema } : schema,
  );
  return fields
    ? {
        userConstructible: true,
        fields: {
          first: { type: fields.first },
          second: { type: fields.second },
        },
      }
    : undefined;
}
