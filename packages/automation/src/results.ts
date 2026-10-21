import type { JsonValue, Statement, ValueType } from "./types";
import { parseDateOnly } from "./datetime";

export type ConversionFormat = "decimal" | "dateSlash" | "enum";
export const PARSE_FAILURE_CODES = ["PARSE_NUMBER_FORMAT", "PARSE_NUMBER_RANGE", "PARSE_DATE_FORMAT", "PARSE_DATE_INVALID", "PARSE_ENUM_VALUE"] as const;
export function isParseTarget(type: ValueType): boolean {
  return type === "Number" || type === "DateOnly" || typeof type === "object" && type.kind === "Enum" && type.values.length > 0 && type.values.length <= 100 && new Set(type.values).size === type.values.length;
}
/** Registered formats are exact; no locale guessing, trimming or fallback value. */
export function parseRegisteredValue(type: ValueType, text: string, format: ConversionFormat): JsonValue {
  const failed = (reason: string): JsonValue => ({ state: "FAILED", reason });
  if (format === "decimal" && type === "Number") {
    if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return failed("PARSE_NUMBER_FORMAT");
    const value = Number(text);
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) return failed("PARSE_NUMBER_RANGE");
    return { state: "SUCCEEDED", value };
  }
  if (format === "dateSlash" && type === "DateOnly") {
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return failed("PARSE_DATE_FORMAT");
    try { return { state: "SUCCEEDED", value: parseDateOnly(text.replaceAll("/", "-")) }; }
    catch { return failed("PARSE_DATE_INVALID"); }
  }
  if (format === "enum" && typeof type === "object" && type.kind === "Enum")
    return type.values.includes(text) ? { state: "SUCCEEDED", value: text } : failed("PARSE_ENUM_VALUE");
  throw new Error("AUTOMATION_PARSE_FORMAT");
}
export const safeResultReason = (value: string) => /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : "ACTION_UNAVAILABLE";
/** UNKNOWN handlers can inspect and calculate only; they cannot escape to work. */
export function isUncertaintySafe(statement: Statement): boolean {
  return ["declare", "assign", "branch", "switch", "optionalBranch", "end"].includes(statement.kind) || statement.kind === "resultBranch" && typeof statement.value.type === "object" && statement.value.type.kind === "ParseResult";
}
