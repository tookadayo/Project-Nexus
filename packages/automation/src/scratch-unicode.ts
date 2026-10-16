import rawData from "../vendor/unicode-16.0.0/generated.json" with { type: "json" };

/** This profile is immutable. A different Unicode release requires a new profile. */
export const SCRATCH_UNICODE_PROFILE =
  "unicode-16.0.0-uax29-r45-default-egc-v1";
export const SCRATCH_UNICODE_VERSION = "16.0.0";
type Range = readonly [number, number];
type Gcb =
  | "Other"
  | "CR"
  | "LF"
  | "Control"
  | "Extend"
  | "ZWJ"
  | "Regional_Indicator"
  | "Prepend"
  | "SpacingMark"
  | "L"
  | "V"
  | "T"
  | "LV"
  | "LVT";
const data = rawData as unknown as {
  gcb: readonly (readonly [number, number, Gcb])[];
  pictographic: readonly Range[];
  incbConsonant: readonly Range[];
  incbExtend: readonly Range[];
  incbLinker: readonly Range[];
  cased: readonly Range[];
  caseIgnorable: readonly Range[];
  whitespace: readonly Range[];
  upper: Readonly<Record<number, readonly number[]>>;
  lower: Readonly<Record<number, readonly number[]>>;
  fold: Readonly<Record<number, readonly number[]>>;
  ccc: Readonly<Record<number, number>>;
  decomp: Readonly<Record<number, readonly number[]>>;
  compose: Readonly<Record<string, number>>;
};

export class ScratchUnicodeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScratchUnicodeError";
  }
}
export interface ScratchUnicodeBudget {
  /** UTF-16 code units, independently of EGC count and transport UTF-8 bytes. */
  maxOutputCodeUnits?: number;
  /** Optional shared work budget; an exception cancels the operation. */
  charge?: (units: number) => void;
  /** Explicit temporary allocation budget, separate from the final output size. */
  maxIntermediateCodePoints?: number;
}
export interface PinnedTextOptions extends ScratchUnicodeBudget {
  form?: "NFC" | "NFD" | "NFKC" | "NFKD";
  lineEnding?: "LF" | "CRLF" | "CR";
}
function fail(code: string, message: string): never {
  throw new ScratchUnicodeError(code, message);
}
function outputCheck(length: number, budget?: ScratchUnicodeBudget): void {
  if (
    budget?.maxOutputCodeUnits !== undefined &&
    length > budget.maxOutputCodeUnits
  )
    fail(
      "UnicodeOutputLimitExceeded",
      "Unicode output exceeds the supplied capacity.",
    );
}
function intermediateCheck(
  length: number,
  budget?: ScratchUnicodeBudget,
): void {
  if (
    budget?.maxIntermediateCodePoints !== undefined &&
    length > budget.maxIntermediateCodePoints
  )
    fail(
      "UnicodeIntermediateLimitExceeded",
      "Unicode intermediate state exceeds the supplied capacity.",
    );
}
function intermediateTextCheck(
  text: string,
  budget?: ScratchUnicodeBudget,
): void {
  if (budget?.maxIntermediateCodePoints === undefined) return;
  let count = 0;
  for (let index = 0; index < text.length; count++) {
    intermediateCheck(count + 1, budget);
    index += text.codePointAt(index)! > 0xffff ? 2 : 1;
  }
}

/** Reject malformed UTF-16; never replace it or implicitly normalize it. */
export function assertUnicodeScalarText(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        fail(
          "InvalidUnicodeScalarText",
          "PlainText contains an unpaired high surrogate.",
        );
    } else if (cp >= 0xdc00 && cp <= 0xdfff)
      fail(
        "InvalidUnicodeScalarText",
        "PlainText contains an unpaired low surrogate.",
      );
  }
}
function inRanges(cp: number, ranges: readonly Range[]): boolean {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [first, last] = ranges[mid]!;
    if (cp < first) high = mid - 1;
    else if (cp > last) low = mid + 1;
    else return true;
  }
  return false;
}
function graphemeProperty(cp: number): Gcb {
  let low = 0,
    high = data.gcb.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [first, last, property] = data.gcb[mid]!;
    if (cp < first) high = mid - 1;
    else if (cp > last) low = mid + 1;
    else return property;
  }
  return "Other";
}
function control(property: Gcb): boolean {
  return property === "Control" || property === "CR" || property === "LF";
}

