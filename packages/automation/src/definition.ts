import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTION_DEFINITIONS } from "./catalog";
import {
  AutomationValueError,
  automationLimits,
  EXPRESSION_OPERATORS,
  evaluateValue,
  typeEquals,
  validateValueInput,
} from "./expression";
import { resolveZonedDateTime, validateRecurrence } from "./datetime";
import {validateElapsedSchedule} from './elapsed-schedule';
import {iterationList,iterationResultType} from './iteration-results';
import { validateEventTriggerInputs } from "./event-contract";
import { RUN_STARTED_AT_ID, runBuiltinDeclarations } from "./builtins";
import { isUncertaintySafe } from "./results";
import { MAX_WAIT_SECONDS } from "./types";
import type {
  ActionOperation,
  AutomationLimits,
  CanonicalNode,
  EvaluatedValue,
  ExecutionPlan,
  ExpressionOperator,
  FlowDefinition,
  JsonValue,
  RecordSchema,
  Statement,
  ValidationIssue,
  ValidationResult,
  ValueInput,
  ValueType,
  VariableDeclaration,
} from "./types";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  snowflake = z.string().regex(/^\d{5,30}$/);
const label = z.string().min(1).max(100);
const atomic = z.enum([
  "Number",
  "Boolean",
  "PlainText",
  "RichText",
  "RichTextSpec",
  "EmbedSpec",
  "LegacyMessageSpec",
  "Instant",
  "Duration",
  "DateOnly",
  "LocalTime",
  "TimeZone",
  "ZonedDateTimeSpec",
  "DateRange",
  "InstantRange",
  "ConditionResult",
  "ChannelRef",
  "RoleRef",
  "MemberRef",
  "ThreadRef",
  "MessageRef",
  "TicketRef",
  "EventRef",
]);
const typeSchema: z.ZodType<ValueType> = z.lazy(() =>
  z.union([
    atomic,
    z.object({ kind: z.literal("List"), element: typeSchema }).strict(),
    z.object({ kind: z.literal("Optional"), value: typeSchema }).strict(),
    z.object({ kind: z.literal("ParseResult"), value: typeSchema }).strict(),
    z.object({ kind: z.literal("OperationOutcome"), value: typeSchema }).strict(),
    z
      .object({
        kind: z.literal("Enum"),
        values: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(100)
          .refine((values) => new Set(values).size === values.length),
      })
      .strict(),
    z.object({ kind: z.literal("Record"), schemaId: id, typeArgs: z.array(typeSchema).min(1).max(2).optional() }).strict(),
  ]),
);
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(
      z
        .string()
        .refine(
          (key) => !["__proto__", "prototype", "constructor"].includes(key),
        ),
      jsonSchema,
    ),
  ]),
);
const declaration = z
  .object({
    id,
    name: label,
    type: typeSchema,
    description: z.string().max(500).optional(),
  })
  .strict();
