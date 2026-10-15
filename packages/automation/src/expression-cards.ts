/** Browser-safe editor descriptions for the existing pure expression language.
 * These are editing hints, never permission grants or an alternative validator.
 * All execution inputs start missing. Server compilation remains authoritative.
 */
import {
  BUILTIN_RECORD_SCHEMAS,
  typeEquals,
  validateValueInput,
  registeredRecordSchema,
} from "./expression";
import type {
  EvaluatedValue,
  Expression,
  ExpressionOperator,
  PureDefinition,
  RecordSchema,
  ValueInput,
  ValueType,
  VariableDeclaration,
} from "./types";
import { registeredPairFields } from "./registered-pairs";
import {
  groupRecordType,
  findMatchType,
  mappingKeyType,
  structuredRecordSchema,
} from "./structured-values";
import { temporalExpressionCards } from "./temporal-cards";
import { isParseTarget } from "./results";

export interface ExpressionCardLabel {
  ja: string;
  en: string;
}
export interface ExpressionCardInput {
  type: ValueType;
  label: ExpressionCardLabel;
  integer?: boolean;
  minimum?: number;
  maximum?: number;
}
export interface TypedExpressionCard {
  /** Stable across translated/display-name changes. Use this, not operator, as a select key. */
  id: string;
  operator: ExpressionOperator;
  label: ExpressionCardLabel;
  outputType: ValueType;
  inputs: ExpressionCardInput[];
  options?: Expression["options"];
  /** The binding exists only inside options.body, never in the source-list input. */
  binding?: {
    type: ValueType;
    outputType: ValueType;
    label: ExpressionCardLabel;
  };
  variadic?: { type: ValueType; minimum: number; maximum: number };
}
export interface ExpressionCardsContext {
  variables?: readonly VariableDeclaration[];
  pureDefinitions?: readonly PureDefinition[];
  recordSchemas?: Readonly<Record<string, RecordSchema>>;
}
export interface ExpressionBodyBinding extends VariableDeclaration {
  readOnly: true;
}
export const EXPRESSION_CARD_LIMITS = Object.freeze({
  types: 24,
  cards: 512,
  definitions: 100,
  variables: 128,
  typeDepth: 8,
});
/** The wire contract accepts additional trusted Ref keys. Advertise fixed-key
 * forms only when the current editor can author each literal without raw IDs.
 */
export function supportsFixedMappingKeyEditor(type: ValueType): boolean {
  return (
    mappingKeyType(type) &&
    (typeof type !== "string" ||
      !type.endsWith("Ref") ||
      type === "ChannelRef" ||
      type === "RoleRef")
  );
}
const localOperators = new Set<ExpressionOperator>([
  "list.map",
  "list.filter",
  "list.any",
  "list.all",
  "list.find",
  "list.findResult",
]);
// Matches the persisted definition identifier contract, including schema namespaces.
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const orderedTypes = new Set([
  "Number",
  "Duration",
  "DateOnly",
  "Instant",
  "LocalTime",
  "PlainText",
]);
const listOf = (element: ValueType): ValueType => ({ kind: "List", element });
const optionalOf = (value: ValueType): ValueType => ({
  kind: "Optional",
  value,
});
const label = (ja: string, en: string): ExpressionCardLabel => ({ ja, en });
const argument = (
  type: ValueType,
  ja: string,
  en: string,
  count = false,
): ExpressionCardInput => ({
  type,
  label: label(ja, en),
  ...(count ? { integer: true, minimum: 0 } : {}),
});
const missing = (type: ValueType): ValueInput => ({
  kind: "missing",
  type: structuredClone(type),
});
const stableType = (type: ValueType): string => JSON.stringify(type);
function boundedType(type: ValueType, depth = 0): boolean {
  if (depth > EXPRESSION_CARD_LIMITS.typeDepth) return false;
  if (typeof type === "string") return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(type);
  if (!type || typeof type !== "object") return false;
  if (type.kind === "List") return boundedType(type.element, depth + 1);
  if (
    type.kind === "Optional" ||
    type.kind === "ParseResult" ||
    type.kind === "OperationOutcome"
  )
    return boundedType(type.value, depth + 1);
  if (type.kind === "Record")
    return (
      identifier.test(type.schemaId) &&
      (type.typeArgs?.length ?? 0) <= 2 &&
      (type.typeArgs ?? []).every((arg) => boundedType(arg, depth + 1))
    );
  return (
    type.kind === "Enum" &&
    Array.isArray(type.values) &&
    type.values.length > 0 &&
    type.values.length <= 100 &&
    type.values.every(
      (value) =>
        typeof value === "string" && value.length > 0 && value.length <= 100,
    ) &&
    new Set(type.values).size === type.values.length
  );
}
function bindingId(
  allocateId: () => string,
  reserved = new Set<string>(),
): string {
  const id = allocateId();
  if (!identifier.test(id) || reserved.has(id))
    throw new Error("EXPRESSION_BINDING_ID");
  reserved.add(id);
  return id;
}

