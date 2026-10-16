import { describe, expect, it } from "vitest";
import { binary64Dyadic, exactDegreeResidue, rationalToBinary64, scratchDecimalRound, scratchMath, scratchMathAvailable, scratchModulo, scratchRound, scratchSquareRoot, withinScratchFourUlps, type ScratchMathOperator } from "../../packages/automation/src/scratch-numeric";
import { decimalFrom53Bits, evaluateRandomTape, nextDownBinary64, planRandomTape, prepareRandomTape, type RandomTapeInput, type RandomTapeMaterial } from "../../packages/automation/src/scratch-random";

const reservation = { id: "run/revision/block/loop:1", maxMaterialBytes: 100000, maxCandidateTrials: 10000 };
function bitsTape(values: { value: bigint; width: number }[]): Uint8Array {
  let bits = values.map(({ value, width }) => value.toString(2).padStart(width, "0")).join("");
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
  return Uint8Array.from(Array.from({ length: bits.length / 8 }, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
}
function material(input: RandomTapeInput, attempts: number, candidates: bigint[]): RandomTapeMaterial {
  const plan = planRandomTape(input, attempts);
  let index = 0;
  const tape = bitsTape(plan.bitWidths.flatMap(width => width === 0 ? [] : Array.from({ length: input.mode === "decimal" ? 1 : attempts }, () => ({ width, value: candidates[index++] ?? 0n }))));
  return prepareRandomTape(plan, reservation, () => tape);
}
function fromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, bits, false); return view.getFloat64(0, false);
}

describe("Scratch numeric profile: exact arithmetic and compatibility boundaries", () => {
  it("keeps explicit integer rounding modes and positive zero, including half neighbours", () => {
    const away = "tiesAwayFromZero", positive = "tiesTowardPositiveInfinity";
    expect(scratchRound(-1.5, away)).toBe(-2);
    expect(scratchRound(-1.5, positive)).toBe(-1);
    expect(scratchRound(-0.5, away)).toBe(-1);
    expect(Object.is(scratchRound(-0.5, positive), 0)).toBe(true);
    expect(scratchRound(nextDownBinary64(0.5), away)).toBe(0);
    expect(scratchRound(4503599627370495.5, positive)).toBe(4503599627370496);
    expect(() => scratchRound(1, undefined as never)).toThrow("RoundingModeRequired");
  });
  it("rounds shortest decimal rationals over the complete proposed digit range", () => {
    expect(scratchDecimalRound(1.005, 2, "tiesTowardPositiveInfinity")).toBe(1.01);
    expect(scratchDecimalRound(-1.005, 2, "tiesAwayFromZero")).toBe(-1.01);
    expect(scratchDecimalRound(-1.005, 2, "tiesTowardPositiveInfinity")).toBe(-1);
    expect(scratchDecimalRound(-1250, -2, "tiesAwayFromZero")).toBe(-1300);
    expect(scratchDecimalRound(-1250, -2, "tiesTowardPositiveInfinity")).toBe(-1200);
    expect(scratchDecimalRound(1234, -2, "tiesAwayFromZero")).toBe(1200);
    expect(scratchDecimalRound(Number.MIN_VALUE, 308, "tiesAwayFromZero")).toBe(0);
    expect(scratchDecimalRound(1e-308, 308, "tiesAwayFromZero")).toBe(1e-308);
    expect(scratchDecimalRound(1e308, -308, "tiesAwayFromZero")).toBe(1e308);
    expect(() => scratchDecimalRound(Number.MAX_VALUE, -308, "tiesAwayFromZero")).toThrow("NumericOverflow");
    for (const digits of [-309, 309, 1.5]) expect(() => scratchDecimalRound(1, digits, "tiesAwayFromZero")).toThrow("PrecisionRangeError");
  });
  it("retains exact zero, permits subnormal and distinguishes true underflow", () => {
    expect(rationalToBinary64(0n, 1n)).toBe(0);
    expect(rationalToBinary64(1n, 1n << 1074n)).toBe(Number.MIN_VALUE);
    expect(() => rationalToBinary64(1n, 1n << 1075n)).toThrow("NumericUnderflow");
    expect(rationalToBinary64(3n, 1n << 1075n)).toBe(Number.MIN_VALUE * 2);
    expect(() => rationalToBinary64(1n << 1024n, 1n)).toThrow("NumericOverflow");
    expect(rationalToBinary64((1n << 53n) + 1n, 1n << 53n)).toBe(1);
  });
  it("uses divisor-sign modulo without an overflowing quotient", () => {
    expect(scratchModulo(-7, 3)).toBe(2);
    expect(scratchModulo(7, -3)).toBe(-2);
    expect(Object.is(scratchModulo(-6, 3), 0)).toBe(true);
    expect(scratchModulo(Number.MAX_VALUE, Number.MIN_VALUE)).toBe(0);
    expect(scratchModulo(Number.MIN_VALUE * 3, Number.MIN_VALUE * 2)).toBe(Number.MIN_VALUE);
    expect(() => scratchModulo(1, 0)).toThrow("ZeroDivision");
  });
  it("rounds sqrt with exact midpoint comparison across finite binary64 boundaries", () => {
    expect(scratchSquareRoot(9)).toBe(3);
    expect(scratchSquareRoot(-0)).toBe(0);
    expect(scratchSquareRoot(2)).toBe(fromBits(0x3ff6a09e667f3bcdn));
    expect(scratchSquareRoot(Number.MIN_VALUE)).toBe(2 ** -537);
    expect(scratchSquareRoot(Number.MAX_VALUE)).toBe(fromBits(0x5fefffffffffffffn));
    expect(() => scratchSquareRoot(-Number.MIN_VALUE)).toThrow("DomainError");
    // Differential check complements, rather than replaces, the integer midpoint argument.
    for (let exponent = 0; exponent < 2047; exponent += 17) {
      for (const fraction of [0n, 1n, (1n << 51n) - 1n, (1n << 52n) - 1n]) {
        const value = fromBits((BigInt(exponent) << 52n) | fraction);
        expect(scratchSquareRoot(value)).toBe(Math.sqrt(value));
      }
    }
  });
  it("computes all-finite degree residues exactly and requires an explicit engine for transcendentals", () => {
    expect(exactDegreeResidue(90, 180)).toEqual({ numerator: 90n << 46n, denominator: 1n << 46n });
    const huge = exactDegreeResidue(Number.MAX_VALUE, 360);
    expect(huge.denominator).toBe(1n);
    expect(huge.numerator).toBe(BigInt(Number.MAX_VALUE) % 360n);
    expect(exactDegreeResidue(Number.MIN_VALUE, 360)).toEqual({ numerator: 1n, denominator: 1n << 1074n });
    const ops: ScratchMathOperator[] = ["abs", "floor", "ceiling", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "exp10"];
    expect(ops.filter(scratchMathAvailable)).toEqual(ops);
    for (const op of ops.slice(4)) expect(() => scratchMath(op, 1)).toThrow("NumericEngineUnavailable");
    expect(binary64Dyadic(1)).toEqual({ coefficient: 1n << 52n, exponent: -52 });
  });
  it("evaluates the specified ULP width across a power boundary, rather than counting four neighbours", () => {
    expect(withinScratchFourUlps(fromBits(0x3feffffffffffff8n), 1)).toBe(true);
    expect(withinScratchFourUlps(fromBits(0x3feffffffffffff7n), 1)).toBe(false);
    expect(withinScratchFourUlps(Number.MIN_VALUE * 4, 0)).toBe(true);
    expect(withinScratchFourUlps(Number.MIN_VALUE * 5, 0)).toBe(false);
    expect(withinScratchFourUlps(-Number.MIN_VALUE * 3, Number.MIN_VALUE)).toBe(true);
  });
});

