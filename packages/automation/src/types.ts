/** The alpha15 wire format. Display names and UI metadata never confer authority. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type AtomicType =
  | "Number"
  | "Boolean"
  | "PlainText"
  | "RichText"
  | "RichTextSpec"
  | "EmbedSpec"
  | "LegacyMessageSpec"
  | "Instant"
  | "Duration"
  | "DateOnly"
  | "LocalTime"
  | "TimeZone"
  | "ZonedDateTimeSpec"
  | "DateRange"
  | "InstantRange"
  | "ConditionResult"
  | "ChannelRef"
  | "RoleRef"
  | "MemberRef"
  | "ThreadRef"
  | "MessageRef"
  | "TicketRef"
  | "EventRef";
export type ValueType =
  | AtomicType
  | { kind: "List"; element: ValueType }
  | { kind: "Optional"; value: ValueType }
  | { kind: "ParseResult"; value: ValueType }
  | { kind: "OperationOutcome"; value: ValueType }
  | { kind: "Enum"; values: string[] }
  | { kind: "Record"; schemaId: string; typeArgs?: ValueType[] };
export interface TargetRef {
  id: string;
  guildId: string;
}
export type ConditionResult = "true" | "false" | "unknown";
export type TicketState = "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "SNOOZED" | "RESOLVED" | "DISMISSED";
export type OptionalValue =
  { state: "set"; value: JsonValue } | { state: "unset" };
export type LiteralInput = {
  kind: "literal";
  type: ValueType;
  value: JsonValue;
};
export type VariableInput = {
  kind: "variable";
  type: ValueType;
  variableId: string;
};
export type MissingInput = { kind: "missing"; type: ValueType };
export type ValueInput =
  | LiteralInput
  | VariableInput
  | MissingInput
  | { kind: "expression"; type: ValueType; expression: Expression };
export type ExpressionOperator =
  | "number.add"
  | "number.subtract"
  | "number.multiply"
  | "number.divide"
  | "number.remainder"
  | "number.min"
  | "number.max"
  | "number.abs"
  | "number.clamp"
  | "number.round"
  | "number.floor"
  | "number.ceil"
  | "compare.equal"
  | "compare.notEqual"
  | "compare.less"
  | "compare.lessOrEqual"
  | "compare.greater"
  | "compare.greaterOrEqual"
  | "condition.and"
  | "condition.or"
  | "condition.not"
  | "value.choose"
  | "optional.default"
  | "value.parse"
  | "value.lookup"
  | "text.join"
  | "text.length"
  | "text.contains"
  | "text.startsWith"
  | "text.endsWith"
  | "text.slice"
  | "text.replace"
  | "text.split"
  | "text.joinList"
  | "text.trim"
  | "text.repeat"
  | "text.upper"
  | "text.lower"
  | "rich.text"
  | "rich.wrap"
  | "rich.join"
  | "embed.build"
  | "message.legacy"
  | "list.build"
  | "list.length"
  | "list.item"
  | "list.append"
  | "list.remove"
  | "list.insert"
  | "list.replace"
  | "list.slice"
  | "list.concat"
  | "list.unique"
  | "list.sort"
  | "list.sum"
  | "list.average"
  | "list.min"
  | "list.max"
  | "list.intersection"
  | "list.difference"
  | "list.union"
  | "list.zip"
  | "list.chunk"
  | "list.range"
  | "list.map"
  | "list.filter"
  | "list.any"
  | "list.all"
  | "list.find"
  | "list.findResult"
  | "list.group"
  | "list.minMax"
  | "record.build"
  | "record.field"
  | "record.update"
  | "date.compose"
  | "date.addDays"
  | "date.weekday"
  | "time.compose"
  | "zoned.compose"
  | "zoned.fromInstant"
  | "zoned.resolve"
  | "zoned.addDays"
  | "date.weekdayEnum"
  | "zoned.weekday"
  | "temporal.format"
  | "dateRange.build"
  | "instantRange.build"
  | "dateRange.toInstants"
  | "range.contains"
  | "number.format"
  | "text.clean"
  | "instant.add"
  | "instant.difference"
  | "duration.build"
  | "pure.call";
export interface Expression {
  operator: ExpressionOperator;
  args: ValueInput[];
  /** Only registered fields/options are permitted; this is never executable source. */
  options?: {
    digits?: number;
    key?: string;
    fields?: string[];
    bindingId?: string;
    body?: ValueInput;
    definitionId?: string;
    revision?: number;
    unit?: "seconds" | "minutes" | "hours" | "days";
    descending?: boolean;
    conversion?: "decimal" | "dateSlash" | "enum";
    format?:
      | "bold"
      | "italic"
      | "underline"
      | "strike"
      | "spoiler"
      | "quote"
      | "heading1"
      | "heading2"
      | "heading3";
  };
}
export interface VariableDeclaration {
  id: string;
  name: string;
  type: ValueType;
  description?: string;
}
export interface StatementBase {
  id: string;
  enabled?: boolean;
}
export type Statement =
  | (StatementBase & {
      kind: "declare";
      variable: VariableDeclaration;
      value: ValueInput;
    })
  | (StatementBase & { kind: "assign"; variableId: string; value: ValueInput })
  | (StatementBase & {
      kind: "branch";
      condition: ValueInput;
      then: Statement[];
      otherwise: Statement[];
      unknown: Statement[];
    })
  | (StatementBase & {
      kind: "switch";
      value: ValueInput;
      cases: { value: string; body: Statement[] }[];
    })
  | (StatementBase & {
      kind: "resultBranch";
      value: ValueInput;
      output: VariableDeclaration;
      reason?: VariableDeclaration;
      succeeded: Statement[];
      failed: Statement[];
      notStarted: Statement[];
      unknown: Statement[];
    })
  | (StatementBase & {
      kind: "optionalBranch";
      value: ValueInput;
      output: VariableDeclaration;
      present: Statement[];
      unset: Statement[];
    })
  | (StatementBase & {
      kind: "repeat";
      count?: ValueInput;
      list?: ValueInput;
      itemVariable: VariableDeclaration;
      indexVariable?: VariableDeclaration;
      body: Statement[];
      results?: {output:VariableDeclaration;value:ValueInput}[];
    })
  | (StatementBase & {
      kind: "wait";
      duration?: ValueInput;
      until?: ValueInput;
    })
  | (StatementBase & {
      /** Registered read-only ticket check; every bound is fixed on entry. */
      kind: "poll";
      ticket: ValueInput;
      maxAttempts: ValueInput;
      interval: ValueInput;
      until: ValueInput;
      output: VariableDeclaration;
      condition: ValueInput;
      matched: Statement[];
      exhausted: Statement[];
      timedOut: Statement[];
    })
  | (StatementBase & {
      kind: "awaitEvent";
      ticket: ValueInput;
      event: "ticketUpdated";
      states: TicketState[];
      until: ValueInput;
      output: VariableDeclaration;
      matched: Statement[];
      timedOut: Statement[];
    })
  | (StatementBase & {
      kind: "random";
      mode: "integer" | "sample" | "shuffle";
      output: VariableDeclaration;
      min?: ValueInput;
      max?: ValueInput;
      list?: ValueInput;
      count?: ValueInput;
    })
  | (StatementBase & { kind: "readClock"; output: VariableDeclaration })
  | (StatementBase & {
      kind:"approval";actionId:string;until:ValueInput;
      approved:Statement[];rejected:Statement[];expired:Statement[];
    })
  | (StatementBase & {
      kind: "action";
      operation: ActionOperation;
      inputs: Record<string, ValueInput>;
      output?: VariableDeclaration;
      /** Explicit typed outcome handling; default failures still stop the Run. */
      outcome?: VariableDeclaration;
      approvalRequired?: boolean;
    })
  | (StatementBase & {
      kind: "call";
      procedureId: string;
      revision: number;
      args: Record<string, ValueInput>;
      outputs: Record<string, VariableDeclaration>;
    })
  | (StatementBase & { kind: "return"; values: Record<string, ValueInput> })
  | (StatementBase & {
      kind: "parallel";
      branches: {
        id: string;
        name: string;
        body: Statement[];
        outputs?: Record<string, ValueInput>;
      }[];
      /** Existing parent locals are assigned together only after every branch completes. */
      outputs?: Record<string, { branchId: string; outputId: string }>;
    })
  | (StatementBase & { kind: "break" | "continue" })
  | (StatementBase & { kind: "end"; reason?: string });