/** Instantiate once when selected, not on each render. No example becomes an input value. */
export function instantiateExpressionCard(
  card: TypedExpressionCard,
  allocateId?: () => string,
): ValueInput {
  const options = card.options ? structuredClone(card.options) : undefined;
  if (card.binding && !allocateId)
    throw new Error("EXPRESSION_BINDING_ID_REQUIRED");
  return {
    kind: "expression",
    type: structuredClone(card.outputType),
    expression: {
      operator: card.operator,
      args: card.inputs.map((input) => missing(input.type)),
      ...(options || card.binding
        ? {
            options: {
              ...options,
              ...(card.binding
                ? {
                    bindingId: bindingId(allocateId!),
                    body: missing(card.binding.outputType),
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

/** Supply these only to the body editor's variable list. Assignment is never offered. */
export function expressionBodyBindings(
  input: ValueInput,
): ExpressionBodyBinding[] {
  if (
    input.kind !== "expression" ||
    !localOperators.has(input.expression.operator)
  )
    return [];
  const source = input.expression.args[0]?.type,
    id = input.expression.options?.bindingId;
  if (
    !source ||
    typeof source === "string" ||
    source.kind !== "List" ||
    !id ||
    !identifier.test(id)
  )
    return [];
  return [
    { id, name: "item", type: structuredClone(source.element), readOnly: true },
  ];
}

/** Generate bounded, concrete type variants rather than treating List<T> as a wildcard.
 * Record builders are offered only for registered, user-constructible schemas.
 * Service-owned records can be read through a visible typed source, never forged.
 */
export function expressionCardsFor(
  expectedType: ValueType,
  context: ExpressionCardsContext = {},
): TypedExpressionCard[] {
  if (!boundedType(expectedType)) return [];
  const schemas = { ...context.recordSchemas, ...BUILTIN_RECORD_SCHEMAS };
  const variables = (context.variables ?? []).slice(
    0,
    EXPRESSION_CARD_LIMITS.variables,
  );
  const pureDefinitions = (context.pureDefinitions ?? []).slice(
    0,
    EXPRESSION_CARD_LIMITS.definitions,
  );
  const types: ValueType[] = [],
    keys = new Set<string>();
  const addType = (type: ValueType) => {
    if (!boundedType(type) || types.length >= EXPRESSION_CARD_LIMITS.types)
      return;
    const key = stableType(type);
    if (keys.has(key)) return;
    keys.add(key);
    types.push(structuredClone(type));
    if (typeof type !== "string" && type.kind === "List") addType(type.element);
    if (
      typeof type !== "string" &&
      (type.kind === "Optional" ||
        type.kind === "ParseResult" ||
        type.kind === "OperationOutcome")
    )
      addType(type.value);
    if (typeof type !== "string" && type.kind === "Record")
      type.typeArgs?.forEach(addType);
  };
  addType(expectedType);
  variables.forEach((variable) => addType(variable.type));
  for (const type of [
    "Number",
    "PlainText",
    "Boolean",
    "ConditionResult",
    "Duration",
    "Instant",
    "DateOnly",
    "LocalTime",
    "TimeZone",
  ] as const)
    addType(type);
  // Resolve only pair schemas already present in the expected type or visible
  // variables. Do not enumerate the registry into every unrelated value slot.
  for (const type of types)
    if (typeof type !== "string" && type.kind === "Record") {
      const schema = structuredRecordSchema(type);
      if (schema && !type.typeArgs?.length) schemas[type.schemaId] = schema;
    }
  const cards: TypedExpressionCard[] = [];
  const add = (
    operator: ExpressionOperator,
    ja: string,
    en: string,
    outputType: ValueType,
    inputs: ExpressionCardInput[],
    extra: Partial<TypedExpressionCard> = {},
  ) => {
    if (
      !boundedType(outputType) ||
      inputs.some((input) => !boundedType(input.type)) ||
      !typeEquals(expectedType, outputType) ||
      cards.length >= EXPRESSION_CARD_LIMITS.cards
    )
      return;
    const card = {
      operator,
      label: label(ja, en),
      outputType,
      inputs,
      ...extra,
    };
    const id =
      operator +
      ":" +
      JSON.stringify({
        output: outputType,
        inputs: inputs.map((input) => input.type),
        options: card.options,
        binding: card.binding?.outputType,
      });
    if (cards.some((existing) => existing.id === id)) return;
    cards.push(structuredClone({ ...card, id }));
  };
  const n = () => argument("Number", "数値", "Number");
  const text = () => argument("PlainText", "文字", "Text");
  const count = () => argument("Number", "件数", "Count", true);
  const position = () => ({
    ...argument("Number", "位置（1 始まり）", "Position (starts at 1)", true),
    minimum: 1,
  });
  const source = (type: ValueType) => argument(listOf(type), "一覧", "List");
  const first = (type: ValueType) => argument(type, "値", "Value");
  if (
    typeof expectedType !== "string" &&
    expectedType.kind === "ParseResult" &&
    isParseTarget(expectedType.value)
  )
    add(
      "value.parse",
      "形式を指定して変換する",
      "Parse with a registered format",
      expectedType,
      [argument("PlainText", "変換する文字", "Text to parse")],
      {
        options: {
          conversion:
            expectedType.value === "Number"
              ? "decimal"
              : expectedType.value === "DateOnly"
                ? "dateSlash"
                : "enum",
        },
      },
    );
  if (typeof expectedType !== "string" && expectedType.kind === "List") {
    const pair = registeredPairFields(expectedType.element);
    if (pair)
      add(
        "list.zip",
        "二つの一覧を順番で組にする",
        "Pair two lists by position",
        expectedType,
        [
          argument(listOf(pair.first), "一つ目の一覧", "First list"),
          argument(listOf(pair.second), "二つ目の一覧", "Second list"),
        ],
      );
  }
  add(
    "rich.text",
    "普通の文章を装飾部品にする",
    "Plain text as a rich-text part",
    "RichTextSpec",
    [argument("PlainText", "普通の文章", "Plain text")],
  );
  for (const [format, ja, en] of [
    ["bold", "太字", "Bold"],
    ["italic", "斜体", "Italic"],
    ["underline", "下線", "Underline"],
    ["strike", "取り消し線", "Strike through"],
    ["spoiler", "伏せ字", "Spoiler"],
    ["quote", "引用", "Quote"],
    ["heading1", "大きい見出し", "Large heading"],
    ["heading2", "中見出し", "Medium heading"],
    ["heading3", "小見出し", "Small heading"],
  ] as const)
    add(
      "rich.wrap",
      ja,
      en,
      "RichTextSpec",
      [
        argument(
          "RichTextSpec",
          "装飾する文章の部品",
          "Rich-text parts to format",
        ),
      ],
      { options: { format } },
    );
  add(
    "rich.join",
    "文章の部品をつなぐ",
    "Join rich-text parts",
    "RichTextSpec",
    [first("RichTextSpec"), first("RichTextSpec")],
    { variadic: { type: "RichTextSpec", minimum: 0, maximum: 100 } },
  );
  add(
    "embed.build",
    "普通の文章からカードを作る",
    "Build an embed from plain text",
    "EmbedSpec",
    [
      argument("PlainText", "カードのタイトル", "Embed title"),
      argument("PlainText", "カードの説明文", "Embed description"),
    ],
  );
  add(
    "message.legacy",
    "文章とカードから投稿を作る",
    "Build a message from text and cards",
    "LegacyMessageSpec",
    [
      argument("RichTextSpec", "本文の部品", "Message text parts"),
      argument(listOf("EmbedSpec"), "埋め込みカードの一覧", "Embed card list"),
    ],
  );

  for (const [op, ja, en] of [
    ["add", "足す", "Add"],
    ["subtract", "引く", "Subtract"],
    ["multiply", "掛ける", "Multiply"],
    ["divide", "割る", "Divide"],
    ["remainder", "余り", "Remainder"],
    ["min", "小さい方", "Minimum"],
    ["max", "大きい方", "Maximum"],
  ])
    add(`number.${op}` as ExpressionOperator, ja!, en!, "Number", [n(), n()]);
  for (const [op, ja, en] of [
    ["abs", "絶対値", "Absolute value"],
    ["round", "四捨五入", "Round"],
    ["floor", "切り下げ", "Round down"],
    ["ceil", "切り上げ", "Round up"],
  ])
    add(`number.${op}` as ExpressionOperator, ja!, en!, "Number", [n()]);
  add("number.clamp", "範囲に収める", "Clamp to a range", "Number", [
    n(),
    n(),
    n(),
  ]);
  add("text.join", "文字をつなぐ", "Join text", "PlainText", [text(), text()], {
    variadic: { type: "PlainText", minimum: 0, maximum: 100 },
  });
  for (const [op, ja, en] of [
    ["length", "文字の長さ", "Text length"],
    ["trim", "前後の空白を除く", "Trim text"],
    ["upper", "大文字", "Uppercase"],
    ["lower", "小文字", "Lowercase"],
  ])
    add(
      `text.${op}` as ExpressionOperator,
      ja!,
      en!,
      op === "length" ? "Number" : "PlainText",
      [text()],
    );
  for (const [op, ja, en] of [
    ["contains", "文字を含むか", "Text contains"],
    ["startsWith", "文字で始まるか", "Text starts with"],
    ["endsWith", "文字で終わるか", "Text ends with"],
  ])
    add(`text.${op}` as ExpressionOperator, ja!, en!, "Boolean", [
      text(),
      text(),
    ]);
  add("text.slice", "文字の一部", "Slice text", "PlainText", [
    text(),
    position(),
    count(),
  ]);
  add("text.replace", "文字を置き換える", "Replace text", "PlainText", [
    text(),
    text(),
    text(),
  ]);
  add("text.split", "文字を区切って一覧に", "Split text", listOf("PlainText"), [
    text(),
    text(),
  ]);
  add("text.joinList", "一覧の文字をつなぐ", "Join a text list", "PlainText", [
    source("PlainText"),
    text(),
  ]);
  add("text.repeat", "文字を繰り返す", "Repeat text", "PlainText", [
    text(),
    count(),
  ]);
  add("duration.build", "時間量を作る", "Build a duration", "Duration", [n()], {
    options: { unit: "seconds" },
  });
  add("date.compose", "日付を組み立てる", "Compose a date", "DateOnly", [
    { ...argument("Number", "年", "Year", true), minimum: 1, maximum: 9999 },
    { ...argument("Number", "月", "Month", true), minimum: 1, maximum: 12 },
    { ...argument("Number", "日", "Day", true), minimum: 1, maximum: 31 },
  ]);
  add("date.addDays", "暦で日付を動かす", "Move a calendar date", "DateOnly", [
    first("DateOnly"),
    n(),
  ]);
  add("date.weekday", "曜日を調べる", "Read a weekday", "Number", [
    first("DateOnly"),
  ]);
  add(
    "instant.add",
    "時刻に時間量を足す",
    "Add an elapsed duration",
    "Instant",
    [first("Instant"), first("Duration")],
  );
  add(
    "instant.difference",
    "時刻の差",
    "Difference between instants",
    "Duration",
    [first("Instant"), first("Instant")],
  );
  add(
    "list.range",
    "番号一覧を作る",
    "Build an integer range",
    listOf("Number"),
    [n(), n(), n()],
  );
  add("list.sum", "数値一覧の合計", "Sum numbers", "Number", [
    source("Number"),
  ]);
  add(
    "list.average",
    "数値一覧の平均と件数",
    "Average and count",
    { kind: "Record", schemaId: "AverageValue" },
    [source("Number")],
  );
  add(
    "list.minMax",
    "数値一覧の最小値と最大値",
    "Minimum and maximum of numbers",
    { kind: "Record", schemaId: "MinMaxValue" },
    [source("Number")],
  );
  for (const [op, ja, en] of [
    ["min", "一覧の最小値", "Minimum item"],
    ["max", "一覧の最大値", "Maximum item"],
  ])
    add(`list.${op}` as ExpressionOperator, ja!, en!, optionalOf("Number"), [
      source("Number"),
    ]);

  for (const type of types) {
    const list = listOf(type);
    for (const [op, ja, en] of [
      ["equal", "値が等しい", "Values are equal"],
      ["notEqual", "値が異なる", "Values differ"],
    ])
      add(`compare.${op}` as ExpressionOperator, ja!, en!, "Boolean", [
        first(type),
        first(type),
      ]);
    if (typeof type === "string" && orderedTypes.has(type)) {
      for (const [op, ja, en] of [
        ["less", "より小さい", "Less than"],
        ["lessOrEqual", "以下", "At most"],
        ["greater", "より大きい", "Greater than"],
        ["greaterOrEqual", "以上", "At least"],
      ])
        add(`compare.${op}` as ExpressionOperator, ja!, en!, "Boolean", [
          first(type),
          first(type),
        ]);
      for (const descending of [false, true])
        add(
          "list.sort",
          descending ? "一覧を降順に" : "一覧を昇順に",
          descending ? "Sort descending" : "Sort ascending",
          list,
          [source(type)],
          { options: { descending } },
        );
    }
    add("list.length", "一覧の件数", "List length", "Number", [source(type)]);
    add(
      "list.build",
      "同じ型の一覧を作る",
      "Build a typed list",
      list,
      [first(type), first(type)],
      { variadic: { type, minimum: 1, maximum: 100 } },
    );
    add("list.item", "一覧の項目", "Item at a position", type, [
      source(type),
      position(),
    ]);
    add("list.append", "一覧の末尾へ加える", "Append an item", list, [
      source(type),
      first(type),
    ]);
    add("list.remove", "一覧から位置で除く", "Remove at a position", list, [
      source(type),
      position(),
    ]);
    add("list.insert", "一覧へ位置で入れる", "Insert at a position", list, [
      source(type),
      position(),
      first(type),
    ]);
    add(
      "list.replace",
      "一覧の位置を置き換える",
      "Replace at a position",
      list,
      [source(type), position(), first(type)],
    );
    add("list.slice", "一覧の一部", "Slice a list", list, [
      source(type),
      position(),
      count(),
    ]);
    add("list.concat", "一覧をつなぐ", "Concatenate lists", list, [
      source(type),
      source(type),
    ]);
    for (const [op, ja, en] of [
      ["unique", "重複を除く", "Distinct items"],
      ["intersection", "両方にある項目", "Intersection"],
      ["difference", "片方だけの項目", "Difference"],
      ["union", "重複なくまとめる", "Union"],
    ])
      add(
        `list.${op}` as ExpressionOperator,
        ja!,
        en!,
        list,
        op === "unique" ? [source(type)] : [source(type), source(type)],
      );
    add(
      "list.chunk",
      "一覧を指定件数ずつに分ける",
      "Split a list into batches",
      listOf(list),
      [source(type), { ...count(), minimum: 1 }],
    );
    add(
      "list.filter",
      "条件に合う項目だけ",
      "Filter matching items",
      list,
      [source(type)],
      {
        binding: {
          type,
          outputType: "Boolean",
          label: label("この項目", "This item"),
        },
      },
    );
    add(
      "list.find",
      "最初に合う項目",
      "Find the first matching item",
      optionalOf(type),
      [source(type)],
      {
        binding: {
          type,
          outputType: "Boolean",
          label: label("この項目", "This item"),
        },
      },
    );
    add(
      "list.findResult",
      "最初に合う項目と位置",
      "First matching item and its position",
      optionalOf(findMatchType(type)),
      [source(type)],
      {
        binding: {
          type,
          outputType: "Boolean",
          label: label("この項目", "This item"),
        },
      },
    );
    if (typeof type === "string" || type.kind !== "Record")
      add(
        "list.group",
        "同じ値ごとに一覧をまとめる",
        "Group a list by equal values",
        listOf(groupRecordType(type, type)),
        [source(type)],
      );
    for (const [op, ja, en] of [
      ["any", "いずれかが条件に合う", "Any item matches"],
      ["all", "すべて条件に合う", "All items match"],
    ])
      add(
        `list.${op}` as ExpressionOperator,
        ja!,
        en!,
        "Boolean",
        [source(type)],
        {
          binding: {
            type,
            outputType: "Boolean",
            label: label("この項目", "This item"),
          },
        },
      );
    if (typeof expectedType !== "string" && expectedType.kind === "List")
      add(
        "list.map",
        "各項目を純粋な式で変える",
        "Map each item with a pure expression",
        expectedType,
        [source(type)],
        {
          binding: {
            type,
            outputType: expectedType.element,
            label: label("この項目", "This item"),
          },
        },
      );
  }
  for (const type of ["Boolean", "ConditionResult"] as const) {
    for (const [op, ja, en] of [
      ["and", "両方の条件", "Both conditions"],
      ["or", "いずれかの条件", "Either condition"],
      ["not", "条件を反転", "Invert condition"],
    ])
      add(
        `condition.${op}` as ExpressionOperator,
        ja!,
        en!,
        type,
        op === "not" ? [first(type)] : [first(type), first(type)],
      );
    add(
      "value.choose",
      "条件で値を選ぶ",
      "Choose a value by condition",
      expectedType,
      [
        first(type),
        first(expectedType),
        first(expectedType),
        ...(type === "ConditionResult" ? [first(expectedType)] : []),
      ],
    );
  }
  add(
    "optional.default",
    "値がない場合の代わり",
    "Fallback when unset",
    expectedType,
    [first(optionalOf(expectedType)), first(expectedType)],
  );
  const recordTypes = [
    ...types.filter(
      (type) => typeof type !== "string" && type.kind === "Record",
    ),
    ...Object.keys(schemas).map((schemaId) => ({
      kind: "Record" as const,
      schemaId,
    })),
  ];
  const seenRecords = new Set<string>();
  for (const record of recordTypes) {
    const identity = stableType(record);
    if (
      seenRecords.has(identity) ||
      seenRecords.size >= EXPRESSION_CARD_LIMITS.types
    )
      continue;
    seenRecords.add(identity);
    let schema: RecordSchema;
    try {
      schema = registeredRecordSchema(record, {
        guildId: "000000000000000000",
        variables: {},
        recordSchemas: schemas,
      });
    } catch {
      continue;
    }
    const fields = Object.keys(schema.fields).slice(0, 100);
    if (
      schema.userConstructible &&
      fields.length === Object.keys(schema.fields).length
    ) {
      add(
        "record.build",
        "登録された項目をまとめる",
        "Build a registered record",
        record,
        fields.map((key) => argument(schema.fields[key]!.type, key, key)),
        { options: { fields } },
      );
      const writable = fields.filter(
        (key) => schema.fields[key]!.writable !== false,
      );
      if (writable.length)
        add(
          "record.update",
          "登録された項目を更新",
          "Update registered fields",
          record,
          [
            first(record),
            ...writable.map((key) =>
              argument(schema.fields[key]!.type, key, key),
            ),
          ],
          { options: { fields: writable } },
        );
    }
    for (const key of fields) {
      add(
        "record.field",
        `項目「${key}」を読む`,
        `Read field ${key}`,
        schema.fields[key]!.type,
        [first(record)],
        { options: { key } },
      );
      add(
        "list.group",
        `項目「${key}」ごとにまとめる`,
        `Group by ${key}`,
        listOf(groupRecordType(schema.fields[key]!.type, record)),
        [source(record)],
        { options: { key } },
      );
      add(
        "list.unique",
        `項目「${key}」の重複を除く`,
        `Remove duplicate ${key} values`,
        listOf(record),
        [source(record)],
        { options: { key } },
      );
      for (const [operator, ja, en] of [
        ["list.intersection", "両方にある項目", "Intersect by"],
        ["list.difference", "片方だけの項目", "Subtract by"],
        ["list.union", "重複なくまとめる", "Union by"],
      ] as const)
        add(
          operator,
          `${ja}「${key}」`,
          `${en} ${key}`,
          listOf(record),
          [source(record), source(record)],
          { options: { key } },
        );
      if (
        typeof schema.fields[key]!.type === "string" &&
        orderedTypes.has(String(schema.fields[key]!.type))
      )
        for (const descending of [false, true])
          add(
            "list.sort",
            descending ? `項目「${key}」で降順に` : `項目「${key}」で昇順に`,
            descending
              ? `Sort by ${key} descending`
              : `Sort by ${key} ascending`,
            listOf(record),
            [source(record)],
            { options: { key, descending } },
          );
    }
  }
  for (const definition of pureDefinitions) {
    if (
      !identifier.test(definition.id) ||
      !Number.isSafeInteger(definition.revision) ||
      definition.revision < 1 ||
      definition.inputs.length > 100
    )
      continue;
    add(
      "pure.call",
      definition.name,
      definition.name,
      definition.outputType,
      definition.inputs.map((input) =>
        argument(input.type, input.name, input.name),
      ),
      {
        options: { definitionId: definition.id, revision: definition.revision },
      },
    );
  }
  for (const key of ["PlainText" as const, ...types].filter(
    supportsFixedMappingKeyEditor,
  ))
    add(
      "value.lookup",
      "固定の対応表から値を選ぶ",
      "Look up a value in a fixed table",
      expectedType,
      [
        argument(key, "探すキー", "Lookup key"),
        argument(listOf(key), "固定のキー一覧", "Fixed mapping keys"),
        argument(
          expectedType,
          "対応がない場合の値",
          "Value when no key matches",
        ),
      ],
    );
  for (const card of temporalExpressionCards(expectedType, types))
    add(
      card.operator,
      card.label.ja,
      card.label.en,
      card.outputType,
      card.inputs,
      card,
    );
  const evaluationContext = {
    guildId: "000000000000000000",
    variables: Object.fromEntries(
      variables.map((variable) => [
        variable.id,
        {
          type: variable.type,
          value: null,
          provenance: [],
        } satisfies EvaluatedValue,
      ]),
    ),
    pureDefinitions: [...pureDefinitions],
    recordSchemas: schemas,
  };
  return cards.filter((card) => {
    let suffix = 0;
    const reserved = new Set(variables.map((variable) => variable.id));
    while (reserved.has(`card_item_${suffix}`)) suffix++;
    try {
      validateValueInput(
        instantiateExpressionCard(card, () => `card_item_${suffix}`),
        evaluationContext,
      );
      return true;
    } catch {
      return false;
    }
  });
}

/** Duplicate local expression bindings while preserving outer references and fixed pure revisions. */
export function cloneExpressionBindings(
  input: ValueInput,
  allocateId: () => string,
): ValueInput {
  const reserved = new Set<string>();
  let nodes = 0;
  const collect = (value: ValueInput, depth = 0) => {
    if (depth > 8 || ++nodes > 128) throw new Error("EXPRESSION_BINDING_DEPTH");
    if (value.kind === "variable") reserved.add(value.variableId);
    if (value.kind !== "expression") return;
    const id = value.expression.options?.bindingId;
    if (id) reserved.add(id);
    value.expression.args.forEach((child) => collect(child, depth + 1));
    if (value.expression.options?.body)
      collect(value.expression.options.body, depth + 1);
  };
  collect(input);
  const visit = (
    value: ValueInput,
    bindings: ReadonlyMap<string, string>,
  ): ValueInput => {
    if (value.kind === "variable")
      return {
        ...structuredClone(value),
        variableId: bindings.get(value.variableId) ?? value.variableId,
      };
    if (value.kind !== "expression") return structuredClone(value);
    const exp = value.expression,
      options = exp.options ? structuredClone(exp.options) : undefined;
    const args = exp.args.map((child) => visit(child, bindings));
    if (
      options?.body &&
      options.bindingId &&
      localOperators.has(exp.operator)
    ) {
      const replacement = bindingId(allocateId, reserved),
        local = new Map(bindings);
      local.set(options.bindingId, replacement);
      options.body = visit(options.body, local);
      options.bindingId = replacement;
    }
    return {
      kind: "expression",
      type: structuredClone(value.type),
      expression: {
        operator: exp.operator,
        args,
        ...(options ? { options } : {}),
      },
    };
  };
  return visit(input, new Map());
}