describe("Scratch random tape: maximum width, bounded failure and replay", () => {
  it("selects both safe-integer endpoints and rejects the first out-of-range 54-bit candidate", () => {
    const lower = -Number.MAX_SAFE_INTEGER, upper = Number.MAX_SAFE_INTEGER, width = (1n << 54n) - 1n;
    expect(planRandomTape({ mode: "integer", lower, upper }, 2).bitWidths).toEqual([54]);
    expect(evaluateRandomTape(material({ mode: "integer", lower, upper }, 2, [0n, 0n]))).toMatchObject({ state: "SUCCEEDED", value: lower });
    expect(evaluateRandomTape(material({ mode: "integer", lower, upper }, 2, [width - 1n, 0n]))).toMatchObject({ state: "SUCCEEDED", value: upper });
    expect(evaluateRandomTape(material({ mode: "integer", lower, upper }, 2, [width, 0n]))).toEqual({ state: "SUCCEEDED", value: lower, consumedTrials: 2 });
  });
  it("handles widths 1, 2, 3, powers and power neighbours without entropy at width one", () => {
    for (const width of [1n, 2n, 3n, (1n << 48n) - 1n, 1n << 48n, (1n << 48n) + 1n, 1n << 53n]) {
      const m = material({ mode: "integer", lower: 0, upper: Number(width - 1n) }, 1, [width - 1n]);
      expect(evaluateRandomTape(m)).toMatchObject({ state: "SUCCEEDED", value: Number(width - 1n) });
    }
    const p = planRandomTape({ mode: "integer", lower: 7, upper: 7 }, 8);
    expect(prepareRandomTape(p, reservation, () => { throw Error("must not consume bits"); }).entropyHex).toBe("");
  });
  it("exhaustively counts success values equally and keeps exhausted failure separate", () => {
    const counts = new Map<number, number>(); let failures = 0;
    for (let first = 0n; first < 4n; first++) for (let second = 0n; second < 4n; second++) {
      const outcome = evaluateRandomTape(material({ mode: "integer", lower: 0, upper: 2 }, 2, [first, second]));
      if (outcome.state === "FAILED") failures++;
      else counts.set(outcome.value as number, (counts.get(outcome.value as number) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([5, 5, 5]); expect(failures).toBe(1);
  });
  it("fixes failure and result from serialized material without re-seeding or current variables", () => {
    const failed = material({ mode: "integer", lower: 0, upper: 2 }, 3, [3n, 3n, 3n]);
    expect(evaluateRandomTape(failed)).toEqual({ state: "FAILED", code: "RandomSamplingExhausted", consumedTrials: 3 });
    expect(evaluateRandomTape(JSON.parse(JSON.stringify(failed)))).toEqual(evaluateRandomTape(failed));
    const input: RandomTapeInput = { mode: "sample", candidates: ["original", "second"], count: 1 };
    const prepared = material(input, 1, [0n]); input.candidates[0] = "changed later";
    expect(evaluateRandomTape(prepared)).toEqual(evaluateRandomTape(JSON.parse(JSON.stringify(prepared))));
    expect(JSON.stringify(prepared)).not.toContain("changed later");
  });
  it("checks allocation and trials before asking for entropy, and validates persisted material", () => {
    let generated = false;
    const plan = planRandomTape({ mode: "integer", lower: 0, upper: 2 }, 4);
    expect(() => prepareRandomTape(plan, { ...reservation, maxMaterialBytes: 1 }, () => { generated = true; return new Uint8Array(); })).toThrow("RandomBudgetExceeded");
    expect(generated).toBe(false);
    expect(() => prepareRandomTape(plan, { ...reservation, maxCandidateTrials: 3 }, () => { generated = true; return new Uint8Array(); })).toThrow("RandomBudgetExceeded");
    expect(generated).toBe(false);
    const prepared = material({ mode: "integer", lower: 0, upper: 2 }, 1, [0n]);
    expect(() => evaluateRandomTape({ ...prepared, entropyHex: "ff00" })).toThrow("RandomMaterialInvalid");
    expect(() => evaluateRandomTape({ ...prepared, algorithm: "old" as never })).toThrow("RandomMaterialInvalid");
  });
  it("uses the winner's tape after competing preparation or lost acknowledgement", () => {
    const first = material({ mode: "integer", lower: 0, upper: 2 }, 1, [0n]);
    const second = material({ mode: "integer", lower: 0, upper: 2 }, 1, [2n]);
    const persisted = new Map<string, RandomTapeMaterial>();
    const commit = (candidate: RandomTapeMaterial) => { if (!persisted.has(candidate.reservationId)) persisted.set(candidate.reservationId, candidate); return persisted.get(candidate.reservationId)!; };
    commit(first); // acknowledgement lost after persistence
    expect(evaluateRandomTape(commit(second))).toEqual(evaluateRandomTape(first));
    expect(evaluateRandomTape(persisted.get(first.reservationId)!)).toMatchObject({ state: "SUCCEEDED", value: 0 });
    // This is a module contract test; production SQL atomicity is covered by runtime tests.
  });
  it("makes Fisher-Yates permutations and samples only from the fixed snapshot", () => {
    const results = new Set<string>();
    for (let first = 0n; first < 3n; first++) for (let second = 0n; second < 2n; second++) {
      const result = evaluateRandomTape(material({ mode: "shuffle", candidates: ["a", "b", "c"] }, 1, [first, second]));
      expect(result.state).toBe("SUCCEEDED"); if (result.state === "SUCCEEDED") results.add(JSON.stringify(result.value));
    }
    expect(results.size).toBe(6);
    expect(evaluateRandomTape(material({ mode: "sample", candidates: ["a", "b", "c"], count: 2 }, 1, [0n, 0n]))).toMatchObject({ state: "SUCCEEDED", value: ["b", "c"] });
    expect(evaluateRandomTape(material({ mode: "sample", candidates: ["a", "b", "c"], count: 0 }, 1, []))).toEqual({ state: "SUCCEEDED", value: [], consumedTrials: 0 });
    expect(evaluateRandomTape(material({ mode: "shuffle", candidates: [] }, 1, []))).toEqual({ state: "SUCCEEDED", value: [], consumedTrials: 0 });
    expect(() => planRandomTape({ mode: "sample", candidates: [], count: 1 }, 1)).toThrow("RandomInputInvalid");
  });
  it("interpolates decimals exactly over opposite maximum endpoints and adjacent values", () => {
    expect(decimalFrom53Bits(-Number.MAX_VALUE, Number.MAX_VALUE, 1n << 52n)).toBe(0);
    expect(decimalFrom53Bits(-Number.MAX_VALUE, Number.MAX_VALUE, 0n)).toBe(-Number.MAX_VALUE);
    const upper = 1 + Number.EPSILON;
    expect(decimalFrom53Bits(1, upper, (1n << 53n) - 1n)).toBe(1);
    expect(decimalFrom53Bits(Number.MIN_VALUE, Number.MIN_VALUE, 3n)).toBe(Number.MIN_VALUE);
    expect(() => decimalFrom53Bits(2, 1, 0n)).toThrow("RandomInputInvalid");
    expect(evaluateRandomTape(material({ mode: "decimal", lower: -Number.MAX_VALUE, upper: Number.MAX_VALUE }, 2, [1n << 52n]))).toMatchObject({ state: "SUCCEEDED", value: 0 });
  });
});