const valueSchema: z.ZodType<ValueInput> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("missing"), type: typeSchema }).strict(),
    z
      .object({
        kind: z.literal("literal"),
        type: typeSchema,
        value: jsonSchema,
      })
      .strict(),
    z
      .object({ kind: z.literal("variable"), type: typeSchema, variableId: id })
      .strict(),
    z
      .object({
        kind: z.literal("expression"),
        type: typeSchema,
        expression: z
          .object({
            operator: z.enum(
              EXPRESSION_OPERATORS as [
                ExpressionOperator,
                ...ExpressionOperator[],
              ],
            ),
            args: z.array(valueSchema).max(128),
            options: z
              .object({
                digits: z.number().int().optional(),
                key: id.optional(),
                fields: z.array(id).optional(),
                bindingId: id.optional(),
                body: valueSchema.optional(),
                definitionId: id.optional(),
                revision: z.number().int().positive().optional(),
                unit: z
                  .enum(["seconds", "minutes", "hours", "days"])
                  .optional(),
                descending: z.boolean().optional(),
                conversion: z.enum(["decimal", "dateSlash", "enum"]).optional(),
                format: z
                  .enum([
                    "bold",
                    "italic",
                    "underline",
                    "strike",
                    "spoiler",
                    "quote",
                    "heading1",
                    "heading2",
                    "heading3",
                  ])
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      })
      .strict(),
  ]),
);
const valueMap = z.record(id, valueSchema),
  declarationMap = z.record(id, declaration),
  base = { id, enabled: z.boolean().optional() };
const statementSchema: z.ZodType<Statement> = z.lazy(() =>
  z.union([
    z
      .object({
        ...base,
        kind: z.literal("declare"),
        variable: declaration,
        value: valueSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("assign"),
        variableId: id,
        value: valueSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("branch"),
        condition: valueSchema,
        then: z.array(statementSchema),
        otherwise: z.array(statementSchema),
        unknown: z.array(statementSchema),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("switch"),
        value: valueSchema,
        cases: z
          .array(
            z
              .object({ value: z.string(), body: z.array(statementSchema) })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    z.object({ ...base, kind: z.literal("resultBranch"), value: valueSchema, output: declaration, reason: declaration.optional(), succeeded: z.array(statementSchema), failed: z.array(statementSchema), notStarted: z.array(statementSchema), unknown: z.array(statementSchema) }).strict(),
    z.object({ ...base, kind: z.literal("optionalBranch"), value: valueSchema, output: declaration, present: z.array(statementSchema), unset: z.array(statementSchema) }).strict(),
    z
      .object({
        ...base,
        kind: z.literal("repeat"),
        count: valueSchema.optional(),
        list: valueSchema.optional(),
        itemVariable: declaration,
        indexVariable: declaration.optional(),
        body: z.array(statementSchema),
        results:z.array(z.object({output:declaration,value:valueSchema}).strict()).max(8).optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("wait"),
        duration: valueSchema.optional(),
        until: valueSchema.optional(),
      })
      .strict(),
    z.object({
      ...base,
      kind: z.literal("poll"),
      ticket: valueSchema,
      maxAttempts: valueSchema,
      interval: valueSchema,
      until: valueSchema,
      output: declaration,
      condition: valueSchema,
      matched: z.array(statementSchema),
      exhausted: z.array(statementSchema),
      timedOut: z.array(statementSchema),
    }).strict(),
    z.object({
      ...base, kind: z.literal("awaitEvent"), ticket: valueSchema,
      event: z.literal("ticketUpdated"),
      states: z.array(z.enum(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "SNOOZED", "RESOLVED", "DISMISSED"])).min(1).max(6).refine(values => new Set(values).size === values.length),
      until: valueSchema, output: declaration,
      matched: z.array(statementSchema), timedOut: z.array(statementSchema),
    }).strict(),
    z
      .object({
        ...base,
        kind: z.literal("random"),
        mode: z.enum(["integer", "sample", "shuffle"]),
        output: declaration,
        min: valueSchema.optional(),
        max: valueSchema.optional(),
        list: valueSchema.optional(),
        count: valueSchema.optional(),
      })
      .strict(),
    z
      .object({ ...base, kind: z.literal("readClock"), output: declaration })
      .strict(),
    z.object({...base,kind:z.literal('approval'),actionId:id,until:valueSchema,approved:z.array(statementSchema),rejected:z.array(statementSchema),expired:z.array(statementSchema)}).strict(),
    z
      .object({
        ...base,
        kind: z.literal("action"),
        operation: z.enum(
          Object.keys(ACTION_DEFINITIONS) as [
            ActionOperation,
            ...ActionOperation[],
          ],
        ),
        inputs: valueMap,
        output: declaration.optional(),
        outcome: declaration.optional(),
        approvalRequired: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal("call"),
        procedureId: id,
        revision: z.number().int().positive(),
        args: valueMap,
        outputs: declarationMap,
      })
      .strict(),
    z.object({ ...base, kind: z.literal("return"), values: valueMap }).strict(),
    z
      .object({
        ...base,
        kind: z.literal("parallel"),
        branches: z
          .array(
            z
              .object({
                id,
                name: label,
                body: z.array(statementSchema),
                outputs: valueMap.optional(),
              })
              .strict(),
          )
          .min(1),
        outputs: z
          .record(id, z.object({ branchId: id, outputId: id }).strict())
          .optional(),
      })
      .strict(),
    z.object({ ...base, kind: z.enum(["break", "continue"]) }).strict(),
    z
      .object({
        ...base,
        kind: z.literal("end"),
        reason: z.string().max(500).optional(),
      })
      .strict(),
  ]),
);
const zonedSchema = z
  .object({
    date: z.string(),
    time: z.string(),
    timeZone: z.string(),
    occurrence: z.enum(["earlier", "later"]).optional(),
  })
  .strict();
const recurrenceSchema = z
  .object({
    kind: z.literal("recurring"),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    time: z.string(),
    timeZone: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    weekdays: z.array(z.number().int()).optional(),
    monthDay: z.union([z.number().int(), z.literal("last")]).optional(),
    missingTime: z.literal("skip"),
    repeatedTime: z.literal("earlier"),
    pastOccurrences: z.literal("skip"),
  })
  .strict();
const triggerSchema = z.union([
  z
    .object({ kind: z.literal("manual"), inputs: z.array(declaration) })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      schedule: z.union([
        recurrenceSchema,
        z.object({kind:z.literal('elapsed'),anchor:z.string(),intervalSeconds:z.number().int().positive().safe(),end:z.string(),pastOccurrences:z.literal('skip')}).strict(),
        z.object({ kind: z.literal("once"), at: zonedSchema }).strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("internal"),
      event: z.enum(["ticketCreated", "ticketUpdated"]),
      inputs: z.array(declaration),
    })
    .strict(),
  z
    .object({ kind: z.literal("interaction"), inputs: z.array(declaration) })
    .strict(),
  z
    .object({
      kind: z.literal("messageMetadata"),
      channelIds: z.array(snowflake).min(1).max(100),
      excludeBots: z.literal(true),
      inputs: z.array(declaration),
    })
    .strict(),
]);
/** Strict parsing prevents unknown commands and client-provided authority fields from surviving save. */
export const flowDefinitionSchema: z.ZodType<FlowDefinition> = z
  .object({
    schemaVersion: z.literal(1),
    id,
    guildId: snowflake,
    name: label,
    trigger: triggerSchema,
    variables: z.array(declaration),
    body: z.array(statementSchema),
    targets: z
      .object({
        channelIds: z.array(snowflake).max(100),
        roleIds: z.array(snowflake).max(100),
        parentCategoryIds: z.array(snowflake).max(100),
      })
      .strict()
      .optional(),
    procedures: z
      .array(
        z
          .object({
            id,
            revision: z.number().int().positive(),
            name: label,
            inputs: z.array(declaration),
            outputs: z.array(declaration),
            body: z.array(statementSchema),
          })
          .strict(),
      )
      .optional(),
    pureDefinitions: z
      .array(
        z
          .object({
            id,
            revision: z.number().int().positive(),
            name: label,
            inputs: z.array(declaration),
            outputType: typeSchema,
            value: valueSchema,
          })
          .strict(),
      )
      .optional(),
    detached: z.array(statementSchema).optional(),
    ui: z
      .object({
        collapsed: z.array(id).optional(),
        selectedId: id.optional(),
        positions: z
          .record(
            id,
            z
              .object({ x: z.number().finite(), y: z.number().finite() })
              .strict(),
          )
          .optional(),
        view: z.enum(["blocks", "steps"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export interface ValidateFlowOptions {
  limits?: Partial<AutomationLimits>;
  recordSchemas?: Record<string, RecordSchema>;
}
export class AutomationDefinitionError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "This automation definition is invalid.");
    this.name = "AutomationDefinitionError";
  }
}
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** IDs, argument order, branch names and execution order remain significant. */
export function canonicalDefinition(definition: FlowDefinition): JsonValue {
  const result = structuredClone(definition);
  delete result.ui;
  delete result.detached;
  // Do not generically remove keys named "name": action inputs and literal records can use them.
  return result as unknown as JsonValue;
}
export function semanticHash(definition: FlowDefinition): string {
  return createHash("sha256")
    .update(sortedJson(canonicalDefinition(definition)))
    .digest("hex");
}
type Scope = Map<
  string,
  { declaration: VariableDeclaration; writable: boolean }
>;
interface WalkState {
  loopDepth: number;
  parallelDepth: number;
  procedure?: FlowDefinition["procedures"] extends (infer T)[] | undefined
    ? T
    : never;
  callPath: string[];
  depth: number;
  uncertaintyHandler?: boolean;
}
export function validateFlowDefinition(
  input: unknown,
  options: ValidateFlowOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (
    code: string,
    path: string,
    message: string,
    severity: ValidationIssue["severity"] = "error",
  ) => issues.push({ code, path, message, severity });
  let limits: AutomationLimits;
  try {
    limits = automationLimits(options.limits);
    const bytes = Buffer.byteLength(JSON.stringify(input) ?? "");
    if (bytes > limits.maxDefinitionBytes) {
      issue(
        "DEFINITION_BYTES",
        "",
        "This definition exceeds the permitted size.",
      );
      return { valid: false, complete: false, issues };
    }
  } catch {
    issue(
      "DEFINITION_INVALID",
      "",
      "A finite, serializable definition and valid server limits are required.",
    );
    return { valid: false, complete: false, issues };
  }
  const excessiveDepth = (value: unknown, depth = 0): boolean =>
    depth > Math.max(32, limits.maxNesting * 5) ||
    (value !== null &&
      typeof value === "object" &&
      Object.values(value).some((child) => excessiveDepth(child, depth + 1)));
  if (excessiveDepth(input)) {
    issue("DEFINITION_DEPTH", "", "This definition is too deeply nested.");
    return { valid: false, complete: false, issues };
  }
  const parsed = flowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    for (const error of parsed.error.issues.slice(0, 50))
      issue(
        "SCHEMA",
        error.path.join("."),
        "This field has an invalid type or an unregistered value.",
      );
    return { valid: false, complete: false, issues };
  }
  const definition = parsed.data,
    nodes: CanonicalNode[] = [],
    nodeIds = new Set<string>(),
    variableIds = new Set<string>();
  const typeDepth=(type:ValueType,depth=0):boolean=>depth>limits.maxNesting||typeof type==='object'&&(type.kind==='List'?typeDepth(type.element,depth+1):type.kind==='Optional'||type.kind==='ParseResult'||type.kind==='OperationOutcome'?typeDepth(type.value,depth+1):type.kind==='Record'?(type.typeArgs??[]).some(arg=>typeDepth(arg,depth+1)):false);
  const scanTypes=(entry:unknown,path=''):void=>{
    if(Array.isArray(entry)){entry.forEach((item,index)=>scanTypes(item,`${path}.${index}`));return;}
    if(!entry||typeof entry!=='object')return;
    const object=entry as Record<string,unknown>;
    if(Object.hasOwn(object,'type')&&(['literal','variable','missing','expression'].includes(String(object.kind))||typeof object.id==='string'&&typeof object.name==='string')&&typeDepth(object.type as ValueType))issue('TYPE_DEPTH',path,'This value type exceeds the shared nesting budget.');
    for(const [key,value] of Object.entries(object))scanTypes(value,path?`${path}.${key}`:key);
  };scanTypes(definition);
  let statements = 0;
  const scopeValues = (scope: Scope): Record<string, EvaluatedValue> =>
    Object.fromEntries(
      [...scope].map(([key, entry]) => [
        key,
        { type: entry.declaration.type, value: null, provenance: [] },
      ]),
    ) as Record<string, EvaluatedValue>;
  const value = (
    inputValue: ValueInput,
    scope: Scope,
    path: string,
    expected?: ValueType,
  ): void => {
    if (expected && !typeEquals(inputValue.type, expected))
      issue("TYPE", path, "Choose a value with the required type.");
    const missing = (item: ValueInput, p: string): void => {
      if (item.kind === "missing")
        issue(
          "MISSING_INPUT",
          p,
          "Enter a value, or choose a variable or calculation.",
          "missing",
        );
      else if (item.kind === "expression") {
        item.expression.args.forEach((child, i) =>
          missing(child, `${p}.expression.args.${i}`),
        );
        if (item.expression.options?.body)
          missing(item.expression.options.body, `${p}.expression.options.body`);
      }
    };
    missing(inputValue, path);
    try {
      validateValueInput(inputValue, {
        guildId: definition.guildId,
        variables: scopeValues(scope),
        limits,
        pureDefinitions: definition.pureDefinitions,
        recordSchemas: options.recordSchemas,
      });
      if (!containsVariableOrMissing(inputValue))
        evaluateValue(inputValue, {
          guildId: definition.guildId,
          variables: {},
          limits,
          pureDefinitions: definition.pureDefinitions,
          recordSchemas: options.recordSchemas,
        });
    } catch (error) {
      issue(
        error instanceof AutomationValueError ? error.code : "VALUE_INVALID",
        path,
        error instanceof Error ? error.message : "This value is invalid.",
      );
    }
  };
  const validateStoredInputs = (stored: unknown, path: string): void => {
    if (stored === null || typeof stored !== "object") return;
    if (
      "kind" in stored &&
      "type" in stored &&
      ["literal", "variable", "expression", "missing"].includes(
        String(stored.kind),
      )
    ) {
      const inputValue = stored as ValueInput,
        variables: Record<string, EvaluatedValue> = {};
      const refs = (entry: ValueInput): void => {
        if (entry.kind === "variable")
          variables[entry.variableId] = {
            type: entry.type,
            value: null,
            provenance: [],
          };
        else if (entry.kind === "expression") {
          entry.expression.args.forEach(refs);
          if (entry.expression.options?.body)
            refs(entry.expression.options.body);
        }
      };
      refs(inputValue);
      try {
        validateValueInput(inputValue, {
          guildId: definition.guildId,
          variables,
          limits,
          recordSchemas: options.recordSchemas,
          pureDefinitions: definition.pureDefinitions,
        });
      } catch (error) {
        issue(
          error instanceof AutomationValueError ? error.code : "VALUE_INVALID",
          path,
          error instanceof Error
            ? error.message
            : "This stored value is invalid.",
        );
      }
      return;
    }
    for (const [key, child] of Object.entries(stored))
      validateStoredInputs(child, `${path}.${key}`);
  };
  const addVariable = (
    scope: Scope,
    variable: VariableDeclaration,
    path: string,
    writable: boolean,
  ) => {
    if (variable.id === RUN_STARTED_AT_ID) {
      issue("VARIABLE_RESERVED", path, "This identifier is reserved for read-only Run metadata.");
      return;
    }
    if (variableIds.has(variable.id))
      issue(
        "VARIABLE_ID",
        path,
        "Each declaration needs a distinct stable identifier.",
      );
    variableIds.add(variable.id);
    if (scope.has(variable.id))
      issue(
        "VARIABLE_SCOPE",
        path,
        "This variable identifier is already in scope.",
      );
    scope.set(variable.id, { declaration: variable, writable });
    if (variableIds.size > limits.maxVariables)
      issue(
        "VARIABLE_BUDGET",
        path,
        "The combined variable budget is exceeded.",
      );
  };
  const rootScope: Scope = new Map();
  for (const variable of runBuiltinDeclarations())
    rootScope.set(variable.id, { declaration: variable, writable: false });
  if (!validateEventTriggerInputs(definition.trigger))
    issue(
      "EVENT_INPUT",
      "trigger.inputs",
      "Choose only registered metadata input identifiers with their exact declared types.",
    );
  definition.variables.forEach((variable, i) =>
    addVariable(rootScope, variable, `variables.${i}`, false),
  );
  if ("inputs" in definition.trigger)
    definition.trigger.inputs.forEach((variable, i) =>
      addVariable(rootScope, variable, `trigger.inputs.${i}`, false),
    );
  if (
    definition.trigger.kind === "messageMetadata" &&
    new Set(definition.trigger.channelIds).size !==
      definition.trigger.channelIds.length
  )
    issue("TRIGGER_CHANNELS", "trigger.channelIds", "Choose unique channels.");
  if (definition.targets)
    for (const [key, ids] of Object.entries(definition.targets))
      if (new Set(ids).size !== ids.length)
        issue(
          "TARGET_DUPLICATE",
          `targets.${key}`,
          "Choose unique operation targets.",
        );
  if (definition.trigger.kind === "schedule")
    try {
      const schedule = definition.trigger.schedule;
      if (schedule.kind === "once") resolveZonedDateTime(schedule.at);
      else if(schedule.kind==='elapsed')validateElapsedSchedule(schedule);
      else validateRecurrence(schedule);
    } catch (error) {
      issue(
        "SCHEDULE",
        "trigger.schedule",
        error instanceof Error ? error.message : "This schedule is invalid.",
      );
    }
  const procedureKeys = new Set<string>(),
    pureKeys = new Set<string>();
  for (const procedure of definition.procedures ?? []) {
    const key = `${procedure.id}@${procedure.revision}`;
    if (procedureKeys.has(key))
      issue(
        "PROCEDURE_ID",
        "procedures",
        "This procedure revision is duplicated.",
      );
    procedureKeys.add(key);
  }
  for (const pure of definition.pureDefinitions ?? []) {
    const key = `${pure.id}@${pure.revision}`;
    if (pureKeys.has(key))
      issue(
        "PURE_ID",
        "pureDefinitions",
        "This pure definition revision is duplicated.",
      );
    pureKeys.add(key);
  }
  const childBodies = (
    statement: Statement,
  ): { label: string; body: Statement[] }[] =>
    statement.kind === "branch"
      ? [
          { label: "then", body: statement.then },
          { label: "otherwise", body: statement.otherwise },
          { label: "unknown", body: statement.unknown },
        ]
      : statement.kind === "resultBranch"
        ? [{label:"succeeded",body:statement.succeeded},{label:"failed",body:statement.failed},{label:"notStarted",body:statement.notStarted},{label:"unknown",body:statement.unknown}]
      : statement.kind === "optionalBranch"
        ? [{label:"present",body:statement.present},{label:"unset",body:statement.unset}]
      : statement.kind === "approval"
        ? [{label:'approved',body:statement.approved},{label:'rejected',body:statement.rejected},{label:'expired',body:statement.expired}]
      : statement.kind === "switch"
        ? statement.cases.map((branch, i) => ({
            label: `cases.${i}.body`,
            body: branch.body,
          }))
        : statement.kind === "poll"
          ? [
              { label: "matched", body: statement.matched },
              { label: "exhausted", body: statement.exhausted },
              { label: "timedOut", body: statement.timedOut },
            ]
        : statement.kind === "awaitEvent"
          ? [{ label: "matched", body: statement.matched }, { label: "timedOut", body: statement.timedOut }]
        : statement.kind === "repeat"
          ? [{ label: "body", body: statement.body }]
          : statement.kind === "parallel"
            ? statement.branches.map((branch, i) => ({
                label: `branches.${i}.body`,
                body: branch.body,
              }))
            : [];
  const scan = (body: Statement[], path: string, parentId?: string): void => {
    for (const [index, statement] of body.entries()) {
      const p = `${path}.${index}`;
      statements++;
      if (nodeIds.has(statement.id))
        issue("BLOCK_ID", p, "Each block needs a distinct stable identifier.");
      nodeIds.add(statement.id);
      nodes.push({
        id: statement.id,
        kind: statement.kind,
        path: p,
        ...(parentId ? { parentId } : {}),
      });
      for (const child of childBodies(statement))
        scan(child.body, `${p}.${child.label}`, statement.id);
    }
  };
  scan(definition.body, "body");
  definition.procedures?.forEach((procedure, i) =>
    scan(procedure.body, `procedures.${i}.body`),
  );
  if (definition.detached) scan(definition.detached, "detached");
  if (statements > limits.maxStatements) {
    issue(
      "STATEMENT_BUDGET",
      "body",
      "The combined definition step budget is exceeded.",
    );
    return {
      valid: false,
      complete: false,
      issues,
      definition,
      semanticHash: semanticHash(definition),
    };
  }
  const checkProcedureDependencies = (
    identity: string,
    path: string[],
  ): void => {
    if (path.includes(identity)) {
      issue(
        "PROCEDURE_CYCLE",
        "procedures",
        "Recursive procedure dependencies are not permitted.",
      );
      return;
    }
    if (path.length >= limits.maxCallDepth) {
      issue(
        "PROCEDURE_DEPTH",
        "procedures",
        "The procedure dependency depth is exceeded.",
      );
      return;
    }
    const procedure = definition.procedures?.find(
      (proc) => `${proc.id}@${proc.revision}` === identity,
    );
    if (!procedure) return;
    const calls = (body: Statement[]): void => {
      for (const statement of body) {
        if (statement.kind === "call")
          checkProcedureDependencies(
            `${statement.procedureId}@${statement.revision}`,
            [...path, identity],
          );
        for (const child of childBodies(statement)) calls(child.body);
      }
    };
    calls(procedure.body);
  };
  for (const identity of procedureKeys)
    checkProcedureDependencies(identity, []);
  const walk = (
    body: Statement[],
    scope: Scope,
    path: string,
    state: WalkState,
    parentId?: string,
  ): { steps: number; actions: number } => {
    let steps = 0,
      actions = 0;
    if (state.depth > limits.maxNesting) {
      issue("NESTING", path, "The statement nesting limit is exceeded.");
      return { steps: limits.maxExpandedSteps + 1, actions: 0 };
    }
    for (const [index, statement] of body.entries()) {
      const p = `${path}.${index}`;
      void parentId;
      if (statement.enabled === false) {
        validateStoredInputs(statement, p);
        continue;
      }
      if (state.uncertaintyHandler && !isUncertaintySafe(statement))
        issue("UNCERTAINTY_EFFECT", p, "An unknown result permits only a bounded pure handler before the Run stops as UNKNOWN.");
      steps++;
      const child = (
        children: Statement[],
        label: string,
        childScope = new Map(scope),
        extra: Partial<WalkState> = {},
      ) =>
        walk(
          children,
          childScope,
          `${p}.${label}`,
          { ...state, depth: state.depth + 1, ...extra },
          statement.id,
        );
      const add = (
        estimate: { steps: number; actions: number },
        multiplier = 1,
      ) => {
        steps += estimate.steps * multiplier;
        actions += estimate.actions * multiplier;
      };
      switch (statement.kind) {
        case "declare":
          value(statement.value, scope, `${p}.value`, statement.variable.type);
          addVariable(scope, statement.variable, `${p}.variable`, true);
          break;
        case "assign": {
          const variable = scope.get(statement.variableId);
          if (!variable)
            issue("VARIABLE_SCOPE", p, "This variable is not available here.");
          else if (!variable.writable)
            issue(
              "VARIABLE_READONLY",
              p,
              "This input or inherited variable is read only.",
            );
          value(
            statement.value,
            scope,
            `${p}.value`,
            variable?.declaration.type,
          );
          break;
        }
        case "branch":
          value(statement.condition, scope, `${p}.condition`);
          if (
            statement.condition.type !== "Boolean" &&
            statement.condition.type !== "ConditionResult"
          )
            issue("CONDITION_TYPE", p, "Choose a Boolean or condition result.");
          add(child(statement.then, "then"));
          add(child(statement.otherwise, "otherwise"));
          add(child(statement.unknown, "unknown"));
          break;
        case "switch": {
          value(statement.value, scope, `${p}.value`);
          const type = statement.value.type,
            cases = statement.cases.map((branch) => branch.value);
          if (
            typeof type === "string" ||
            type.kind !== "Enum" ||
            cases.length !== type.values.length ||
            cases.some((choice) => !type.values.includes(choice)) ||
            new Set(cases).size !== cases.length
          )
            issue(
              "SWITCH_EXHAUSTIVE",
              p,
              "Provide exactly one branch for every registered choice.",
            );
          statement.cases.forEach((branch, i) =>
            add(child(branch.body, `cases.${i}.body`)),
          );
          break;
        }
        case "repeat": {
          if (Boolean(statement.count) === Boolean(statement.list))
            issue(
              "REPEAT_INPUT",
              p,
              "Choose either a repeat count or a typed list.",
            );
          let maximum = limits.maxListItems;
          const inner = new Map(scope);
          if (statement.count) {
            value(statement.count, scope, `${p}.count`, "Number");
            if (statement.itemVariable.type !== "Number")
              issue("TYPE", p, "A count loop needs a Number item variable.");
            if (statement.count.kind === "literal") {
              const count = statement.count.value;
              if (
                typeof count !== "number" ||
                !Number.isSafeInteger(count) ||
                count < 0 ||
                count > limits.maxListItems
              )
                issue(
                  "COUNT",
                  p,
                  "Choose a non-negative integer within the permitted range.",
                );
              else maximum = count;
            }
          }
          if (statement.list) {
            value(statement.list, scope, `${p}.list`);
            const type = statement.list.type;
            if (
              typeof type === "string" ||
              type.kind !== "List" ||
              !typeEquals(type.element, statement.itemVariable.type)
            )
              issue(
                "TYPE",
                p,
                "The loop item must match the list element type.",
              );
            if (
              statement.list.kind === "literal" &&
              Array.isArray(statement.list.value)
            )
              maximum = statement.list.value.length;
          }
          addVariable(
            inner,
            statement.itemVariable,
            `${p}.itemVariable`,
            false,
          );
          if (statement.indexVariable) {
            if (statement.indexVariable.type !== "Number")
              issue("TYPE", p, "The loop index must be a Number.");
            addVariable(
              inner,
              statement.indexVariable,
              `${p}.indexVariable`,
              false,
            );
          }
          add(
            child(statement.body, "body", inner, {
              loopDepth: state.loopDepth + 1,
            }),
            maximum,
          );
          for(const [resultIndex,result] of (statement.results??[]).entries()){
            value(result.value,inner,`${p}.results.${resultIndex}.value`);
            if(!typeEquals(result.output.type,{kind:'List',element:iterationResultType(result.value.type)}))issue('TYPE',`${p}.results.${resultIndex}.output`,'Choose the declared iteration result list type.');
            addVariable(scope,result.output,`${p}.results.${resultIndex}.output`,false);
          }
          if(statement.results?.length&&(statement.count?.kind==='literal'||statement.list?.kind==='literal')){
            const initial=Object.fromEntries(statement.results.map(result=>[result.output.id,iterationList(result.value.type,Math.max(0,Math.min(maximum,limits.maxListItems)),definition.guildId)]));
            if(Buffer.byteLength(JSON.stringify(initial))>limits.maxValueBytes)issue('ITERATION_RESULT_LIMIT',`${p}.results`,'The declared result lists exceed the execution-state budget. Reduce the item count or result declarations.');
          }
          break;
        }
        case "awaitEvent": {
          value(statement.ticket, scope, `${p}.ticket`, "TicketRef");
          if (statement.ticket.kind === "literal" &&
            (typeof statement.ticket.value !== "object" || statement.ticket.value === null || Array.isArray(statement.ticket.value) || typeof statement.ticket.value.id !== "string" || !/^intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(statement.ticket.value.id)))
            issue("AWAIT_TICKET", `${p}.ticket`, "Choose an existing structured intake ticket.");
          value(statement.until, scope, `${p}.until`, "Instant");
          const resultScope = new Map(scope);
          if (!typeEquals(statement.output.type, ACTION_DEFINITIONS["nexus.readTicket"].outputType!))
            issue("TYPE", `${p}.output`, "An event wait returns only the registered ticket state record.");
          addVariable(resultScope, statement.output, `${p}.output`, false);
          add(child(statement.matched, "matched", resultScope));
          add(child(statement.timedOut, "timedOut"));
          break;
        }
        case "poll": {
          value(statement.ticket, scope, `${p}.ticket`, "TicketRef");
          value(statement.maxAttempts, scope, `${p}.maxAttempts`, "Number");
          value(statement.interval, scope, `${p}.interval`, "Duration");
          value(statement.until, scope, `${p}.until`, "Instant");
          let maximum = limits.maxListItems;
          if (statement.maxAttempts.kind === "literal") {
            const count = statement.maxAttempts.value;
            if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > limits.maxListItems)
              issue("POLL_ATTEMPTS", `${p}.maxAttempts`, "Choose a positive bounded integer number of read attempts.");
            else maximum = count;
          }
          if (statement.interval.kind === "literal" &&
            (typeof statement.interval.value !== "number" || statement.interval.value <= 0 || statement.interval.value > MAX_WAIT_SECONDS))
            issue("POLL_INTERVAL", `${p}.interval`, "Choose a positive read interval within seven days.");
          const resultScope = new Map(scope);
          if (!typeEquals(statement.output.type, ACTION_DEFINITIONS["nexus.readTicket"].outputType!))
            issue("TYPE", `${p}.output`, "A ticket recheck returns only the registered ticket state record.");
          addVariable(resultScope, statement.output, `${p}.output`, false);
          value(statement.condition, resultScope, `${p}.condition`, "Boolean");
          steps += maximum - 1;
          add(child(statement.matched, "matched", new Map(resultScope)));
          add(child(statement.exhausted, "exhausted", new Map(resultScope)));
          add(child(statement.timedOut, "timedOut"));
          break;
        }
        case "wait":
          if (Boolean(statement.duration) === Boolean(statement.until))
            issue("WAIT_INPUT", p, "Choose a duration or an instant.");
          if (statement.duration) {
            value(statement.duration, scope, `${p}.duration`, "Duration");
            if (
              statement.duration.kind === "literal" &&
              (typeof statement.duration.value !== "number" ||
                statement.duration.value < 0 ||
                statement.duration.value > MAX_WAIT_SECONDS)
            )
              issue(
                "WAIT_LIMIT",
                p,
                "A single wait must be within seven days.",
              );
          }
          if (statement.until)
            value(statement.until, scope, `${p}.until`, "Instant");
          break;
        case "approval":{
          value(statement.until,scope,`${p}.until`,'Instant');
          const targetIndex=body.findIndex(candidate=>candidate.id===statement.actionId),target=body[targetIndex];
          if(targetIndex<=index||target?.enabled===false||target?.kind!=='action'||!['discord.addRole','discord.removeRole'].includes(target.operation))issue('APPROVAL_TARGET',`${p}.actionId`,'Choose a later ordinary role action in this sequence.');
          else for(const [key,input] of Object.entries(target.inputs))value(input,scope,`${p}.target.${key}`);
          if(body.filter(candidate=>candidate.enabled!==false&&candidate.kind==='approval'&&candidate.actionId===statement.actionId).length!==1)issue('APPROVAL_TARGET',p,'Each role action has at most one explicit approval wait.');
          for(const branch of ['approved','rejected','expired'] as const)add(child(statement[branch],branch));
          break;
        }
        case "readClock":
          if (statement.output.type !== "Instant")
            issue("TYPE", p, "The current-time output must be an Instant.");
          addVariable(scope, statement.output, `${p}.output`, false);
          break;
        case "random": {
          if (statement.mode === "integer") {
            if (
              !statement.min ||
              !statement.max ||
              statement.list ||
              statement.count
            )
              issue(
                "RANDOM_INPUT",
                p,
                "Choose integer lower and upper bounds.",
              );
            if (statement.min)
              value(statement.min, scope, `${p}.min`, "Number");
            if (statement.max)
              value(statement.max, scope, `${p}.max`, "Number");
            if (statement.output.type !== "Number")
              issue("TYPE", p, "Integer draws return a Number.");
            if (
              statement.min?.kind === "literal" &&
              statement.max?.kind === "literal"
            ) {
              const min = statement.min.value,
                max = statement.max.value;
              if (
                typeof min !== "number" ||
                typeof max !== "number" ||
                !Number.isSafeInteger(min) ||
                !Number.isSafeInteger(max) ||
                min > max
              )
                issue(
                  "RANDOM_RANGE",
                  p,
                  "Choose ordered finite integer bounds.",
                );
            }
          } else {
            if (!statement.list || statement.min || statement.max)
              issue("RANDOM_INPUT", p, "Choose a fixed typed candidate list.");
            if (statement.list) {
              value(statement.list, scope, `${p}.list`, statement.output.type);
              if (
                typeof statement.list.type === "string" ||
                statement.list.type.kind !== "List"
              )
                issue("TYPE", p, "Sampling and shuffling return a typed list.");
            }
            if (statement.mode === "sample") {
              if (!statement.count)
                issue("MISSING_INPUT", p, "Enter a sample count.", "missing");
              else {
                value(statement.count, scope, `${p}.count`, "Number");
                if (statement.count.kind === "literal") {
                  const n = statement.count.value;
                  if (
                    typeof n !== "number" ||
                    !Number.isSafeInteger(n) ||
                    n < 0 ||
                    n > limits.maxListItems
                  )
                    issue(
                      "COUNT",
                      p,
                      "Choose a non-negative integer sample count.",
                    );
                  else if (
                    statement.list?.kind === "literal" &&
                    Array.isArray(statement.list.value) &&
                    n > statement.list.value.length
                  )
                    issue(
                      "RANDOM_CANDIDATES",
                      p,
                      "There are fewer candidates than the requested count.",
                    );
                }
              }
            } else if (statement.count)
              issue("RANDOM_INPUT", p, "Shuffle does not take a sample count.");
          }
          addVariable(scope, statement.output, `${p}.output`, false);
          break;
        }
        case "optionalBranch": {
          value(statement.value, scope, `${p}.value`);
          const optional = statement.value.type;
          if (typeof optional === "string" || optional.kind !== "Optional") { issue("OPTIONAL_TYPE", `${p}.value`, "Choose a typed optional value."); break; }
          if (!typeEquals(statement.output.type, optional.value)) issue("TYPE", `${p}.output`, "The present value binding must match the optional payload type.");
          const presentScope = new Map(scope); addVariable(presentScope, statement.output, `${p}.output`, false);
          add(child(statement.present, "present", presentScope)); add(child(statement.unset, "unset")); break;
        }
        case "resultBranch": {
          value(statement.value, scope, `${p}.value`);
          const result = statement.value.type;
          if (typeof result === "string" || !["ParseResult", "OperationOutcome"].includes(result.kind) || !("value" in result)) { issue("RESULT_TYPE", `${p}.value`, "Choose a registered parse result or service operation outcome."); break; }
          if (!typeEquals(statement.output.type, result.value)) issue("TYPE", `${p}.output`, "The success binding must match the result payload type.");
          const successScope = new Map(scope), failureScope = new Map(scope); addVariable(successScope, statement.output, `${p}.output`, false);
          if (statement.reason) { if (statement.reason.type !== "PlainText") issue("TYPE", `${p}.reason`, "A result reason is safe plain text."); addVariable(failureScope, statement.reason, `${p}.reason`, false); }
          add(child(statement.succeeded, "succeeded", successScope)); add(child(statement.failed, "failed", new Map(failureScope)));
          if (result.kind === "ParseResult" && (statement.notStarted.some(node=>node.enabled!==false) || statement.unknown.some(node=>node.enabled!==false))) issue("RESULT_STATES", p, "Parse results have only conversion success and failure paths.");
          add(child(statement.notStarted, "notStarted", new Map(failureScope)));
          add(child(statement.unknown, "unknown", new Map(failureScope), {uncertaintyHandler:result.kind === "OperationOutcome" || state.uncertaintyHandler}));
          break;
        }
        case "action": {
          const action = ACTION_DEFINITIONS[statement.operation];
          if (
            statement.operation === "discord.sendMessage" ||
            statement.operation === "discord.editOwnMessage"
          ) {
            const modes = ["content", "messageSpec"].filter(
              (key) => statement.inputs[key] !== undefined,
            );
            if (modes.length !== 1)
              issue(
                "MESSAGE_MODE",
                `${p}.inputs`,
                "Choose exactly one plain text or structured Legacy message input.",
                modes.length === 0 ? "missing" : "error",
              );
          }
          if (action.externalChange) actions++;
          if (action.externalChange) {
            const key =
              statement.operation === "discord.addRole" ||
              statement.operation === "discord.removeRole"
                ? "roleIds"
                : statement.operation === "discord.createChannel"
                  ? "parentCategoryIds"
                  : "channelIds";
            const allowed = definition.targets?.[key] ?? [],
              inputKey =
                key === "roleIds"
                  ? "role"
                  : key === "parentCategoryIds"
                    ? "parent"
                    : "channel";
            if (!allowed.length)
              issue(
                "MISSING_TARGET_POLICY",
                p,
                "Choose the allowed targets for this operation.",
                "missing",
              );
            const target = statement.inputs[inputKey];
            if (
              target?.kind === "literal" &&
              target.value !== null &&
              typeof target.value === "object" &&
              !Array.isArray(target.value) &&
              !allowed.includes(String(target.value.id))
            )
              issue(
                "TARGET_POLICY",
                `${p}.inputs.${inputKey}`,
                "This target is outside the selected operation scope.",
              );
          }
          if (action.requiresApproval && statement.approvalRequired !== true)
            issue(
              "APPROVAL_REQUIRED",
              p,
              "This role change needs a formal, server-verified approval.",
            );
          for (const key of Object.keys(statement.inputs))
            if (!Object.hasOwn(action.inputs, key))
              issue(
                "ACTION_INPUT",
                `${p}.inputs.${key}`,
                "This operation input is not registered.",
              );
          for (const [key, inputDefinition] of Object.entries(action.inputs)) {
            const inputValue = statement.inputs[key];
            if (!inputValue) {
              if (!inputDefinition.optional)
                issue(
                  "MISSING_INPUT",
                  `${p}.inputs.${key}`,
                  "Choose a required operation input.",
                  "missing",
                );
            } else
              value(
                inputValue,
                scope,
                `${p}.inputs.${key}`,
                inputDefinition.type,
              );
          }
          if (statement.output) {
            if (
              !action.outputType ||
              !typeEquals(statement.output.type, action.outputType)
            )
              issue(
                "TYPE",
                `${p}.output`,
                "The operation output has an incorrect type.",
              );
            addVariable(scope, statement.output, `${p}.output`, false);
          }
          if (statement.outcome) {
            if (statement.output) issue("ACTION_RESULT_MODE", p, "Choose a direct success output or an explicit typed outcome.");
            const expected:ValueType={kind:"OperationOutcome",value:action.outputType??"Boolean"};
            if(!typeEquals(statement.outcome.type,expected))issue("TYPE",`${p}.outcome`,"The outcome payload must match the registered operation output.");
            addVariable(scope,statement.outcome,`${p}.outcome`,false);
            const next=body.slice(index+1).find(node=>node.enabled!==false);
            if(next?.kind!=="resultBranch"||next.value.kind!=="variable"||next.value.variableId!==statement.outcome.id)
              issue("ACTION_OUTCOME_HANDLER",p,"Follow an explicit outcome immediately with its dedicated result branch.");
          }
          break;
        }
        case "parallel": {
          if (statement.branches.length > limits.maxParallelBranches)
            issue("PARALLEL_LIMIT", p, "There are too many parallel branches.");
          if (
            new Set(statement.branches.map((branch) => branch.id)).size !==
            statement.branches.length
          )
            issue(
              "BRANCH_ID",
              p,
              "Parallel branch identifiers must be unique.",
            );
          const inherited = new Map(
            [...scope].map(([key, variable]) => [
              key,
              { ...variable, writable: false },
            ]),
          );
          statement.branches.forEach((branch, i) => {
            const branchScope = new Map(inherited);
            add(
              child(branch.body, `branches.${i}.body`, branchScope, {
                loopDepth: 0,
                parallelDepth: state.parallelDepth + 1,
                procedure: undefined,
              }),
            );
            for (const [outputId, input] of Object.entries(
              branch.outputs ?? {},
            ))
              value(
                input,
                branchScope,
                `${p}.branches.${i}.outputs.${outputId}`,
              );
          });
          for (const [variableId, mapping] of Object.entries(
            statement.outputs ?? {},
          )) {
            const target = scope.get(variableId);
            const branch = statement.branches.find(
              (candidate) => candidate.id === mapping.branchId,
            );
            const source = branch?.outputs?.[mapping.outputId];
            if (!target?.writable)
              issue(
                "PARALLEL_OUTPUT_TARGET",
                `${p}.outputs.${variableId}`,
                "Choose an existing writable parent variable for a joined output.",
              );
            if (!source)
              issue(
                "PARALLEL_OUTPUT_SOURCE",
                `${p}.outputs.${variableId}`,
                "Choose a declared output of this parallel branch.",
              );
            if (
              target &&
              source &&
              !typeEquals(target.declaration.type, source.type)
            )
              issue(
                "TYPE",
                `${p}.outputs.${variableId}`,
                "The branch output and parent variable must have the same type.",
              );
          }
          break;
        }
        case "call": {
          const procedure = definition.procedures?.find(
              (proc) =>
                proc.id === statement.procedureId &&
                proc.revision === statement.revision,
            ),
            identity = `${statement.procedureId}@${statement.revision}`;
          if (!procedure) {
            issue(
              "PROCEDURE_MISSING",
              p,
              "Choose a fixed revision of an available procedure.",
            );
            break;
          }
          if (
            state.callPath.includes(identity) ||
            state.callPath.length >= limits.maxCallDepth
          ) {
            issue(
              "PROCEDURE_CYCLE",
              p,
              "Recursive or excessively deep procedure calls are not permitted.",
            );
            break;
          }
          const parameters = procedure.inputs.map((parameter) => parameter.id);
          for (const key of Object.keys(statement.args))
            if (!parameters.includes(key))
              issue(
                "PROCEDURE_ARGUMENT",
                p,
                "This procedure argument is not registered.",
              );
          for (const parameter of procedure.inputs) {
            const argument = statement.args[parameter.id];
            if (!argument)
              issue(
                "MISSING_INPUT",
                p,
                "A required procedure argument is missing.",
                "missing",
              );
            else
              value(
                argument,
                scope,
                `${p}.args.${parameter.id}`,
                parameter.type,
              );
          }
          const outputs = procedure.outputs.map((output) => output.id);
          for (const key of Object.keys(statement.outputs))
            if (!outputs.includes(key))
              issue(
                "PROCEDURE_OUTPUT",
                p,
                "This procedure output is not registered.",
              );
          for (const output of procedure.outputs) {
            const binding = statement.outputs[output.id];
            if (!binding)
              issue(
                "PROCEDURE_OUTPUT",
                p,
                "Bind every declared procedure result.",
              );
            else {
              if (!typeEquals(binding.type, output.type))
                issue("TYPE", p, "The procedure result type is incorrect.");
              addVariable(scope, binding, `${p}.outputs.${output.id}`, false);
            }
          }
          add(
            estimateProcedure(procedure.body, definition, limits, [
              ...state.callPath,
              identity,
            ]),
          );
          break;
        }
        case "return": {
          const procedure = state.procedure;
          if (!procedure)
            issue("RETURN_SCOPE", p, "Return results only inside a procedure.");
          else {
            for (const key of Object.keys(statement.values))
              if (!procedure.outputs.some((output) => output.id === key))
                issue(
                  "RETURN_OUTPUT",
                  p,
                  "This result is not declared by the procedure.",
                );
            for (const output of procedure.outputs) {
              const returned = statement.values[output.id];
              if (!returned)
                issue(
                  "RETURN_OUTPUT",
                  p,
                  "A required procedure result is missing.",
                );
              else
                value(returned, scope, `${p}.values.${output.id}`, output.type);
            }
          }
          break;
        }
        case "break":
        case "continue":
          if (state.loopDepth === 0)
            issue(
              "LOOP_BOUNDARY",
              p,
              "Only the nearest enclosing finite loop can be controlled.",
            );
          break;
        case "end":
          if (!state.uncertaintyHandler && (state.procedure || state.parallelDepth > 0))
            issue(
              "END_SCOPE",
              p,
              "End this run belongs to the main procedure; use a return in a child procedure.",
            );
          break;
      }
      if (
        (statement.kind === "return" ||
          statement.kind === "end" ||
          statement.kind === "break" ||
          statement.kind === "continue") &&
        body.slice(index + 1).some((next) => next.enabled !== false)
      )
        issue(
          "UNREACHABLE",
          p,
          "Remove or disable steps after this unconditional exit.",
        );
    }
    return { steps, actions };
  };
  const estimate = walk(definition.body, rootScope, "body", {
    loopDepth: 0,
    parallelDepth: 0,
    callPath: [],
    depth: 0,
  });
  definition.procedures?.forEach((procedure, i) => {
    const scope: Scope = new Map();
    procedure.inputs.forEach((parameter, j) =>
      addVariable(scope, parameter, `procedures.${i}.inputs.${j}`, false),
    );
    walk(procedure.body, scope, `procedures.${i}.body`, {
      loopDepth: 0,
      parallelDepth: 0,
      procedure,
      callPath: [`${procedure.id}@${procedure.revision}`],
      depth: 0,
    });
    if (!alwaysReturns(procedure.body))
      issue(
        "RETURN_REQUIRED",
        `procedures.${i}.body`,
        "Every normal procedure path must return its declared results.",
      );
  });
  definition.pureDefinitions?.forEach((pure, i) => {
    const scope: Scope = new Map();
    pure.inputs.forEach((parameter, j) =>
      addVariable(scope, parameter, `pureDefinitions.${i}.inputs.${j}`, false),
    );
    value(pure.value, scope, `pureDefinitions.${i}.value`, pure.outputType);
  });
  if (definition.detached?.length) {
    walk(definition.detached, new Map(rootScope), "detached", {
      loopDepth: 0,
      parallelDepth: 0,
      callPath: [],
      depth: 0,
    });
    if (definition.detached.some((statement) => statement.enabled !== false))
      issue(
        "DETACHED",
        "detached",
        "Connect these blocks or explicitly mark them as not used.",
        "missing",
      );
  }
  if (statements > limits.maxStatements)
    issue(
      "STATEMENT_BUDGET",
      "body",
      "The combined definition step budget is exceeded.",
    );
  if (estimate.steps > limits.maxExpandedSteps)
    issue(
      "STEP_BUDGET",
      "body",
      "The expanded execution would exceed its shared step budget.",
    );
  if (estimate.actions > limits.maxExternalActions)
    issue(
      "ACTION_BUDGET",
      "body",
      "The expanded execution would exceed its shared external-operation budget.",
    );
  const hash = semanticHash(definition),
    valid = issues.length === 0,
    complete = !issues.some((item) => item.severity === "missing");
  const result: ValidationResult = {
    valid,
    complete,
    issues,
    definition,
    semanticHash: hash,
  };
  if (valid && complete)
    result.plan = deepFreeze({
      schemaVersion: 1,
      semanticHash: hash,
      definition: stripExecutionCosmetics(definition),
      nodes: nodes.filter((node) => !node.path.startsWith("detached")),
      limits,
    });
  return result;
}
function containsVariableOrMissing(value: ValueInput): boolean {
  return (
    value.kind === "variable" ||
    value.kind === "missing" ||
    (value.kind === "expression" &&
      (value.expression.args.some(containsVariableOrMissing) ||
        Boolean(
          value.expression.options?.body &&
          containsVariableOrMissing(value.expression.options.body),
        )))
  );
}
function stripExecutionCosmetics(definition: FlowDefinition): FlowDefinition {
  const result = structuredClone(definition);
  delete result.ui;
  delete result.detached;
  return result;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function alwaysReturns(body: Statement[]): boolean {
  for (const statement of body) {
    if (statement.enabled === false) continue;
    if (statement.kind === "return") return true;
    if (
      statement.kind === "branch" &&
      alwaysReturns(statement.then) &&
      alwaysReturns(statement.otherwise) &&
      (statement.condition.type === "Boolean" ||
        alwaysReturns(statement.unknown))
    )
      return true;
    if (
      statement.kind === "switch" &&
      statement.cases.length > 0 &&
      statement.cases.every((branch) => alwaysReturns(branch.body))
    )
      return true;
    if (statement.kind === "poll" && alwaysReturns(statement.matched) && alwaysReturns(statement.exhausted) && alwaysReturns(statement.timedOut))
      return true;
    if (statement.kind === "awaitEvent" && alwaysReturns(statement.matched) && alwaysReturns(statement.timedOut))
      return true;
    if (statement.kind === "optionalBranch" && alwaysReturns(statement.present) && alwaysReturns(statement.unset)) return true;
    if (statement.kind === "resultBranch" && alwaysReturns(statement.succeeded) && alwaysReturns(statement.failed) && (typeof statement.value.type === "object" && statement.value.type.kind === "ParseResult" || alwaysReturns(statement.notStarted))) return true;
  }
  return false;
}
function estimateProcedure(
  body: Statement[],
  definition: FlowDefinition,
  limits: AutomationLimits,
  path: string[],
): { steps: number; actions: number } {
  let steps = 0,
    actions = 0;
  for (const statement of body) {
    if (statement.enabled === false) continue;
    steps++;
    if (statement.kind === "poll")
      steps += statement.maxAttempts.kind === "literal" && typeof statement.maxAttempts.value === "number"
        ? statement.maxAttempts.value - 1 : limits.maxListItems - 1;
    if (
      statement.kind === "action" &&
      ACTION_DEFINITIONS[statement.operation].externalChange
    )
      actions++;
    const children: Statement[][] =
      statement.kind === "branch"
        ? [statement.then, statement.otherwise, statement.unknown]
        : statement.kind === "resultBranch"
          ? [statement.succeeded,statement.failed,statement.notStarted,statement.unknown]
        : statement.kind === "optionalBranch"
          ? [statement.present,statement.unset]
        : statement.kind === "approval"
          ? [statement.approved,statement.rejected,statement.expired]
        : statement.kind === "switch"
          ? statement.cases.map((branch) => branch.body)
          : statement.kind === "poll"
            ? [statement.matched, statement.exhausted, statement.timedOut]
            : statement.kind === "awaitEvent"
              ? [statement.matched, statement.timedOut]
          : statement.kind === "parallel"
            ? statement.branches.map((branch) => branch.body)
            : statement.kind === "repeat"
              ? [statement.body]
              : [];
    let multiplier = 1;
    if (statement.kind === "repeat")
      multiplier =
        statement.count?.kind === "literal" &&
        typeof statement.count.value === "number"
          ? statement.count.value
          : statement.list?.kind === "literal" &&
              Array.isArray(statement.list.value)
            ? statement.list.value.length
            : limits.maxListItems;
    for (const child of children) {
      const estimated = estimateProcedure(child, definition, limits, path);
      steps += estimated.steps * multiplier;
      actions += estimated.actions * multiplier;
    }
    if (statement.kind === "call") {
      const identity = `${statement.procedureId}@${statement.revision}`,
        procedure = definition.procedures?.find(
          (proc) =>
            proc.id === statement.procedureId &&
            proc.revision === statement.revision,
        );
      if (
        !procedure ||
        path.includes(identity) ||
        path.length >= limits.maxCallDepth
      )
        return {
          steps: limits.maxExpandedSteps + 1,
          actions: limits.maxExternalActions + 1,
        };
      const estimated = estimateProcedure(procedure.body, definition, limits, [
        ...path,
        identity,
      ]);
      steps += estimated.steps;
      actions += estimated.actions;
    }
    if (steps > limits.maxExpandedSteps || actions > limits.maxExternalActions)
      break;
  }
  return { steps, actions };
}
export function compileFlowDefinition(
  input: unknown,
  options: ValidateFlowOptions = {},
): ExecutionPlan {
  const result = validateFlowDefinition(input, options);
  if (!result.plan) throw new AutomationDefinitionError(result.issues);
  return result.plan;
}
