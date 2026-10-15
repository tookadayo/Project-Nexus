"use client";
import type { ValueType } from "../../../../packages/automation/src/types";
import {
  registeredPairFields,
  registeredPairType,
} from "../../../../packages/automation/src/registered-pairs";
import { sameType, typeName, words, type Locale } from "./model";
import { WEEKDAY_TYPE } from "../../../../packages/automation/src/temporal-values";
import {
  groupRecordType,
  findMatchType,
} from "../../../../packages/automation/src/structured-values";
const atomicTypes: ValueType[] = [
  "RichTextSpec",
  "EmbedSpec",
  "LegacyMessageSpec",
  "Number",
  "Boolean",
  "PlainText",
  "Duration",
  "Instant",
  "DateOnly",
  "LocalTime",
  "ChannelRef",
  "RoleRef",
  "MemberRef",
  "TicketRef",
  "MessageRef",
  "ThreadRef",
  "TimeZone",
  "ConditionResult",
  "EventRef",
  "ZonedDateTimeSpec",
  "DateRange",
  "InstantRange",
  {
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
  { kind: "List", element: "Number" },
  { kind: "List", element: "ChannelRef" },
  { kind: "Record", schemaId: "nexus.ticket.status.v1" },
  { kind: "Record", schemaId: "MinMaxValue" },
  WEEKDAY_TYPE,
];
export function TypeSelect({
  value,
  onChange,
  locale,
  depth = 0,
  label,
  allowed,
}: {
  value: ValueType;
  onChange: (type: ValueType) => void;
  locale: Locale;
  depth?: number;
  label?: string;
  allowed?: ValueType[];
}) {
  const pair = registeredPairFields(value);
  const base = allowed ?? atomicTypes;
  const options = base.some((type) => sameType(type, value))
    ? base
    : [...base, value];
  return (
    <div className="automation-type-picker">
      <label>
        {label ?? words(locale, "型", "Type")}
        <select
          value={JSON.stringify(value)}
          onChange={(event) => {
            const type = base.find(
              (item) => JSON.stringify(item) === event.target.value,
            );
            if (type) onChange(type);
            else if (event.target.value === "list-wrapper")
              onChange({ kind: "List", element: "Number" });
            else if (event.target.value === "optional-wrapper")
              onChange({ kind: "Optional", value: "Number" });
            else if (event.target.value === "pair-wrapper")
              onChange(registeredPairType("Number", "Number")!);
            else if (event.target.value === "parse-wrapper")
              onChange({ kind: "ParseResult", value: "Number" });
            else if (event.target.value === "outcome-wrapper")
              onChange({ kind: "OperationOutcome", value: "Boolean" });
            else if (event.target.value === "group-wrapper")
              onChange({
                kind: "List",
                element: groupRecordType("PlainText", "Number"),
              });
            else if (event.target.value === "find-wrapper")
              onChange({ kind: "Optional", value: findMatchType("Number") });
          }}
        >
          {options.map((type) => (
            <option key={JSON.stringify(type)} value={JSON.stringify(type)}>
              {typeName(type, locale)}
            </option>
          ))}
          {!allowed && depth < 5 && (
            <>
              <option value="list-wrapper">
                {words(locale, "指定した種類の一覧", "List of a chosen type")}
              </option>
              <option value="optional-wrapper">
                {words(
                  locale,
                  "値がない場合もある種類",
                  "Optional value of a chosen type",
                )}
              </option>
              <option value="pair-wrapper">
                {words(locale, "二つの値の組", "Pair of two values")}
              </option>
              <option value="parse-wrapper">
                {words(
                  locale,
                  "文字から読み取った結果",
                  "Result of parsing text",
                )}
              </option>
              <option value="outcome-wrapper">
                {words(
                  locale,
                  "登録操作の結果",
                  "Result of a registered operation",
                )}
              </option>
              <option value="group-wrapper">
                {words(
                  locale,
                  "同じキーでまとめた一覧",
                  "List grouped by a typed key",
                )}
              </option>
              <option value="find-wrapper">
                {words(
                  locale,
                  "見つかった項目と位置",
                  "Found item and its position",
                )}
              </option>
            </>
          )}
        </select>
      </label>
      {pair && (
        <fieldset>
          <legend>
            {words(locale, "組にする値の種類", "Pair value types")}
          </legend>
          {(["first", "second"] as const).map((key) => (
            <div key={key}>
              <TypeSelect
                value={pair[key]}
                locale={locale}
                depth={depth + 1}
                label={words(
                  locale,
                  key === "first" ? "一つ目の値の種類" : "二つ目の値の種類",
                  key === "first" ? "First value type" : "Second value type",
                )}
                onChange={(next) => {
                  const type = registeredPairType(
                    key === "first" ? next : pair.first,
                    key === "second" ? next : pair.second,
                  );
                  if (type) onChange(type);
                }}
              />
            </div>
          ))}
          <p className="automation-hint">
            {words(
              locale,
              "二つの値はそれぞれ型を選びます。二つの一覧を組にするときは同じ件数が必要です。",
              "Choose a type for each value. Zipped lists must have the same length.",
            )}
          </p>
        </fieldset>
      )}
      {typeof value === "object" &&
        value.kind === "Record" &&
        value.typeArgs &&
        ["nexus.group.v1", "nexus.find-match.v1"].includes(value.schemaId) &&
        depth < 6 && (
          <fieldset>
            <legend>
              {words(
                locale,
                "登録された一覧結果の種類",
                "Registered list result types",
              )}
            </legend>
            {value.typeArgs.map((type, index) => (
              <TypeSelect
                key={index}
                value={type}
                locale={locale}
                depth={depth + 1}
                label={words(
                  locale,
                  value.schemaId === "nexus.group.v1" && index === 0
                    ? "グループのキーの種類"
                    : "項目の種類",
                  value.schemaId === "nexus.group.v1" && index === 0
                    ? "Group key type"
                    : "Item type",
                )}
                onChange={(next) =>
                  onChange({
                    ...value,
                    typeArgs: value.typeArgs!.map((old, i) =>
                      i === index ? next : old,
                    ),
                  })
                }
              />
            ))}
          </fieldset>
        )}
      {typeof value === "object" &&
        (value.kind === "List" ||
          value.kind === "Optional" ||
          value.kind === "ParseResult" ||
          value.kind === "OperationOutcome") &&
        depth < 6 && (
          <fieldset>
            <legend>
              {words(
                locale,
                value.kind === "List"
                  ? "一覧の項目の種類"
                  : value.kind === "Optional"
                    ? "値があるときの種類"
                    : "成功したときの値の種類",
                value.kind === "List"
                  ? "List item type"
                  : value.kind === "Optional"
                    ? "Type when a value is present"
                    : "Type of a successful value",
              )}
            </legend>
            <TypeSelect
              value={value.kind === "List" ? value.element : value.value}
              onChange={(type) =>
                onChange(
                  value.kind === "List"
                    ? { kind: "List", element: type }
                    : { kind: value.kind, value: type },
                )
              }
              locale={locale}
              depth={depth + 1}
            />
          </fieldset>
        )}
    </div>
  );
}