export type ActionOperation =
  | "discord.sendMessage"
  | "discord.addRole"
  | "discord.removeRole"
  | "discord.createChannel"
  | "discord.createThread"
  | "discord.editOwnMessage"
  | "nexus.readTicket";
export type TriggerDefinition =
  | { kind: "manual"; inputs: VariableDeclaration[] }
  | {
      kind: "schedule";
      schedule: RecurrenceSpec | ElapsedScheduleSpec | { kind: "once"; at: ZonedDateTimeSpec };
    }
  | {
      kind: "internal";
      event: "ticketCreated" | "ticketUpdated";
      inputs: VariableDeclaration[];
    }
  | { kind: "interaction"; inputs: VariableDeclaration[] }
  | {
      kind: "messageMetadata";
      channelIds: string[];
      excludeBots: true;
      inputs: VariableDeclaration[];
    };
export interface ProcedureDefinition {
  id: string;
  revision: number;
  name: string;
  inputs: VariableDeclaration[];
  outputs: VariableDeclaration[];
  body: Statement[];
}
export interface PureDefinition {
  id: string;
  revision: number;
  name: string;
  inputs: VariableDeclaration[];
  outputType: ValueType;
  value: ValueInput;
}
export interface FlowDefinition {
  schemaVersion: 1;
  id: string;
  guildId: string;
  name: string;
  trigger: TriggerDefinition;
  /** Declarations describe fixed trigger/config inputs, not a shared mutable database. */
  variables: VariableDeclaration[];
  body: Statement[];
  /** User-selected immutable scope; server authorization is still checked for every action. */
  targets?: {
    channelIds: string[];
    roleIds: string[];
    parentCategoryIds: string[];
  };
  procedures?: ProcedureDefinition[];
  pureDefinitions?: PureDefinition[];
  /** Detached blocks are draft-only and never join an executable plan. */
  detached?: Statement[];
  ui?: {
    collapsed?: string[];
    selectedId?: string;
    positions?: Record<string, { x: number; y: number }>;
    view?: "blocks" | "steps";
  };
}
export interface AutomationLimits {
  maxDefinitionBytes: number;
  maxStatements: number;
  maxExpandedSteps: number;
  maxExpressionDepth: number;
  maxExpressionNodes: number;
  maxEvaluations: number;
  maxListItems: number;
  maxTextLength: number;
  maxValueBytes: number;
  maxVariables: number;
  maxNesting: number;
  maxParallelBranches: number;
  maxCallDepth: number;
  maxExternalActions: number;
}
/** Finite defensive defaults, not measured capacity or a commercial promise. */
export const DEFAULT_AUTOMATION_LIMITS: Readonly<AutomationLimits> =
  Object.freeze({
    maxDefinitionBytes: 262144,
    maxStatements: 100,
    maxExpandedSteps: 1000,
    maxExpressionDepth: 8,
    maxExpressionNodes: 128,
    maxEvaluations: 5000,
    maxListItems: 100,
    maxTextLength: 2000,
    maxValueBytes: 65536,
    maxVariables: 128,
    maxNesting: 8,
    maxParallelBranches: 3,
    maxCallDepth: 3,
    maxExternalActions: 25,
  });
