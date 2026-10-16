import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCRATCH_UNICODE_PROFILE,
  assertUnicodeScalarText,
  splitGraphemes,
  graphemeBoundaries,
  graphemeLength,
  graphemeLetter,
  graphemeSlice,
  findGraphemeText,
  transformPinnedText,
  normalizePinnedText,
} from "../../packages/automation/src/scratch-unicode";
import manifest from "../../packages/automation/vendor/unicode-16.0.0/manifest.json";

const vendor = new URL(
  "../../packages/automation/vendor/unicode-16.0.0/",
  import.meta.url,
);
const source = (file: string) => readFileSync(new URL(file, vendor), "utf8");
const testLines = (file: string) =>
  source(file)
    .split(/\r?\n/)
    .map((line) => line.split("#")[0]!.trim())
    .filter((line) => line && !line.startsWith("@"));
const pointsText = (points: string) =>
  points
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
    .join("");

describe("fixed Unicode 16 profile", () => {
  it("pins every official source and generated table by byte hash", () => {
    expect(SCRATCH_UNICODE_PROFILE).toBe(
      "unicode-16.0.0-uax29-r45-default-egc-v1",
    );
    for (const file of [...manifest.sources, manifest.generated]) {
      const bytes = readFileSync(fileURLToPath(new URL(file.file, vendor)));
      expect(bytes.length, file.file).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(
        file.sha256,
      );
    }
  });

  it("passes every official GraphemeBreakTest-16.0.0 boundary case", () => {
    let count = 0;
    for (const line of testLines("auxiliary/GraphemeBreakTest.txt")) {
      const tokens = line.split(/\s+/);
      let text = "",
        offset = 0;
      const expected: number[] = [];
      for (const token of tokens) {
        if (token === "÷") expected.push(offset);
        else if (token !== "×") {
          const scalar = String.fromCodePoint(parseInt(token, 16));
          text += scalar;
          offset += scalar.length;
        }
      }
      const actual = graphemeBoundaries(text);
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(
          `GraphemeBreakTest case ${count + 1}: ${line}\nactual=${actual}; expected=${expected}`,
        );
      count++;
    }
    expect(count).toBe(1093);
  });

  it("passes all four forms and all invariants in official NormalizationTest-16.0.0", () => {
    let count = 0;
    const check = (
      input: string,
      expected: string,
      form: "NFC" | "NFD" | "NFKC" | "NFKD",
    ) => {
      const actual = normalizePinnedText(input, form);
      if (actual !== expected)
        throw new Error(
          `NormalizationTest case ${count + 1}, ${form}: ${JSON.stringify(input)} => ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`,
        );
    };
    for (const line of testLines("NormalizationTest.txt")) {
      const [c1, c2, c3, c4, c5] = line
        .split(";")
        .slice(0, 5)
        .map(pointsText) as [string, string, string, string, string];
      for (const value of [c1, c2, c3]) {
        check(value, c2, "NFC");
        check(value, c3, "NFD");
      }
      for (const value of [c4, c5]) {
        check(value, c4, "NFC");
        check(value, c5, "NFD");
      }
      for (const value of [c1, c2, c3, c4, c5]) {
        check(value, c4, "NFKC");
        check(value, c5, "NFKD");
      }
      count++;
    }
    expect(count).toBe(19965);
  }, 30000);

  it("rejects lone or reversed surrogates without replacing or normalizing text", () => {
    for (const text of ["\ud800", "a\udfff", "\udc00\ud800", "\ud800b"])
      expect(() => assertUnicodeScalarText(text)).toThrow(
        expect.objectContaining({ code: "InvalidUnicodeScalarText" }),
      );
    expect(() => assertUnicodeScalarText("\ud800\udc00")).not.toThrow();
    expect(splitGraphemes("e\u0301")).toEqual(["e\u0301"]);
  });

  it.each([
    ["e\u0301", ["e\u0301"]],
    ["\u0301a", ["\u0301", "a"]],
    ["👩🏽‍💻", ["👩🏽‍💻"]],
    ["🇯🇵🇺🇸🇩", ["🇯🇵", "🇺🇸", "🇩"]],
    ["\r\na\r\n", ["\r\n", "a", "\r\n"]],
    ["\u1100\u1161\u11a8", ["\u1100\u1161\u11a8"]],
    ["\u0915\u094d\u0937", ["\u0915\u094d\u0937"]],
    ["\u0915\u094d\u200d\u0937", ["\u0915\u094d\u200d\u0937"]],
  ])("keeps EGC boundaries for %s", (input, expected) => {
    expect(splitGraphemes(input as string)).toEqual(expected);
  });

  it("uses strict one-based EGC indices and boundary-aware find", () => {
    expect(graphemeLength("")).toBe(0);
    expect(graphemeLength("A😀e\u0301")).toBe(3);
    expect(graphemeLength("👨‍👩‍👧‍👦")).toBe(1);
    expect(graphemeLetter("A😀B", 2)).toBe("😀");
    expect(() => graphemeLetter("", 1)).toThrow(
      expect.objectContaining({ code: "IndexError" }),
    );
    expect(graphemeSlice("abc", 4, 0)).toBe("");
    const text = "e\u0301👩🏽‍💻x";
    expect(graphemeLength(text)).toBe(3);
    expect(graphemeLetter(text, 2)).toBe("👩🏽‍💻");
    expect(graphemeSlice(text, 2, 2)).toBe("👩🏽‍💻x");
    expect(graphemeSlice(text, 4, 0)).toBe("");
    expect(graphemeSlice("", 1, 0)).toBe("");
    expect(findGraphemeText(text, "e")).toBeNull();
    expect(findGraphemeText(text, "\u0301")).toBeNull();
    expect(findGraphemeText(text, "e\u0301")).toBe(1);
    expect(findGraphemeText(text, "👩🏽‍💻")).toBe(2);
    expect(findGraphemeText("", "")).toBe(1);
    for (const invalid of [0, -1, 1.5, 4, NaN])
      expect(() => graphemeLetter(text, invalid)).toThrow();
    expect(() => graphemeSlice(text, 3, 2)).toThrow();
    expect(() => graphemeSlice("", 1, 1)).toThrow();
  });

  it("has locale-neutral full casing, final sigma context, and full default case folding", () => {
    expect(transformPinnedText("Straße ﬃ", "upper")).toBe("STRASSE FFI");
    expect(
      transformPinnedText("İ I Σ ΟΣ ΟΣΑ AΣ\u0301 AΣ\u0301B Σ", "lower"),
    ).toBe("i\u0307 i σ ος οσα aς\u0301 aσ\u0301b σ");
    expect(transformPinnedText("Straße İ ς K ﬃ", "caseFold")).toBe(
      "strasse i\u0307 σ k ffi",
    );
    // Unicode 16 additions, independent of the host ICU/Unicode version.
    expect(transformPinnedText("\u{1c89}", "lower")).toBe("\u{1c8a}");
    expect(transformPinnedText("\u{1c8a}", "upper")).toBe("\u{1c89}");
    // Cased and Case_Ignorable overlap: the context's * is possessive.
    expect(
      transformPinnedText("\u0345Σ A\u0345Σ AΣ\u0345 AΣ\u0345B", "lower"),
    ).toBe("\u0345σ a\u0345ς aς\u0345 aσ\u0345b");
  });

  it("matches all official default full case-folding mappings and unconditional SpecialCasing entries", () => {
    let folding = 0,
      specialCasing = 0;
    for (const line of testLines("CaseFolding.txt")) {
      const [point, status, mapped] = line
        .split(";")
        .map((part) => part.trim());
      if (status !== "C" && status !== "F") continue;
      const input = pointsText(point!),
        expected = pointsText(mapped!);
      if (transformPinnedText(input, "caseFold") !== expected)
        throw new Error(`CaseFolding mismatch at ${point}`);
      folding++;
    }
    for (const line of testLines("SpecialCasing.txt")) {
      const [point, lower, , upper, condition = ""] = line
        .split(";")
        .map((part) => part.trim());
      if (condition) continue;
      const input = pointsText(point!);
      if (
        transformPinnedText(input, "lower") !== pointsText(lower!) ||
        transformPinnedText(input, "upper") !== pointsText(upper!)
      )
        throw new Error(`SpecialCasing mismatch at ${point}`);
      specialCasing++;
    }
    expect(folding).toBe(1557);
    expect(specialCasing).toBe(103);
  });

  it("normalizes only an explicitly selected form and never normalizes matching implicitly", () => {
    expect(transformPinnedText("e\u0301", "normalize", { form: "NFC" })).toBe(
      "é",
    );
    expect(transformPinnedText("①", "normalize", { form: "NFKC" })).toBe("1");
    expect(transformPinnedText("é", "normalize", { form: "NFD" })).toBe(
      "e\u0301",
    );
    expect(() => transformPinnedText("é", "normalize")).toThrow(
      expect.objectContaining({ code: "UnicodeModeRequired" }),
    );
    expect(findGraphemeText("é", "e\u0301")).toBeNull();
    expect(graphemeLength("e" + "\u0301")).toBe(1);
    expect(graphemeLength("\u0301e".repeat(2))).toBe(3);
    const folded = transformPinnedText("ßx", "caseFold");
    expect(graphemeLength(folded)).toBe(3);
    expect(findGraphemeText(folded, "x")).toBe(3);
    expect(
      findGraphemeText(
        transformPinnedText("e\u0301x", "normalize", { form: "NFC" }),
        "x",
      ),
    ).toBe(2);
  });

  it("trims exactly Unicode 16 White_Space and converts only registered CR/LF line endings", () => {
    expect(transformPinnedText("\u0085\u00a0\u3000x\u200a\t", "trim")).toBe(
      "x",
    );
    expect(transformPinnedText("\ufeffx\ufeff", "trim")).toBe("\ufeffx\ufeff");
    expect(
      transformPinnedText("a\r\nb\rc\n\u2028d", "lineEndings", {
        lineEnding: "LF",
      }),
    ).toBe("a\nb\nc\n\u2028d");
    expect(
      transformPinnedText("a\nb\rc\r\n", "lineEndings", { lineEnding: "CRLF" }),
    ).toBe("a\r\nb\r\nc\r\n");
    expect(() => transformPinnedText("a\nb", "lineEndings")).toThrow();
  });

  it("checks output and intermediate allocation budgets and propagates shared cancellation", () => {
    expect(() =>
      transformPinnedText("ß", "upper", { maxOutputCodeUnits: 1 }),
    ).toThrow(expect.objectContaining({ code: "UnicodeOutputLimitExceeded" }));
    expect(() =>
      normalizePinnedText("ﬃ", "NFKD", { maxIntermediateCodePoints: 2 }),
    ).toThrow(
      expect.objectContaining({ code: "UnicodeIntermediateLimitExceeded" }),
    );
    const cancelled = new Error("shared evaluation budget exhausted");
    expect(() =>
      splitGraphemes("e\u0301", {
        charge: () => {
          throw cancelled;
        },
      }),
    ).toThrow(cancelled);
    expect(() =>
      normalizePinnedText("abc", "NFC", {
        charge: () => {
          throw cancelled;
        },
      }),
    ).toThrow(cancelled);
  });

  it("honors intermediate scalar limits before segmentation, search, case and trim allocations", () => {
    const budget = { maxIntermediateCodePoints: 1 };
    for (const operation of [
      () => graphemeBoundaries("ab", budget),
      () => splitGraphemes("ab", budget),
      () => findGraphemeText("ab", "b", budget),
      () => findGraphemeText("a", "ab", budget),
      () => transformPinnedText("ab", "upper", budget),
      () => transformPinnedText("ab", "trim", budget),
      () =>
        transformPinnedText("\n", "lineEndings", {
          ...budget,
          lineEnding: "CRLF",
        }),
    ])
      expect(operation).toThrow(
        expect.objectContaining({ code: "UnicodeIntermediateLimitExceeded" }),
      );
    expect(splitGraphemes("😀", budget)).toEqual(["😀"]);
    expect(findGraphemeText("😀", "😀", budget)).toBe(1);
    expect(transformPinnedText("😀", "upper", budget)).toBe("😀");
    expect(transformPinnedText("😀", "trim", budget)).toBe("😀");
    expect(() => graphemeLetter("😀", 1, { maxOutputCodeUnits: 1 })).toThrow(
      expect.objectContaining({ code: "UnicodeOutputLimitExceeded" }),
    );
    expect(() => graphemeSlice("😀", 1, 1, { maxOutputCodeUnits: 1 })).toThrow(
      expect.objectContaining({ code: "UnicodeOutputLimitExceeded" }),
    );
  });

  it("keeps long repeated-prefix searches and long combining runs within deterministic work", () => {
    let searchWork = 0;
    const haystack = "a".repeat(10000) + "b";
    expect(
      findGraphemeText(haystack, "a".repeat(5000) + "b", {
        charge: (units) => {
          searchWork += units;
        },
      }),
    ).toBe(5001);
    expect(searchWork).toBeLessThan(50000);
    const marks = "\u0315\u0300".repeat(1000);
    const ordered = "a" + "\u0300".repeat(1000) + "\u0315".repeat(1000);
    let work = 0;
    expect(
      normalizePinnedText("a" + marks, "NFD", {
        charge: (units) => {
          work += units;
        },
      }),
    ).toBe(ordered);
    expect(work).toBe(4257);
  });
});