/** UTF-16 offsets of all EGC boundaries, including both ends (empty => [0]). */
export function graphemeBoundaries(
  text: string,
  budget?: ScratchUnicodeBudget,
): number[] {
  assertUnicodeScalarText(text);
  intermediateTextCheck(text, budget);
  const result = [0];
  let previous: Gcb = "Other",
    offset = 0,
    riCount = 0;
  let pictographicExtend = false,
    zwjAfterPictographic = false;
  // 0: no InCB consonant; 1: consonant + extends; 2: at least one linker.
  let indicState = 0;
  for (const scalar of text) {
    budget?.charge?.(1);
    const cp = scalar.codePointAt(0)!;
    const current = graphemeProperty(cp);
    const pictographic = inRanges(cp, data.pictographic);
    const consonant = inRanges(cp, data.incbConsonant);
    let boundary = offset > 0;
    if (previous === "CR" && current === "LF")
      boundary = false; // GB3
    else if (control(previous) || control(current)) {
      /* GB4/5 */
    } else if (previous === "L" && ["L", "V", "LV", "LVT"].includes(current))
      boundary = false; // GB6
    else if (
      (previous === "LV" || previous === "V") &&
      (current === "V" || current === "T")
    )
      boundary = false; // GB7
    else if ((previous === "LVT" || previous === "T") && current === "T")
      boundary = false; // GB8
    else if (
      current === "Extend" ||
      current === "ZWJ" ||
      current === "SpacingMark"
    )
      boundary = false; // GB9/9a
    else if (previous === "Prepend")
      boundary = false; // GB9b
    else if (consonant && indicState === 2)
      boundary = false; // GB9c
    else if (previous === "ZWJ" && zwjAfterPictographic && pictographic)
      boundary = false; // GB11
    else if (
      previous === "Regional_Indicator" &&
      current === "Regional_Indicator" &&
      riCount % 2 === 1
    )
      boundary = false; // GB12/13
    if (boundary) result.push(offset);
    zwjAfterPictographic = current === "ZWJ" && pictographicExtend;
    pictographicExtend =
      pictographic || (current === "Extend" && pictographicExtend);
    if (consonant) indicState = 1;
    else if (inRanges(cp, data.incbLinker)) indicState = indicState > 0 ? 2 : 0;
    else if (!inRanges(cp, data.incbExtend)) indicState = 0;
    riCount = current === "Regional_Indicator" ? riCount + 1 : 0;
    previous = current;
    offset += scalar.length;
  }
  if (offset > 0) result.push(offset);
  return result;
}
export function splitGraphemes(
  text: string,
  budget?: ScratchUnicodeBudget,
): string[] {
  outputCheck(text.length, budget);
  const boundaries = graphemeBoundaries(text, budget);
  return boundaries.slice(1).map((end, i) => text.slice(boundaries[i], end));
}
export function graphemeLength(
  text: string,
  budget?: ScratchUnicodeBudget,
): number {
  return graphemeBoundaries(text, budget).length - 1;
}
export function graphemeLetter(
  text: string,
  index: number,
  budget?: ScratchUnicodeBudget,
): string {
  const boundaries = graphemeBoundaries(text, budget);
  if (!Number.isSafeInteger(index) || index < 1 || index >= boundaries.length)
    fail("IndexError", "Letter index is outside the text.");
  const start = boundaries[index - 1]!,
    end = boundaries[index]!;
  outputCheck(end - start, budget);
  return text.slice(start, end);
}
export function graphemeSlice(
  text: string,
  start: number,
  count: number,
  budget?: ScratchUnicodeBudget,
): string {
  const boundaries = graphemeBoundaries(text, budget);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(count) ||
    start < 1 ||
    count < 0 ||
    start > boundaries.length ||
    count > boundaries.length - start
  )
    fail("IndexError", "Text slice is outside the text.");
  const from = boundaries[start - 1]!,
    to = boundaries[start - 1 + count]!;
  outputCheck(to - from, budget);
  return text.slice(from, to);
}
/** Scalar-exact match with both ends on EGC boundaries; one-based result. */
export function findGraphemeText(
  text: string,
  search: string,
  budget?: ScratchUnicodeBudget,
): number | null {
  assertUnicodeScalarText(search);
  intermediateTextCheck(search, budget);
  const boundaries = graphemeBoundaries(text, budget);
  if (search === "") return 1;
  const boundaryIndex = new Map(
    boundaries.map((offset, index) => [offset, index]),
  );
  // KMP keeps adversarial repeated-prefix searches linear. Scalar arrays also
  // keep the intermediate code-point budget independent of UTF-16 width.
  const needle = Array.from(search),
    haystack = Array.from(text);
  const prefix = new Array<number>(needle.length).fill(0);
  for (let i = 1, matched = 0; i < needle.length; i++) {
    budget?.charge?.(1);
    while (matched > 0 && needle[i] !== needle[matched]) {
      budget?.charge?.(1);
      matched = prefix[matched - 1]!;
    }
    if (needle[i] === needle[matched]) matched++;
    prefix[i] = matched;
  }
  for (let i = 0, matched = 0, offset = 0; i < haystack.length; i++) {
    budget?.charge?.(1);
    while (matched > 0 && haystack[i] !== needle[matched]) {
      budget?.charge?.(1);
      matched = prefix[matched - 1]!;
    }
    if (haystack[i] === needle[matched]) matched++;
    offset += haystack[i]!.length;
    if (matched === needle.length) {
      const start = offset - search.length;
      const index = boundaryIndex.get(start);
      if (index !== undefined && boundaryIndex.has(offset)) return index + 1;
      matched = prefix[matched - 1]!;
    }
  }
  return null;
}

