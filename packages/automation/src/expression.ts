import {
  addCalendarDays,
  elapsedRelativeInstant,
  parseDateOnly,
  parseInstant,
  parseLocalTime,
  assertTimeZone,
} from "./datetime";
import { DEFAULT_AUTOMATION_LIMITS } from "./types";
import { registeredPairType } from "./registered-pairs";
import { isParseTarget, parseRegisteredValue, PARSE_FAILURE_CODES } from "./results";
import {
  TEMPORAL_OPERATORS,
  evaluateTemporalOperator,
  isTemporalOperator,
  temporalSignature,
  validateTemporalValue,
} from "./temporal-values";
import { structuredRecordSchema, reservedStructuredSchema, validStructuredRecordValue,
  groupRecordType, findMatchType, mappingKeyType, stableListKey } from "./structured-values";
import {
  renderRichText,
  escapeMarkdown,
  validateEmbedSpec,
  validateMessageSpec,
  type RichTextNode,
} from "./message";
import type {
  AutomationLimits,
  ConditionResult,
  EvaluatedValue,
  EvaluationContext,
  Expression,
  JsonValue,
  Provenance,
  RecordSchema,
  ValueInput,
  ValueType,
} from "./types";

export class AutomationValueError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutomationValueError";
  }
}
export const BUILTIN_RECORD_SCHEMAS: Readonly<Record<string, RecordSchema>> = {
  "nexus.ticket.status.v1": {
    userConstructible: false,
    fields: {
      state: {
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
      version: { type: "Number" },
    },
  },
  AverageValue: {
    userConstructible: true,
    fields: {
      value: { type: { kind: "Optional", value: "Number" } },
      count: { type: "Number" },
    },
  },
  MinMaxValue: {
    userConstructible: true,
    fields: {
      minimum: { type: { kind: "Optional", value: "Number" } },
      maximum: { type: { kind: "Optional", value: "Number" } },
    },
  },
};
export function automationLimits(
  overrides?: Partial<AutomationLimits>,
): AutomationLimits {
  const limits = { ...DEFAULT_AUTOMATION_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new AutomationValueError(
        "LIMIT_CONFIGURATION",
        `A finite positive ${key} limit is required.`,
      );
  return limits;
}
export function typeEquals(a: ValueType, b: ValueType): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "List" && b.kind === "List")
    return typeEquals(a.element, b.element);
  if (a.kind === "Optional" && b.kind === "Optional")
    return typeEquals(a.value, b.value);
  if ((a.kind === "ParseResult" && b.kind === "ParseResult") || (a.kind === "OperationOutcome" && b.kind === "OperationOutcome"))
    return typeEquals(a.value, b.value);
  if (a.kind === "Record" && b.kind === "Record")
    return a.schemaId === b.schemaId && (a.typeArgs?.length ?? 0) === (b.typeArgs?.length ?? 0) &&
      (a.typeArgs ?? []).every((type, index) => typeEquals(type, b.typeArgs![index]!));
  return (
    a.kind === "Enum" &&
    b.kind === "Enum" &&
    a.values.length === b.values.length &&
    a.values.every((v, i) => v === b.values[i])
  );
}
export function typeLabel(type: ValueType): string {
  return typeof type === "string"
    ? type
    : type.kind === "List"
      ? `List<${typeLabel(type.element)}>`
      : type.kind === "Optional"
        ? `Optional<${typeLabel(type.value)}>`
        : type.kind === "ParseResult" || type.kind === "OperationOutcome"
          ? `${type.kind}<${typeLabel(type.value)}>`
        : type.kind === "Record"
          ? type.schemaId
          : "Enum";
}
function fail(code: string, message: string): never {
  throw new AutomationValueError(code, message);
}
function assertResultEvidence(type: ValueType, value: JsonValue, provenance: Provenance[], context: EvaluationContext): void {
  if (typeof type === "string") return;
  if (type.kind === "ParseResult" || type.kind === "OperationOutcome") {
    const evidence = type.kind === "ParseResult" ? "parse" : "operation";
    if (!provenance.some(source => source.evidence === evidence && (evidence === "parse" || source.source === "service" && source.guildId === context.guildId)))
      fail("RESULT_PROVENANCE", "This typed result was not issued by its registered producer.");
    if (plainObject(value) && value.state === "SUCCEEDED") assertResultEvidence(type.value, value.value!, provenance, context);
  } else if (type.kind === "List" && Array.isArray(value)) for (const item of value) assertResultEvidence(type.element, item, provenance, context);
  else if (type.kind === "Optional" && plainObject(value) && value.state === "set") assertResultEvidence(type.value, value.value!, provenance, context);
  else if (type.kind === "Record" && plainObject(value)) for (const [key, field] of Object.entries(schemaFor(type, context).fields)) if (Object.hasOwn(value,key)) assertResultEvidence(field.type,value[key]!,provenance,context);
}
function plainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function assertFiniteNumber(value: JsonValue): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("FINITE_NUMBER", "A finite number is required.");
  return value;
}
export function assertCount(
  value: JsonValue,
  maximum: number,
  allowZero = true,
): number {
  const n = assertFiniteNumber(value);
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > maximum)
    fail("COUNT", "The count must be an integer within the permitted range.");
  return n;
}
/** Empty placeholders are never converted to zero. Direct count input is intentionally strict. */
export function parseCountLiteral(value: string, maximum: number): number {
  if (!/^(0|[1-9]\d*)$/.test(value))
    fail(
      value === "" ? "MISSING_INPUT" : "COUNT_FORMAT",
      "Enter a count using half-width non-negative integers.",
    );
  return assertCount(Number(value), maximum);
}
function safeObjectKey(value: string): boolean {
  return (
    value !== "__proto__" && value !== "prototype" && value !== "constructor"
  );
}
function schemaFor(type: ValueType, context: EvaluationContext): RecordSchema {
  if (typeof type === "string" || type.kind !== "Record")
    return fail("RECORD_TYPE", "A registered record type is required.");
  const structured = structuredRecordSchema(type);
  if (structured) return structured;
  if (reservedStructuredSchema(type.schemaId) || type.typeArgs?.length)
    return fail("RECORD_SCHEMA", "Choose a registered schema with its declared type arguments.");
  const schema = Object.hasOwn(BUILTIN_RECORD_SCHEMAS, type.schemaId)
    ? BUILTIN_RECORD_SCHEMAS[type.schemaId]
    : Object.hasOwn(context.recordSchemas ?? {}, type.schemaId)
      ? context.recordSchemas![type.schemaId] : undefined;
  if (!schema) fail("RECORD_SCHEMA", "This record schema is not registered.");
  return schema;
}
export const registeredRecordSchema = schemaFor;
function assertConstructible(
  type: ValueType,
  context: EvaluationContext,
  depth = 0,
): void {
  if (depth > automationLimits(context.limits).maxNesting)
    fail("VALUE_DEPTH", "The value type is too deeply nested.");
  if (typeof type === "string") return;
  if (type.kind === "ParseResult" || type.kind === "OperationOutcome")
    fail("RESULT_LITERAL", "Typed results are issued only by their registered producer.");
  if (type.kind === "List")
    return assertConstructible(type.element, context, depth + 1);
  if (type.kind === "Optional")
    return assertConstructible(type.value, context, depth + 1);
  if (type.kind === "Record") {
    const schema = schemaFor(type, context);
    if (!schema.userConstructible)
      fail(
        "SERVICE_VALUE",
        "Service-only evidence and results cannot be constructed from literals.",
      );
    for (const field of Object.values(schema.fields))
      assertConstructible(field.type, context, depth + 1);
  }
}
export function assertValueMatchesType(
  type: ValueType,
  value: JsonValue,
  context: Pick<EvaluationContext, "guildId" | "recordSchemas" | "limits">,
  depth = 0,
): void {
  const limits = automationLimits(context.limits);
  if (depth > limits.maxNesting)
    fail("VALUE_DEPTH", "The value is too deeply nested.");
  if (typeof type === "object") {
    if (type.kind === "ParseResult" || type.kind === "OperationOutcome") {
      if (type.kind === "ParseResult" && !isParseTarget(type.value)) fail("PARSE_TYPE", "Choose a registered strict conversion target.");
      if (!plainObject(value) || !["SUCCEEDED", "FAILED", ...(type.kind === "OperationOutcome" ? ["NOT_STARTED", "UNKNOWN"] : [])].includes(String(value.state)))
        fail("RESULT_STATE", "A registered typed result is required.");
      if (value.state === "SUCCEEDED") {
        if (!Object.hasOwn(value, "value") || Object.keys(value).some(key => !["state", "value"].includes(key))) fail("RESULT_VALUE", "Only a successful result contains a value.");
        assertValueMatchesType(type.value, value.value!, context, depth + 1);
      } else {
        if (typeof value.reason !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.reason) || Object.keys(value).some(key => !["state", "reason"].includes(key)) || type.kind === "ParseResult" && !(PARSE_FAILURE_CODES as readonly string[]).includes(value.reason))
          fail("RESULT_REASON", "A failed result contains only a registered safe reason.");
      }
      return;
    }
    if (type.kind === "List") {
      if (!Array.isArray(value) || value.length > limits.maxListItems)
        fail(
          "LIST_SIZE",
          "A finite typed list within the permitted size is required.",
        );
      for (const item of value)
        assertValueMatchesType(type.element, item, context, depth + 1);
      return;
    }
    if (type.kind === "Optional") {
      if (
        !plainObject(value) ||
        !["set", "unset"].includes(String(value.state)) ||
        Object.keys(value).some((key) => !["state", "value"].includes(key))
      )
        fail("OPTIONAL", "A registered optional value is required.");
      if (value.state === "set") {
        if (!Object.hasOwn(value, "value"))
          fail("OPTIONAL", "The set optional value is missing.");
        assertValueMatchesType(type.value, value.value!, context, depth + 1);
      } else if (Object.hasOwn(value, "value"))
        fail("OPTIONAL", "An unset optional cannot contain a value.");
      return;
    }
    if (type.kind === "Enum") {
      if (typeof value !== "string" || !type.values.includes(value))
        fail("ENUM", "Choose a registered choice.");
      return;
    }
    const schema = schemaFor(type, { ...context, variables: {} });
    if (!plainObject(value))
      fail("RECORD", "A registered structured value is required.");
    for (const key of Object.keys(value))
      if (!safeObjectKey(key) || !Object.hasOwn(schema.fields, key))
        fail("RECORD_FIELD", "This field is not registered.");
    for (const [key, field] of Object.entries(schema.fields)) {
      if (!Object.hasOwn(value, key)) {
        if (!field.optional)
          fail("RECORD_MISSING", "A required record field is missing.");
      } else
        assertValueMatchesType(field.type, value[key]!, context, depth + 1);
    }
    if (!validStructuredRecordValue(type, value))
      fail("RECORD_VALUE", "The registered match position must be a positive integer.");
    return;
  }
  switch (type) {
    case "ZonedDateTimeSpec":
    case "DateRange":
    case "InstantRange":
      validateTemporalValue(type, value);
      break;
    case "Number":
      assertFiniteNumber(value);
      break;
    case "Duration":
      assertFiniteNumber(value);
      break;
    case "Boolean":
      if (typeof value !== "boolean") fail("BOOLEAN", "Choose yes or no.");
      break;
    case "ConditionResult":
      if (!["true", "false", "unknown"].includes(String(value)))
        fail("CONDITION", "A typed condition result is required.");
      break;
    case "RichTextSpec":
      if (!Array.isArray(value))
        fail("RICH_SCHEMA", "Choose registered rich-text parts.");
      renderRichText(value as unknown as RichTextNode[]);
      break;
    case "EmbedSpec":
      validateEmbedSpec(value);
      break;
    case "LegacyMessageSpec": {
      const spec = validateMessageSpec(value);
      if (spec.kind !== "legacy")
        fail("MESSAGE_MODE", "This slot accepts a Legacy message only.");
      break;
    }
    case "PlainText":
    case "RichText":
      if (
        typeof value !== "string" ||
        Array.from(value).length > limits.maxTextLength
      )
        fail("TEXT_SIZE", "The text exceeds the permitted size.");
      break;
    case "DateOnly":
      if (typeof value !== "string" || parseDateOnly(value) !== value)
        fail("DATE_FORMAT", "A normalized date is required.");
      break;
    case "LocalTime":
      if (typeof value !== "string")
        fail("TIME_FORMAT", "A local time is required.");
      parseLocalTime(value);
      break;
    case "Instant":
      if (typeof value !== "string")
        fail("INSTANT", "A UTC instant is required.");
      parseInstant(value);
      break;
    case "TimeZone":
      if (typeof value !== "string")
        fail("TIME_ZONE", "An IANA time zone is required.");
      assertTimeZone(value);
      break;
    default:
      if (
        !plainObject(value) ||
        typeof value.id !== "string" ||
        !(
          type === "TicketRef"
            ? /^(?:\d{5,30}|intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
            : /^\d{5,30}$/
        ).test(value.id) ||
        value.guildId !== context.guildId ||
        Object.keys(value).some((key) => !["id", "guildId"].includes(key))
      )
        fail(
          "REFERENCE_SCOPE",
          "Choose a permitted reference belonging to this server.",
        );
  }
}
function listType(type: ValueType): ValueType {
  if (typeof type === "string" || type.kind !== "List")
    fail("LIST_TYPE", "A typed list is required.");
  return type.element;
}
function optionalType(type: ValueType): ValueType {
  if (typeof type === "string" || type.kind !== "Optional")
    fail("OPTIONAL_TYPE", "An optional value is required.");
  return type.value;
}
function requireType(actual: ValueType, expected: ValueType): void {
  if (!typeEquals(actual, expected))
    fail("TYPE", `This input needs ${typeLabel(expected)}.`);
}
function arity(args: ValueInput[], minimum: number, maximum = minimum): void {
  if (args.length < minimum || args.length > maximum)
    fail("ARGUMENTS", "The expression has an incorrect number of inputs.");
}
const numberBinary = new Set([
  "number.add",
  "number.subtract",
  "number.multiply",
  "number.divide",
  "number.remainder",
  "number.min",
  "number.max",
]);
const numberUnary = new Set([
  "number.abs",
  "number.round",
  "number.floor",
  "number.ceil",
]);
const comparisons = new Set([
  "compare.equal",
  "compare.notEqual",
  "compare.less",
  "compare.lessOrEqual",
  "compare.greater",
  "compare.greaterOrEqual",
]);
const pureOperators = new Set([
  ...TEMPORAL_OPERATORS,
  "number.add",
  "number.subtract",
  "number.multiply",
  "number.divide",
  "number.remainder",
  "number.min",
  "number.max",
  "number.abs",
  "number.clamp",
  "number.round",
  "number.floor",
  "number.ceil",
  "compare.equal",
  "compare.notEqual",
  "compare.less",
  "compare.lessOrEqual",
  "compare.greater",
  "compare.greaterOrEqual",
  "condition.and",
  "condition.or",
  "condition.not",
  "value.choose",
  "optional.default",
  "value.parse",
  "text.join",
  "text.length",
  "text.contains",
  "text.startsWith",
  "text.endsWith",
  "text.slice",
  "text.replace",
  "text.split",
  "text.joinList",
  "text.trim",
  "text.repeat",
  "text.upper",
  "text.lower",
  "rich.text",
  "rich.wrap",
  "rich.join",
  "embed.build",
  "message.legacy",
  "list.build",
  "list.length",
  "list.item",
  "list.append",
  "list.remove",
  "list.insert",
  "list.replace",
  "list.slice",
  "list.concat",
  "list.unique",
  "list.sort",
  "list.sum",
  "list.average",
  "list.min",
  "list.max",
  "list.intersection",
  "list.difference",
  "list.union",
  "list.zip",
  "list.chunk",
  "list.range",
  "list.map",
  "list.filter",
  "list.any",
  "list.all",
  "list.find",
  "list.findResult",
  "list.group",
  "list.minMax",
  "value.lookup",
  "record.build",
  "record.field",
  "record.update",
  "date.compose",
  "date.addDays",
  "date.weekday",
  "instant.add",
  "instant.difference",
  "duration.build",
  "pure.call",
]);
export const EXPRESSION_OPERATORS = [...pureOperators];
export interface ExpressionValidationContext extends EvaluationContext {
  variables: Readonly<Record<string, EvaluatedValue>>;
}
/** Validates every branch, including short-circuited branches, without performing external effects. */
export function validateValueInput(
  input: ValueInput,
  context: EvaluationContext,
  depth = 0,
  counter = { nodes: 0 },
  purePath: string[] = [],
): void {
  const limits = automationLimits(context.limits);
  if (
    ++counter.nodes > limits.maxExpressionNodes ||
    depth > limits.maxExpressionDepth
  )
    fail(
      "EXPRESSION_BUDGET",
      "The expression exceeds the permitted complexity.",
    );
  if (input.kind === "missing") return;
  if (input.kind === "literal") {
    assertConstructible(input.type, context);
    assertValueMatchesType(input.type, input.value, context);
    if (
      new TextEncoder().encode(JSON.stringify(input.value)).byteLength >
      limits.maxValueBytes
    )
      fail("VALUE_BYTES", "The value exceeds the value-size budget.");
    return;
  }
  if (input.kind === "variable") {
    const variable = Object.hasOwn(context.variables, input.variableId)
      ? context.variables[input.variableId]
      : undefined;
    if (!variable)
      fail("VARIABLE_SCOPE", "This value is not available in this scope.");
    requireType(input.type, variable.type);
    return;
  }
  const exp = input.expression,
    args = exp.args;
  if (!pureOperators.has(exp.operator))
    fail(
      "PURE_EFFECT",
      "This operation cannot be placed in a pure value expression.",
    );
  if (exp.options) {
    const allowed =
      exp.operator === "rich.wrap"
        ? ["format"]
        : exp.operator === "value.parse"
          ? ["conversion"]
        : exp.operator === "pure.call"
          ? ["definitionId", "revision"]
          : exp.operator.startsWith("record.")
            ? ["key", "fields"]
            : [
                  "list.map",
                  "list.filter",
                  "list.any",
                  "list.all",
                  "list.find",
                  "list.findResult",
                ].includes(exp.operator)
              ? ["bindingId", "body"]
              : exp.operator === "duration.build"
                ? ["unit"]
                : numberUnary.has(exp.operator)
                  ? ["digits"]
                  : [
                        "list.unique",
                        "list.sort",
                        "list.intersection",
                        "list.difference",
                        "list.union",
                        "list.group",
                      ].includes(exp.operator)
                    ? ["key", "descending"]
                    : [];
    if (Object.keys(exp.options).some((key) => !allowed.includes(key)))
      fail(
        "EXPRESSION_OPTIONS",
        "This option is not registered for this operation.",
      );
  }
  for (const argument of args)
    validateValueInput(argument, context, depth + 1, counter, purePath);
  const first = args[0]?.type,
    second = args[1]?.type;
  let output: ValueType;
  if (isTemporalOperator(exp.operator)) {
    output = temporalSignature(exp.operator, args.map((argument) => argument.type)).output;
  } else if (exp.operator === "rich.text") {
    arity(args, 1);
    requireType(first!, "PlainText");
    output = "RichTextSpec";
  } else if (exp.operator === "rich.wrap") {
    arity(args, 1);
    requireType(first!, "RichTextSpec");
    if (
      ![
        "bold",
        "italic",
        "underline",
        "strike",
        "spoiler",
        "quote",
        "heading1",
        "heading2",
        "heading3",
      ].includes(exp.options?.format ?? "")
    )
      fail("RICH_FORMAT", "Choose a registered rich-text format.");
    output = "RichTextSpec";
  } else if (exp.operator === "rich.join") {
    arity(args, 0, 100);
    args.forEach((arg) => requireType(arg.type, "RichTextSpec"));
    output = "RichTextSpec";
  } else if (exp.operator === "embed.build") {
    arity(args, 2);
    args.forEach((arg) => requireType(arg.type, "PlainText"));
    output = "EmbedSpec";
  } else if (exp.operator === "message.legacy") {
    arity(args, 2);
    requireType(first!, "RichTextSpec");
    requireType(second!, { kind: "List", element: "EmbedSpec" });
    output = "LegacyMessageSpec";
  } else if (numberBinary.has(exp.operator)) {
    arity(args, 2);
    args.forEach((arg) => requireType(arg.type, "Number"));
    output = "Number";
    if (
      ["number.divide", "number.remainder"].includes(exp.operator) &&
      args[1]?.kind === "literal" &&
      args[1].value === 0
    )
      fail("DIVIDE_BY_ZERO", "You cannot divide by zero.");
  } else if (numberUnary.has(exp.operator) || exp.operator === "number.clamp") {
    arity(args, exp.operator === "number.clamp" ? 3 : 1);
    args.forEach((arg) => requireType(arg.type, "Number"));
    const digits = exp.options?.digits ?? 0;
    if (!Number.isInteger(digits) || Math.abs(digits) > 8)
      fail("ROUND_DIGITS", "Choose rounding precision between -8 and 8.");
    output = "Number";
  } else if (comparisons.has(exp.operator)) {
    arity(args, 2);
    requireType(first!, second!);
    if (
      !["compare.equal", "compare.notEqual"].includes(exp.operator) &&
      ![
        "Number",
        "Duration",
        "DateOnly",
        "Instant",
        "LocalTime",
        "PlainText",
      ].includes(String(first))
    )
      fail("COMPARISON", "These values do not have a registered ordering.");
    output = "Boolean";
  } else if (exp.operator.startsWith("condition.")) {
    arity(args, exp.operator === "condition.not" ? 1 : 2);
    if (first !== "Boolean" && first !== "ConditionResult")
      fail("CONDITION_TYPE", "A Boolean or condition result is required.");
    args.forEach((arg) => {
      if (arg.type !== "Boolean" && arg.type !== "ConditionResult")
        fail("CONDITION_TYPE", "A Boolean or condition result is required.");
    });
    output = args.some((arg) => arg.type === "ConditionResult")
      ? "ConditionResult"
      : "Boolean";
  } else if (exp.operator === "value.choose") {
    arity(args, first === "ConditionResult" ? 4 : 3);
    if (first !== "Boolean" && first !== "ConditionResult")
      fail("CONDITION_TYPE", "A typed condition is required.");
    output = second!;
    args.slice(2).forEach((arg) => requireType(arg.type, output));
  } else if (exp.operator === "value.lookup") {
    arity(args, 3, 103);
    if (!mappingKeyType(first!)) fail("LOOKUP_KEY_TYPE", "Choose a registered comparable lookup key type.");
    requireType(second!, { kind: "List", element: first! });
    output = args[2]!.type;
    args.slice(3).forEach(arg => requireType(arg.type, output));
    const keys = args[1]!;
    if (keys.kind !== "missing") {
      if (keys.kind !== "literal" || !Array.isArray(keys.value))
        fail("LOOKUP_FIXED_KEYS", "Mapping keys must be an explicit fixed typed list.");
      if (keys.value.length !== args.length - 3)
        fail("LOOKUP_ROWS", "Every fixed key must have one typed mapped value.");
      if (new Set(keys.value.map(stableListKey)).size !== keys.value.length)
        fail("LOOKUP_DUPLICATE", "Mapping keys must be unique.");
    }
  } else if (exp.operator === "value.parse") {
    arity(args, 1); requireType(first!, "PlainText");
    if (typeof input.type !== "object" || input.type.kind !== "ParseResult" || !isParseTarget(input.type.value)) fail("PARSE_TYPE", "Choose a registered strict conversion target.");
    const target = input.type.value, format = exp.options?.conversion;
    if (!(format === "decimal" && target === "Number" || format === "dateSlash" && target === "DateOnly" || format === "enum" && typeof target === "object" && target.kind === "Enum")) fail("PARSE_FORMAT", "Choose the exact registered conversion format.");
    output = input.type;
  } else if (exp.operator === "optional.default") {
    arity(args, 2);
    output = optionalType(first!);
    requireType(second!, output);
  } else if (exp.operator.startsWith("text.")) {
    output = validateTextExpression(exp);
  } else if (exp.operator.startsWith("list.")) {
    output = validateListExpression(exp, context, depth, counter, purePath);
  } else if (exp.operator.startsWith("record.")) {
    output = validateRecordExpression(input, context);
  } else if (exp.operator === "duration.build") {
    arity(args, 1);
    requireType(first!, "Number");
    if (
      !["seconds", "minutes", "hours", "days"].includes(exp.options?.unit ?? "")
    )
      fail("DURATION_UNIT", "Choose a duration unit.");
    output = "Duration";
  } else if (exp.operator === "date.compose") {
    arity(args, 3);
    args.forEach((arg) => requireType(arg.type, "Number"));
    output = "DateOnly";
  } else if (exp.operator === "date.addDays") {
    arity(args, 2);
    requireType(first!, "DateOnly");
    requireType(second!, "Number");
    output = "DateOnly";
  } else if (exp.operator === "date.weekday") {
    arity(args, 1);
    requireType(first!, "DateOnly");
    output = "Number";
  } else if (exp.operator === "instant.add") {
    arity(args, 2);
    requireType(first!, "Instant");
    requireType(second!, "Duration");
    output = "Instant";
  } else if (exp.operator === "instant.difference") {
    arity(args, 2);
    args.forEach((arg) => requireType(arg.type, "Instant"));
    output = "Duration";
  } else if (exp.operator === "pure.call") {
    const definition = context.pureDefinitions?.find(
      (def) =>
        def.id === exp.options?.definitionId &&
        def.revision === exp.options?.revision,
    );
    if (!definition)
      fail(
        "PURE_DEFINITION",
        "Choose a fixed revision of a registered pure value definition.",
      );
    const identity = `${definition.id}@${definition.revision}`;
    if (purePath.includes(identity) || purePath.length >= limits.maxCallDepth)
      fail(
        "PURE_CYCLE",
        "Recursive or excessively deep value definitions are not permitted.",
      );
    arity(args, definition.inputs.length);
    const variables: Record<string, EvaluatedValue> = {};
    definition.inputs.forEach((parameter, i) => {
      requireType(args[i]!.type, parameter.type);
      variables[parameter.id] = {
        type: parameter.type,
        value: null,
        provenance: [],
      };
    });
    validateValueInput(
      definition.value,
      { ...context, variables },
      depth + 1,
      counter,
      [...purePath, identity],
    );
    output = definition.outputType;
    requireType(definition.value.type, output);
  } else
    return fail("OPERATOR", "This expression operation is not registered.");
  requireType(input.type, output);
}
function validateTextExpression(exp: Expression): ValueType {
  const args = exp.args,
    op = exp.operator;
  arity(
    args,
    op === "text.join"
      ? 0
      : op === "text.replace" || op === "text.slice"
        ? 3
        : op === "text.contains" ||
            op === "text.startsWith" ||
            op === "text.endsWith" ||
            op === "text.split" ||
            op === "text.joinList" ||
            op === "text.repeat"
          ? 2
          : 1,
    op === "text.join"
      ? 100
      : op === "text.replace" || op === "text.slice"
        ? 3
        : op === "text.contains" ||
            op === "text.startsWith" ||
            op === "text.endsWith" ||
            op === "text.split" ||
            op === "text.joinList" ||
            op === "text.repeat"
          ? 2
          : 1,
  );
  args.forEach((arg, i) =>
    requireType(
      arg.type,
      op === "text.joinList" && i === 0
        ? { kind: "List", element: "PlainText" }
        : (op === "text.slice" && i > 0) || (op === "text.repeat" && i === 1)
          ? "Number"
          : "PlainText",
    ),
  );
  return op === "text.length"
    ? "Number"
    : ["text.contains", "text.startsWith", "text.endsWith"].includes(op)
      ? "Boolean"
      : op === "text.split"
        ? { kind: "List", element: "PlainText" }
        : "PlainText";
}
function validateListExpression(
  exp: Expression,
  context: EvaluationContext,
  depth: number,
  counter: { nodes: number },
  purePath: string[],
): ValueType {
  const args = exp.args,
    op = exp.operator;
  if (op === "list.range") {
    arity(args, 3);
    args.forEach((arg) => requireType(arg.type, "Number"));
    return { kind: "List", element: "Number" };
  }
  if (op === "list.build") {
    if (args.length === 0)
      fail(
        "LIST_ELEMENT_TYPE",
        "Use a literal typed empty list when no elements are present.",
      );
    const type = args[0]!.type;
    args.forEach((arg) => requireType(arg.type, type));
    return { kind: "List", element: type };
  }
  const element = listType(args[0]?.type ?? "Number"),
    list = { kind: "List" as const, element };
  const one = [
    "list.length",
    "list.unique",
    "list.sort",
    "list.sum",
    "list.average",
    "list.min",
    "list.max",
    "list.map",
    "list.filter",
    "list.any",
    "list.all",
    "list.find",
    "list.findResult",
    "list.group",
    "list.minMax",
  ];
  arity(
    args,
    one.includes(op)
      ? 1
      : ["list.insert", "list.replace", "list.slice"].includes(op)
        ? 3
        : 2,
  );
  if (op === "list.length") return "Number";
  if (["list.sum", "list.average", "list.min", "list.max", "list.minMax"].includes(op)) {
    requireType(element, "Number");
    return op === "list.sum"
      ? "Number"
      : op === "list.average"
        ? { kind: "Record", schemaId: "AverageValue" }
        : op === "list.minMax"
          ? { kind: "Record", schemaId: "MinMaxValue" }
        : { kind: "Optional", value: "Number" };
  }
  if (
    ["list.map", "list.filter", "list.any", "list.all", "list.find", "list.findResult"].includes(
      op,
    )
  ) {
    const id = exp.options?.bindingId,
      body = exp.options?.body;
    if (!id || !body || Object.hasOwn(context.variables, id))
      fail(
        "LIST_BINDING",
        "Choose a unique local list-item binding and a pure expression.",
      );
    validateValueInput(
      body,
      {
        ...context,
        variables: {
          ...context.variables,
          [id]: { type: element, value: null, provenance: [] },
        },
      },
      depth + 1,
      counter,
      purePath,
    );
    if (op !== "list.map") requireType(body.type, "Boolean");
    return op === "list.map"
      ? { kind: "List", element: body.type }
      : op === "list.any" || op === "list.all"
        ? "Boolean"
        : op === "list.find"
          ? { kind: "Optional", value: element }
          : op === "list.findResult"
            ? { kind: "Optional", value: findMatchType(element) }
          : list;
  }
  if (
    op === "list.item" ||
    op === "list.remove" ||
    op === "list.chunk" ||
    op === "list.slice" ||
    op === "list.insert" ||
    op === "list.replace"
  )
    requireType(args[1]!.type, "Number");
  if (op === "list.slice") requireType(args[2]!.type, "Number");
  if (op === "list.append") requireType(args[1]!.type, element);
  if (op === "list.insert" || op === "list.replace")
    requireType(args[2]!.type, element);
  if (
    [
      "list.concat",
      "list.intersection",
      "list.difference",
      "list.union",
    ].includes(op)
  )
    requireType(args[1]!.type, list);
  if (op === "list.zip") {
    const pair = registeredPairType(element, listType(args[1]!.type));
    if (!pair)
      return fail(
        "ZIP_PAIR_TYPE",
        "Choose lists with valid registered pair component types.",
      );
    return { kind: "List", element: pair };
  }
  if (exp.options?.key) {
    const schema = schemaFor(element, context);
    if (!Object.hasOwn(schema.fields, exp.options.key))
      fail("COMPARISON_KEY", "Choose a registered comparison field.");
  }
  if (op === "list.group") {
    if (typeof element === "object" && element.kind === "Record" && !exp.options?.key)
      fail("GROUP_KEY", "Choose a registered grouping field.");
    const keyType = exp.options?.key ? schemaFor(element, context).fields[exp.options.key]!.type : element;
    return { kind: "List", element: groupRecordType(keyType, element) };
  }
  if (
    op === "list.sort" &&
    !exp.options?.key &&
    ![
      "Number",
      "Duration",
      "DateOnly",
      "Instant",
      "LocalTime",
      "PlainText",
    ].includes(String(element))
  )
    fail("COMPARISON_KEY", "Choose a registered ordered comparison field.");
  return op === "list.item"
    ? element
    : op === "list.chunk"
      ? { kind: "List", element: list }
      : list;
}
function validateRecordExpression(
  input: ValueInput & { kind: "expression" },
  context: EvaluationContext,
): ValueType {
  const exp = input.expression;
  if (exp.operator === "record.field") {
    arity(exp.args, 1);
    const schema = schemaFor(exp.args[0]!.type, context),
      field = schema.fields[exp.options?.key ?? ""];
    if (!field) fail("RECORD_FIELD", "Choose a registered field.");
    return field.type;
  }
  const schema = schemaFor(input.type, context);
  if (!schema.userConstructible)
    fail(
      "SERVICE_VALUE",
      "Service-only evidence and results cannot be constructed.",
    );
  const fields = exp.options?.fields ?? [];
  if (
    new Set(fields).size !== fields.length ||
    fields.some(
      (field) => !safeObjectKey(field) || !Object.hasOwn(schema.fields, field),
    )
  )
    fail("RECORD_FIELD", "Choose unique registered fields.");
  if (exp.operator === "record.build") {
    arity(exp.args, fields.length);
    for (const [key, field] of Object.entries(schema.fields))
      if (!field.optional && !fields.includes(key))
        fail("RECORD_MISSING", "A required record field is missing.");
  } else {
    arity(exp.args, fields.length + 1);
    requireType(exp.args[0]!.type, input.type);
  }
  fields.forEach((key, i) => {
    const field = schema.fields[key]!;
    if (exp.operator === "record.update" && field.writable === false)
      fail("RECORD_READONLY", "This field is read only.");
    requireType(
      exp.args[i + (exp.operator === "record.update" ? 1 : 0)]!.type,
      field.type,
    );
  });
  return input.type;
}
function clone(value: JsonValue): JsonValue {
  return structuredClone(value);
}
function mergeProvenance(values: EvaluatedValue[]): Provenance[] {
  const seen = new Set<string>();
  return values
    .flatMap((value) => value.provenance)
    .filter((provenance) => {
      const key = JSON.stringify(provenance);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function canonicalKey(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(",")}]`;
  if (plainObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalKey(value[key]!)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function text(value: JsonValue): string {
  if (typeof value !== "string") fail("TYPE", "A text value is required.");
  return value;
}
function list(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) fail("TYPE", "A typed list is required.");
  return value;
}
function condition(value: JsonValue): ConditionResult {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === "true" || value === "false" || value === "unknown")
    return value;
  return fail("CONDITION", "A valid condition is required.");
}
export function combineConditions(
  operator: "and" | "or" | "not",
  left: ConditionResult,
  right?: ConditionResult,
): ConditionResult {
  if (operator === "not")
    return left === "unknown" ? "unknown" : left === "true" ? "false" : "true";
  if (operator === "and")
    return left === "false" || right === "false"
      ? "false"
      : left === "unknown" || right === "unknown"
        ? "unknown"
        : "true";
  return left === "true" || right === "true"
    ? "true"
    : left === "unknown" || right === "unknown"
      ? "unknown"
      : "false";
}
/** No clock, network, random source or arbitrary code is reachable through this evaluator. */
export function evaluateValue(
  input: ValueInput,
  context: EvaluationContext,
): EvaluatedValue {
  validateValueInput(input, context);
  const limits = automationLimits(context.limits),
    budget = context.budget ?? { evaluations: 0 };
  const evaluate = (
    current: ValueInput,
    env: EvaluationContext,
    depth = 0,
  ): EvaluatedValue => {
    if (
      ++budget.evaluations > limits.maxEvaluations ||
      depth > limits.maxExpressionDepth
    )
      fail(
        "EVALUATION_BUDGET",
        "The expression evaluation budget is exhausted.",
      );
    if (current.kind === "missing")
      return fail(
        "MISSING_INPUT",
        "Enter a value, or choose a variable or calculation.",
      );
    if (current.kind === "literal")
      return {
        type: current.type,
        value: clone(current.value),
        provenance: [{ source: "literal", resumable: true }],
      };
    if (current.kind === "variable") {
      const value = env.variables[current.variableId];
      if (!value)
        fail("UNINITIALIZED", "This variable has not been initialized.");
      assertValueMatchesType(value.type, value.value, env);
      assertResultEvidence(value.type, value.value, value.provenance, env);
      return { ...value, value: clone(value.value) };
    }
    const exp = current.expression,
      used: EvaluatedValue[] = [];
    const get = (i: number): JsonValue => {
      const argument = exp.args[i];
      if (!argument) fail("ARGUMENTS", "An expression input is missing.");
      const evaluated = evaluate(argument, env, depth + 1);
      used.push(evaluated);
      return evaluated.value;
    };
    const all = () => exp.args.map((_arg, i) => get(i));
    let result: JsonValue;
    if (
      exp.operator === "condition.and" ||
      exp.operator === "condition.or" ||
      exp.operator === "condition.not"
    ) {
      const first = condition(get(0));
      const operation = exp.operator.slice(10) as "and" | "or" | "not";
      const value =
        operation === "not"
          ? combineConditions(operation, first)
          : operation === "and" && first === "false"
            ? "false"
            : operation === "or" && first === "true"
              ? "true"
              : combineConditions(operation, first, condition(get(1)));
      result = current.type === "Boolean" ? value === "true" : value;
    } else if (exp.operator === "value.choose") {
      const value = condition(get(0));
      result = get(value === "true" ? 1 : value === "false" ? 2 : 3);
    } else if (exp.operator === "value.lookup") {
      const sought = stableListKey(get(0)), keys = list(get(1));
      budget.evaluations += keys.length;
      if (budget.evaluations > limits.maxEvaluations)
        fail("EVALUATION_BUDGET", "The expression evaluation budget is exhausted.");
      const index = keys.findIndex(key => stableListKey(key) === sought);
      result = get(index < 0 ? 2 : index + 3);
    } else if (exp.operator === "value.parse") {
      const type = current.type as Extract<ValueType, {kind:"ParseResult"}>;
      result = parseRegisteredValue(type.value, text(get(0)), exp.options!.conversion!);
    } else if (exp.operator === "optional.default") {
      const value = get(0);
      if (!plainObject(value))
        fail("OPTIONAL", "An optional value is required.");
      result = value.state === "set" ? value.value! : get(1);
    } else if (exp.operator === "pure.call") {
      const definition = env.pureDefinitions!.find(
        (def) =>
          def.id === exp.options?.definitionId &&
          def.revision === exp.options?.revision,
      )!;
      const args = all(),
        variables: Record<string, EvaluatedValue> = {};
      definition.inputs.forEach((parameter, i) => {
        variables[parameter.id] = {
          type: parameter.type,
          value: args[i]!,
          provenance: used[i]!.provenance,
        };
      });
      const returned = evaluate(
        definition.value,
        { ...env, variables },
        depth + 1,
      );
      used.push(returned);
      result = returned.value;
    } else if (
      ["list.map", "list.filter", "list.any", "list.all", "list.find", "list.findResult"].includes(
        exp.operator,
      )
    ) {
      const items = list(get(0)),
        element = listType(exp.args[0]!.type),
        id = exp.options!.bindingId!,
        body = exp.options!.body!;
      const outputs: JsonValue[] = [];
      let matched: JsonValue | undefined;
      let allMatch = true;
      for (const [index, item] of items.entries()) {
        const value = evaluate(
          body,
          {
            ...env,
            variables: {
              ...env.variables,
              [id]: {
                type: element,
                value: item,
                provenance: used[0]!.provenance,
              },
            },
          },
          depth + 1,
        );
        used.push(value);
        if (exp.operator === "list.map") outputs.push(value.value);
        else if (value.value === true) {
          outputs.push(item);
          if (exp.operator === "list.find" || exp.operator === "list.findResult") {
            matched = exp.operator === "list.findResult" ? { item, position: index + 1 } : item;
            break;
          }
          if (exp.operator === "list.any") break;
        } else if (exp.operator === "list.all") {
          allMatch = false;
          break;
        }
      }
      result =
        exp.operator === "list.map" || exp.operator === "list.filter"
          ? outputs
          : exp.operator === "list.any"
            ? outputs.length > 0
            : exp.operator === "list.all"
              ? allMatch
              : matched === undefined
                ? { state: "unset" }
                : { state: "set", value: matched };
    } else result = evaluateOperation(exp, all(), env, limits);
    assertValueMatchesType(current.type, result, env);
    if (
      new TextEncoder().encode(JSON.stringify(result)).byteLength >
      limits.maxValueBytes
    )
      fail("VALUE_BYTES", "The result exceeds the value-size budget.");
    return {
      type: current.type,
      value: result,
      provenance: [
        ...mergeProvenance(used),
        { source: "expression", resumable: true },
        ...(exp.operator === "value.parse" ? [{ source: "expression" as const, resumable: true, evidence: "parse" as const }] : []),
      ],
    };
  };
  return evaluate(input, { ...context, budget });
}
function evaluateOperation(
  exp: Expression,
  args: JsonValue[],
  context: EvaluationContext,
  limits: AutomationLimits,
): JsonValue {
  const a = args[0]!,
    b = args[1]!,
    c = args[2]!,
    op = exp.operator;
  if (isTemporalOperator(op))
    return evaluateTemporalOperator(op, args, exp.args.map((argument) => argument.type));
  if (op === "rich.text") return [{ kind: "text", text: text(a) }];
  if (op === "rich.join") return args.flatMap(list);
  if (op === "rich.wrap") {
    const format = exp.options!.format!,
      children = list(a);
    return format.startsWith("heading")
      ? [{ kind: "heading", level: Number(format.slice(-1)), children }]
      : [{ kind: format, children }];
  }
  if (op === "embed.build")
    return {
      title: escapeMarkdown(text(a)),
      description: escapeMarkdown(text(b)),
    };
  if (op === "message.legacy")
    return { kind: "legacy", richText: list(a), embeds: list(b) };
  if (op.startsWith("number.")) {
    const x = assertFiniteNumber(a),
      y = args.length > 1 ? assertFiniteNumber(b) : 0;
    let value: number;
    switch (op) {
      case "number.add":
        value = x + y;
        break;
      case "number.subtract":
        value = x - y;
        break;
      case "number.multiply":
        value = x * y;
        break;
      case "number.divide":
        if (y === 0) fail("DIVIDE_BY_ZERO", "You cannot divide by zero.");
        value = x / y;
        break;
      case "number.remainder":
        if (y === 0) fail("DIVIDE_BY_ZERO", "You cannot divide by zero.");
        value = x % y;
        break;
      case "number.min":
        value = Math.min(x, y);
        break;
      case "number.max":
        value = Math.max(x, y);
        break;
      case "number.abs":
        value = Math.abs(x);
        break;
      case "number.clamp":
        if (y > assertFiniteNumber(c))
          fail(
            "CLAMP_RANGE",
            "The lower bound is greater than the upper bound.",
          );
        value = Math.max(y, Math.min(assertFiniteNumber(c), x));
        break;
      default: {
        const factor = 10 ** (exp.options?.digits ?? 0),
          scaled = x * factor;
        value =
          (op === "number.floor"
            ? Math.floor(scaled)
            : op === "number.ceil"
              ? Math.ceil(scaled)
              : Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5)) /
          factor;
      }
    }
    return assertFiniteNumber(value);
  }
  if (comparisons.has(op)) {
    const equal = canonicalKey(a) === canonicalKey(b);
    if (op === "compare.equal") return equal;
    if (op === "compare.notEqual") return !equal;
    const x = typeof a === "number" ? a : text(a),
      y = typeof b === "number" ? b : text(b);
    return op === "compare.less"
      ? x < y
      : op === "compare.lessOrEqual"
        ? x <= y
        : op === "compare.greater"
          ? x > y
          : x >= y;
  }
  if (op.startsWith("text.")) {
    if (op === "text.join") return args.map(text).join("");
    if (op === "text.joinList") return list(a).map(text).join(text(b));
    const source = text(a);
    switch (op) {
      case "text.length":
        return Array.from(source).length;
      case "text.contains":
        return source.includes(text(b));
      case "text.startsWith":
        return source.startsWith(text(b));
      case "text.endsWith":
        return source.endsWith(text(b));
      case "text.trim":
        return source.trim();
      case "text.upper":
        return source.toUpperCase();
      case "text.lower":
        return source.toLowerCase();
      case "text.slice": {
        const chars = Array.from(source),
          start = assertCount(b, chars.length + 1, false),
          count = assertCount(c, chars.length);
        if (start - 1 + count > chars.length)
          fail("TEXT_RANGE", "The selected text range is outside the text.");
        return chars.slice(start - 1, start - 1 + count).join("");
      }
      case "text.repeat": {
        const count = assertCount(b, limits.maxListItems);
        if (Array.from(source).length * count > limits.maxTextLength)
          fail("TEXT_SIZE", "The repeated text exceeds its budget.");
        return source.repeat(count);
      }
      case "text.split":
        if (text(b) === "")
          fail("EMPTY_SEPARATOR", "Choose a non-empty separator.");
        return source.split(text(b));
      case "text.replace":
        if (text(b) === "")
          fail("EMPTY_SEARCH", "Choose non-empty search text.");
        return source.split(text(b)).join(text(c));
    }
  }
  if (op === "list.range") {
    const start = assertFiniteNumber(a),
      end = assertFiniteNumber(b),
      step = assertFiniteNumber(c);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(step) ||
      step === 0 ||
      (end - start) * step < 0
    )
      fail(
        "INTEGER_RANGE",
        "Choose finite integers and a nonzero step toward the end.",
      );
    const count = Math.floor((end - start) / step) + 1;
    assertCount(count, limits.maxListItems);
    return Array.from({ length: count }, (_, i) => start + i * step);
  }
  if (op === "list.build") return args;
  if (op.startsWith("list.")) {
    const items = list(a),
      key = (item: JsonValue) => {
        if (exp.options?.key) {
          if (!plainObject(item) || !Object.hasOwn(item, exp.options.key))
            fail("COMPARISON_KEY", "A required comparison field is missing.");
          return item[exp.options.key]!;
        }
        return item;
      };
    const unique = (values: JsonValue[]) => {
      const keys = new Set<string>();
      return values.filter((item) => {
        const id = canonicalKey(key(item));
        if (keys.has(id)) return false;
        keys.add(id);
        return true;
      });
    };
    switch (op) {
      case "list.length":
        return items.length;
      case "list.append":
        return [...items, b];
      case "list.item":
        return clone(items[assertCount(b, items.length, false) - 1]!);
      case "list.remove": {
        const index = assertCount(b, items.length, false) - 1;
        return items.filter((_item, i) => i !== index);
      }
      case "list.insert": {
        const index = assertCount(b, items.length + 1, false) - 1;
        return [...items.slice(0, index), c, ...items.slice(index)];
      }
      case "list.replace": {
        const index = assertCount(b, items.length, false) - 1;
        return items.map((item, i) => (i === index ? c : item));
      }
      case "list.slice": {
        const start = assertCount(b, items.length + 1, false) - 1,
          count = assertCount(c, items.length);
        if (start + count > items.length)
          fail("LIST_RANGE", "The selected range is outside the list.");
        return items.slice(start, start + count);
      }
      case "list.concat":
        return [...items, ...list(b)];
      case "list.unique":
        return unique(items);
      case "list.sort": {
        const descending = exp.options?.descending ? -1 : 1;
        return items
          .map((item, index) => ({ item, index }))
          .sort((x, y) => {
            const first = key(x.item),
              second = key(y.item);
            if (
              (typeof first !== "number" && typeof first !== "string") ||
              typeof first !== typeof second
            )
              fail(
                "COMPARISON_KEY",
                "The comparison key has no registered ordering.",
              );
            const order =
              typeof first === "number" && typeof second === "number"
                ? first < second
                  ? -1
                  : first > second
                    ? 1
                    : 0
                : String(first) < String(second)
                  ? -1
                  : String(first) > String(second)
                    ? 1
                    : 0;
            return order * descending || x.index - y.index;
          })
          .map((item) => item.item);
      }
      case "list.sum":
        return assertFiniteNumber(
          items.reduce<number>(
            (sum, item) => assertFiniteNumber(sum + assertFiniteNumber(item)),
            0,
          ),
        );
      case "list.average":
        return {
          value: items.length
            ? {
                state: "set",
                value: assertFiniteNumber(
                  items.reduce<number>(
                    (sum, item) =>
                      assertFiniteNumber(sum + assertFiniteNumber(item)),
                    0,
                  ) / items.length,
                ),
              }
            : { state: "unset" },
          count: items.length,
        };
      case "list.minMax": {
        context.budget!.evaluations += items.length;
        if (context.budget!.evaluations > limits.maxEvaluations)
          fail("EVALUATION_BUDGET", "The expression evaluation budget is exhausted.");
        const values = items.map(assertFiniteNumber);
        return {
          minimum: values.length ? { state: "set", value: Math.min(...values) } : { state: "unset" },
          maximum: values.length ? { state: "set", value: Math.max(...values) } : { state: "unset" },
        };
      }
      case "list.min":
      case "list.max":
        return items.length
          ? {
              state: "set",
              value: (op === "list.min" ? Math.min : Math.max)(
                ...items.map(assertFiniteNumber),
              ),
            }
          : { state: "unset" };
      case "list.intersection":
      case "list.difference": {
        const other = new Set(list(b).map((item) => canonicalKey(key(item))));
        return unique(
          items.filter(
            (item) =>
              other.has(canonicalKey(key(item))) ===
              (op === "list.intersection"),
          ),
        );
      }
      case "list.union":
        return unique([...items, ...list(b)]);
      case "list.group": {
        const groups: { key: JsonValue; items: JsonValue[] }[] = [], indices = new Map<string, number>();
        context.budget!.evaluations += items.length;
        if (context.budget!.evaluations > limits.maxEvaluations)
          fail("EVALUATION_BUDGET", "The expression evaluation budget is exhausted.");
        for (const item of items) {
          const groupingKey = key(item), stable = stableListKey(groupingKey), index = indices.get(stable);
          if (index === undefined) { indices.set(stable, groups.length); groups.push({ key: groupingKey, items: [item] }); }
          else groups[index]!.items.push(item);
        }
        return groups;
      }
      case "list.zip": {
        const other = list(b);
        if (items.length !== other.length)
          fail(
            "ZIP_LENGTH",
            "The two lists must contain the same number of items.",
          );
        // The shared expression counter charges every produced pair; neither
        // zip nor a nested caller receives a fresh evaluation budget.
        const budget = context.budget!;
        budget.evaluations += items.length;
        if (budget.evaluations > limits.maxEvaluations)
          fail(
            "EVALUATION_BUDGET",
            "The expression evaluation budget is exhausted.",
          );
        return items.map((item, index) => ({
          first: item,
          second: other[index]!,
        }));
      }
      case "list.chunk": {
        const count = assertCount(b, limits.maxListItems, false),
          result: JsonValue[] = [];
        for (let i = 0; i < items.length; i += count)
          result.push(items.slice(i, i + count));
        return result;
      }
    }
  }
  if (op === "record.field") {
    if (!plainObject(a) || !Object.hasOwn(a, exp.options!.key!))
      fail("RECORD_FIELD", "The record field is not set.");
    return a[exp.options!.key!]!;
  }
  if (op === "record.build" || op === "record.update") {
    const fields = exp.options?.fields ?? [],
      result: { [key: string]: JsonValue } =
        op === "record.update" && plainObject(a) ? structuredClone(a) : {};
    fields.forEach((field, i) => {
      result[field] = args[i + (op === "record.update" ? 1 : 0)]!;
    });
    return result;
  }
  if (op === "duration.build")
    return assertFiniteNumber(
      assertFiniteNumber(a) *
        { seconds: 1, minutes: 60, hours: 3600, days: 86400 }[
          exp.options!.unit!
        ],
    );
  if (op === "date.compose") {
    const year = assertCount(a, 9999, false),
      month = assertCount(b, 12, false),
      day = assertCount(c, 31, false);
    return parseDateOnly(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  if (op === "date.addDays")
    return addCalendarDays(text(a), assertFiniteNumber(b));
  if (op === "date.weekday")
    return new Date(`${text(a)}T00:00:00Z`).getUTCDay();
  if (op === "instant.add")
    return elapsedRelativeInstant(text(a), assertFiniteNumber(b));
  if (op === "instant.difference")
    return (
      (Date.parse(parseInstant(text(a))) - Date.parse(parseInstant(text(b)))) /
      1000
    );
  void context;
  return fail("OPERATOR", "This expression operation is not registered.");
}