export const MAX_RUN_SECONDS = 7 * 24 * 60 * 60;
export const MAX_WAIT_SECONDS = MAX_RUN_SECONDS;
export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "missing";
}
export interface CanonicalNode {
  id: string;
  kind: Statement["kind"];
  path: string;
  parentId?: string;
}
export interface ExecutionPlan {
  schemaVersion: 1;
  semanticHash: string;
  definition: FlowDefinition;
  nodes: CanonicalNode[];
  limits: AutomationLimits;
}
export interface ValidationResult {
  valid: boolean;
  complete: boolean;
  issues: ValidationIssue[];
  definition?: FlowDefinition;
  plan?: ExecutionPlan;
  semanticHash?: string;
}
export interface Provenance {
  source: "literal" | "input" | "variable" | "expression" | "service";
  guildId?: string;
  /** All derived values inherit restrictions. */ allowedChannelIds?: string[];
  sensitive?: boolean;
  resumable?: boolean;
  /** Issued only by a registered conversion or the operation runtime. */
  evidence?: "parse" | "operation";
}
export interface EvaluatedValue {
  type: ValueType;
  value: JsonValue;
  provenance: Provenance[];
}
export interface EvaluationBudget {
  evaluations: number;
}
export interface EvaluationContext {
  guildId: string;
  variables: Readonly<Record<string, EvaluatedValue>>;
  limits?: Partial<AutomationLimits>;
  budget?: EvaluationBudget;
  pureDefinitions?: PureDefinition[];
  recordSchemas?: Record<string, RecordSchema>;
}
export interface RecordSchema {
  fields: Record<
    string,
    { type: ValueType; optional?: boolean; writable?: boolean }
  >;
  userConstructible: boolean;
}
export interface ZonedDateTimeSpec {
  date: string;
  time: string;
  timeZone: string;
  occurrence?: "earlier" | "later";
}
export interface DateRange {
  start: string;
  end: string;
  timeZone: string;
  boundaryRule: "firstValidEarlier";
}
export interface InstantRange {
  start: string;
  end: string;
}
export interface LocalTimeWindowSpec {
  start: string;
  end: string;
  endDayOffset: 0 | 1;
  weekdays: number[];
  timeZone: string;
}
export interface RecurrenceSpec {
  kind: "recurring";
  frequency: "daily" | "weekly" | "monthly";
  time: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  weekdays?: number[];
  monthDay?: number | "last";
  missingTime: "skip";
  repeatedTime: "earlier";
  pastOccurrences: "skip";
}
export interface ScheduleOccurrence {
  localDate: string;
  localTime: string;
  timeZone: string;
  offset: string;
  instant: string;
}
export interface ElapsedScheduleSpec {
  kind:'elapsed';anchor:string;intervalSeconds:number;end:string;pastOccurrences:'skip';
}