function combiningClass(cp: number): number {
  return data.ccc[cp] ?? 0;
}
function hangulDecomposition(cp: number): number[] | undefined {
  const index = cp - 0xac00;
  if (index < 0 || index >= 11172) return undefined;
  const trailing = index % 28;
  const result = [
    0x1100 + Math.floor(index / 588),
    0x1161 + Math.floor((index % 588) / 28),
  ];
  if (trailing) result.push(0x11a7 + trailing);
  return result;
}
function composition(first: number, second: number): number | undefined {
  const l = first - 0x1100,
    v = second - 0x1161;
  if (l >= 0 && l < 19 && v >= 0 && v < 21) return 0xac00 + (l * 21 + v) * 28;
  const s = first - 0xac00,
    t = second - 0x11a7;
  if (s >= 0 && s < 11172 && s % 28 === 0 && t > 0 && t < 28) return first + t;
  return data.compose[`${first},${second}`];
}
function codePointsText(
  points: readonly number[],
  budget?: ScratchUnicodeBudget,
): string {
  const chunks: string[] = [];
  let size = 0;
  for (const cp of points) {
    size += cp > 0xffff ? 2 : 1;
    outputCheck(size, budget);
    chunks.push(String.fromCodePoint(cp));
  }
  return chunks.join("");
}
export function normalizePinnedText(
  text: string,
  form: "NFC" | "NFD" | "NFKC" | "NFKD",
  budget?: ScratchUnicodeBudget,
): string {
  assertUnicodeScalarText(text);
  if (!["NFC", "NFD", "NFKC", "NFKD"].includes(form))
    fail("UnicodeModeRequired", "Select a normalization form.");
  const compatibility = form === "NFKC" || form === "NFKD";
  const decomposed: number[] = [];
  for (const scalar of text) {
    const pending = [scalar.codePointAt(0)!];
    while (pending.length) {
      budget?.charge?.(1);
      const cp = pending.pop()!;
      const hangul = hangulDecomposition(cp);
      const map = data.decomp[cp];
      const expansion =
        hangul ??
        (map && (compatibility || map[0] === 0) ? map.slice(1) : undefined);
      if (expansion)
        for (let j = expansion.length - 1; j >= 0; j--)
          pending.push(expansion[j]!);
      else decomposed.push(cp);
      intermediateCheck(decomposed.length + pending.length, budget);
    }
  }
  // Stable canonical ordering. Fixed CCC buckets avoid quadratic insertion and
  // host-dependent sort-comparison counts in the shared logical work budget.
  for (let start = 0; start < decomposed.length;) {
    const marksStart =
      combiningClass(decomposed[start]!) === 0 ? start + 1 : start;
    let end = marksStart;
    while (end < decomposed.length && combiningClass(decomposed[end]!) !== 0)
      end++;
    let ordered = true;
    for (let j = marksStart + 1; j < end; j++)
      if (combiningClass(decomposed[j - 1]!) > combiningClass(decomposed[j]!)) {
        ordered = false;
        break;
      }
    if (!ordered) {
      budget?.charge?.(256 + end - marksStart);
      const buckets: number[][] = Array.from({ length: 256 }, () => []);
      for (let j = marksStart; j < end; j++)
        buckets[combiningClass(decomposed[j]!)]!.push(decomposed[j]!);
      let output = marksStart;
      for (const bucket of buckets)
        for (const cp of bucket) decomposed[output++] = cp;
    }
    start = end;
  }
  if (form === "NFD" || form === "NFKD")
    return codePointsText(decomposed, budget);
  const composed: number[] = [];
  let starterIndex = -1,
    lastClass = 0;
  for (const cp of decomposed) {
    budget?.charge?.(1);
    const currentClass = combiningClass(cp);
    const combined =
      starterIndex >= 0 ? composition(composed[starterIndex]!, cp) : undefined;
    if (combined !== undefined && (lastClass === 0 || lastClass < currentClass))
      composed[starterIndex] = combined;
    else {
      if (currentClass === 0) starterIndex = composed.length;
      composed.push(cp);
      lastClass = currentClass;
    }
  }
  return codePointsText(composed, budget);
}

