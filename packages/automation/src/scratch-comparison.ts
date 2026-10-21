import type { JsonValue, RecordSchema, ValueType } from "./types";
import { DEFAULT_AUTOMATION_LIMITS } from "./types";
import { isLocalTimeDescriptor } from './temporal-types';

/** Comparison descriptors belong to scratch.v1. Legacy definitions keep their
 * original JSON equality and ordering, including text ordering.
 */
export class ScratchComparisonError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ScratchComparisonError";
  }
}
type SchemaResolver = (type: ValueType) => RecordSchema;
const atomicEquality = new Set([
  "Number", "Boolean", "PlainText", "DateOnly", "Instant", "LocalTime", "Duration",
  "ChannelRef", "RoleRef", "MemberRef", "ThreadRef", "MessageRef", "TicketRef", "EventRef",
]);
const ordered = new Set(["Number", "Duration", "DateOnly", "Instant", "LocalTime"]);
const fail = (code: string, message: string): never => { throw new ScratchComparisonError(code, message); };

export function assertScratchComparable(type: ValueType, resolve: SchemaResolver, maximumDepth = DEFAULT_AUTOMATION_LIMITS.maxNesting, depth = 0): void {
  if (depth > maximumDepth) fail("COMPARISON_DEPTH", "The comparison descriptor exceeds the shared nesting budget.");
  if (typeof type === "string") {
    if (!atomicEquality.has(type)) fail("COMPARISON_TYPE", "Extract a comparable typed value before comparing it.");
    return;
  }
  if (type.kind === "Enum") {
    if (!type.schemaId || !Number.isSafeInteger(type.schemaRevision) || type.schemaRevision! < 1)
      return fail("COMPARISON_CHOICE_DOMAIN", "This choice needs an explicit stable domain and schema revision before generic equality comparison.");
    return;
  }
  if (isLocalTimeDescriptor(type)) return;
  if (type.kind === "List") return assertScratchComparable(type.element, resolve, maximumDepth, depth + 1);
  if (type.kind !== "Record") fail("COMPARISON_TYPE", "Branch on the result state before comparing its value.");
  const schema = resolve(type), descriptor = schema.equality;
  if (!descriptor || descriptor.version !== 1 || !descriptor.fields.length || new Set(descriptor.fields).size !== descriptor.fields.length)
    return fail("COMPARISON_DESCRIPTOR", "Choose a registered equality descriptor or extract a typed key.");
  for (const key of descriptor.fields) {
    if (!Object.hasOwn(schema.fields, key)) fail("COMPARISON_DESCRIPTOR", "The equality descriptor references an unregistered field.");
    assertScratchComparable(schema.fields[key]!.type, resolve, maximumDepth, depth + 1);
  }
}
export function assertScratchOrdered(type: ValueType, textOrder?: string): void {
  if (isLocalTimeDescriptor(type)) return;
  if (typeof type === "string" && (ordered.has(type) || type === "PlainText" && textOrder === "unicode-scalar.v1")) return;
  fail("COMPARISON_ORDER", "These values do not have a registered ordering.");
}

/** The returned key follows only the registered descriptor. No service read,
 * display-name lookup, locale ordering or arbitrary all-JSON equality occurs.
 */
export function scratchEqualityKey(type: ValueType, value: JsonValue, resolve: SchemaResolver, maximumDepth = DEFAULT_AUTOMATION_LIMITS.maxNesting): string {
  assertScratchComparable(type, resolve, maximumDepth);
  const visit = (current: ValueType, input: JsonValue): JsonValue => {
    if (typeof current === "string") {
      if (current === "Instant") return Date.parse(input as string);
      if (current.endsWith("Ref")) {
        const ref = input as { id: string; guildId: string };
        return [current, ref.guildId, ref.id];
      }
      return input;
    }
    if (current.kind === "Enum") return input;
    if (isLocalTimeDescriptor(current)) return input;
    if (current.kind === "List") return (input as JsonValue[]).map(item => visit(current.element, item));
    // assertScratchComparable already excludes all result/optional types.
    if (current.kind !== "Record") return fail("COMPARISON_TYPE", "This value has no equality descriptor.");
    const schema = resolve(current), record = input as Record<string, JsonValue>;
    return schema.equality!.fields.map(key => Object.hasOwn(record, key)
      ? [key, true, visit(schema.fields[key]!.type, record[key]!)]
      : [key, false]);
  };
  return JSON.stringify(visit(type, value));
}

/** Stable order in the explicitly selected schema. Scalar text ordering is an
 * opt-in sort key, never a normal PlainText comparison.
 */
export function scratchOrder(type: ValueType, first: JsonValue, second: JsonValue, textOrder?: string): number {
  assertScratchOrdered(type, textOrder);
  if (type === "PlainText") {
    const a = Array.from(first as string, character => character.codePointAt(0)!),
      b = Array.from(second as string, character => character.codePointAt(0)!);
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  }
  const a = type === "Instant" ? Date.parse(first as string) : first as number | string,
    b = type === "Instant" ? Date.parse(second as string) : second as number | string;
  return a < b ? -1 : a > b ? 1 : 0;
}
