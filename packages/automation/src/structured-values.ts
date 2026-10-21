import type { JsonValue, RecordSchema, ValueType } from "./types";
import { registeredPairSchema } from "./registered-pairs";
import {iterationResultSchema,validIterationResult,ITERATION_RESULT_SCHEMA} from './iteration-results';
import { isLocalTimeDescriptor } from './temporal-types';

export const GROUP_SCHEMA = "nexus.group.v1";
export const FIND_MATCH_SCHEMA = "nexus.find-match.v1";
export const MIN_MAX_SCHEMA = "MinMaxValue";
export const INDEX_RESULT_SCHEMA = "nexus.index-result.v1";
export const SEARCH_RESULT_SCHEMA = "nexus.search-result.v1";
export const indexResultType: ValueType = { kind: "Record", schemaId: INDEX_RESULT_SCHEMA };
export const searchResultType = (item: ValueType): ValueType => ({ kind: "Record", schemaId: SEARCH_RESULT_SCHEMA, typeArgs: [structuredClone(item)] });
export const groupRecordType = (key: ValueType, item: ValueType): ValueType => ({
  kind: "Record", schemaId: GROUP_SCHEMA, typeArgs: [structuredClone(key), structuredClone(item)],
});
export const findMatchType = (item: ValueType): ValueType => ({
  kind: "Record", schemaId: FIND_MATCH_SCHEMA, typeArgs: [structuredClone(item)],
});
/** Fixed schema names, explicit type arguments, no caller-selected field names. */
export function structuredRecordSchema(type: ValueType): RecordSchema | undefined {
  const iteration=iterationResultSchema(type);if(iteration)return iteration;
  if (typeof type === "string" || type.kind !== "Record") return undefined;
  const pair = registeredPairSchema(type);
  if (pair) return pair;
  if (type.schemaId === INDEX_RESULT_SCHEMA && !type.typeArgs?.length)
    return { userConstructible: false, fields: { state: { type: { kind: "Enum", values: ["found", "not_found"] } }, index: { type: "Number", optional: true } } };
  if (type.schemaId === SEARCH_RESULT_SCHEMA && type.typeArgs?.length === 1)
    return { userConstructible: false, fields: { state: { type: { kind: "Enum", values: ["found", "not_found"] } }, index: { type: "Number", optional: true }, value: { type: type.typeArgs[0]!, optional: true } } };
  if (type.schemaId === GROUP_SCHEMA && type.typeArgs?.length === 2)
    return { userConstructible: true, equality: { version: 1, fields: ["key", "items"] }, fields: { key: { type: type.typeArgs[0]! }, items: { type: { kind: "List", element: type.typeArgs[1]! } } } };
  if (type.schemaId === FIND_MATCH_SCHEMA && type.typeArgs?.length === 1)
    return { userConstructible: true, equality: { version: 1, fields: ["item", "position"] }, fields: { item: { type: type.typeArgs[0]! }, position: { type: "Number" } } };
  return undefined;
}
export function reservedStructuredSchema(id: string): boolean {
  if(id===ITERATION_RESULT_SCHEMA)return true;
  return id === "nexus.pair.v1" || id === GROUP_SCHEMA || id === FIND_MATCH_SCHEMA || id === INDEX_RESULT_SCHEMA || id === SEARCH_RESULT_SCHEMA || /^nexus\.pair\./.test(id);
}
export function validStructuredRecordValue(type: ValueType, value: JsonValue): boolean {
  if(!validIterationResult(type,value))return false;
  if (typeof type !== "string" && type.kind === "Record" && [INDEX_RESULT_SCHEMA, SEARCH_RESULT_SCHEMA].includes(type.schemaId)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    if (value.state === "not_found") return Object.keys(value).length === 1;
    return value.state === "found" && typeof value.index === "number" && Number.isSafeInteger(value.index) && value.index >= 1 && (type.schemaId === INDEX_RESULT_SCHEMA ? !Object.hasOwn(value, "value") : Object.hasOwn(value, "value"));
  }
  if (typeof type === "string" || type.kind !== "Record" || type.schemaId !== FIND_MATCH_SCHEMA) return true;
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.position === "number" && Number.isSafeInteger(value.position) && value.position >= 1;
}

export function stableListKey(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableListKey).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableListKey(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function mappingKeyType(type: ValueType): boolean {
  return typeof type === "string"
    ? ["Number", "PlainText", "Boolean", "DateOnly", "Instant", "Duration", "LocalTime", "TimeZone", "ChannelRef", "RoleRef", "MemberRef", "ThreadRef", "MessageRef", "TicketRef", "EventRef"].includes(type)
    : type.kind === "Enum" || isLocalTimeDescriptor(type);
}