function convertCase(
  text: string,
  mode: "upper" | "lower" | "caseFold",
  budget?: ScratchUnicodeBudget,
): string {
  intermediateTextCheck(text, budget);
  const points = Array.from(text, (scalar) => scalar.codePointAt(0)!);
  const casedBefore: boolean[] = [],
    casedAfter: boolean[] = [];
  let cased = false;
  for (let i = 0; i < points.length; i++) {
    const cp = points[i]!;
    casedBefore[i] = cased;
    if (!inRanges(cp, data.caseIgnorable)) cased = inRanges(cp, data.cased);
  }
  cased = false;
  for (let i = points.length - 1; i >= 0; i--) {
    const cp = points[i]!;
    casedAfter[i] = cased;
    if (!inRanges(cp, data.caseIgnorable)) cased = inRanges(cp, data.cased);
  }
  const map =
    mode === "upper" ? data.upper : mode === "lower" ? data.lower : data.fold;
  const result: number[] = [];
  let outputSize = 0;
  for (let i = 0; i < points.length; i++) {
    budget?.charge?.(1);
    const cp = points[i]!;
    const mapped =
      mode === "lower" && cp === 0x3a3 && casedBefore[i] && !casedAfter[i]
        ? [0x3c2]
        : (map[cp] ?? [cp]);
    for (const value of mapped) {
      outputSize += value > 0xffff ? 2 : 1;
      outputCheck(outputSize, budget);
      result.push(value);
    }
    intermediateCheck(result.length, budget);
  }
  return codePointsText(result, budget);
}

export function transformPinnedText(
  text: string,
  op: "upper" | "lower" | "caseFold" | "normalize" | "trim" | "lineEndings",
  options: PinnedTextOptions = {},
): string {
  assertUnicodeScalarText(text);
  if (op === "normalize") {
    if (!options.form)
      fail("UnicodeModeRequired", "Select a normalization form.");
    return normalizePinnedText(text, options.form, options);
  }
  if (op === "upper" || op === "lower" || op === "caseFold")
    return convertCase(text, op, options);
  if (op === "trim") {
    intermediateTextCheck(text, options);
    const scalars = Array.from(text);
    let start = 0,
      end = scalars.length;
    while (
      start < end &&
      inRanges(scalars[start]!.codePointAt(0)!, data.whitespace)
    ) {
      options.charge?.(1);
      start++;
    }
    while (
      end > start &&
      inRanges(scalars[end - 1]!.codePointAt(0)!, data.whitespace)
    ) {
      options.charge?.(1);
      end--;
    }
    const result = scalars.slice(start, end).join("");
    outputCheck(result.length, options);
    return result;
  }
  if (op === "lineEndings") {
    intermediateTextCheck(text, options);
    const ending =
      options.lineEnding === "LF"
        ? "\n"
        : options.lineEnding === "CRLF"
          ? "\r\n"
          : options.lineEnding === "CR"
            ? "\r"
            : undefined;
    if (ending === undefined)
      fail("UnicodeModeRequired", "Select a line-ending mode.");
    const chunks: string[] = [];
    let size = 0,
      points = 0;
    for (let i = 0; i < text.length;) {
      options.charge?.(1);
      let piece = String.fromCodePoint(text.codePointAt(i)!);
      i += piece.length;
      if (piece === "\r" || piece === "\n") {
        if (piece === "\r" && text[i] === "\n") i++;
        piece = ending;
        points += ending.length;
      } else {
        points++;
      }
      intermediateCheck(points, options);
      size += piece.length;
      outputCheck(size, options);
      chunks.push(piece);
    }
    return chunks.join("");
  }
  return fail("UnicodeModeRequired", "Unknown registered text transformation.");
}
