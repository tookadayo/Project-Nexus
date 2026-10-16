import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadScratchMpfrEngine } from "../../packages/automation/src/scratch-mpfr-loader.js";
import { type ScratchMpfrEngine, type ScratchTranscendental } from "../../packages/automation/src/scratch-mpfr.js";
import { ScratchNumericError, withinScratchFourUlps } from "../../packages/automation/src/scratch-numeric.js";

interface GoldenCase {
  id: string; operator: ScratchTranscendental; inputBits: string;
  expectedBits?: string; error?: string; exact?: boolean; lowerBits?: string; upperBits?: string;
}
const golden = JSON.parse(readFileSync(new URL("../fixtures/scratch-math-golden.json", import.meta.url), "utf8")) as {
  schemaVersion: number; oracle: { library: string; version: string; precisions: number[] };
  corpus: { productionOutputInspectedToChooseExpectations: boolean }; cases: GoldenCase[];
};
const fromBits = (bits: string): number => {
  const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, BigInt(`0x${bits}`)); return view.getFloat64(0);
};
const toBits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value); return view.getBigUint64(0).toString(16).padStart(16, "0");
};
let engine: ScratchMpfrEngine;
beforeAll(async () => { engine = await loadScratchMpfrEngine(); });

describe("independent decimal400/800 oracle versus pinned MPFR engine", () => {
  it("uses a fixed independent two-precision corpus rather than production-generated expectations", () => {
    expect(golden.schemaVersion).toBe(1);
    expect(golden.oracle.library).toBe("decimal.js");
    expect(golden.oracle.version).toBe("10.6.0");
    expect(golden.oracle.precisions).toEqual([400, 800]);
    expect(golden.corpus.productionOutputInspectedToChooseExpectations).toBe(false);
    expect(golden.cases).toHaveLength(396);
  });
  it.each(golden.cases)("$id", row => {
    const input = fromBits(row.inputBits);
    if (row.error) {
      let caught: unknown;
      try { engine.evaluate(row.operator, input); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ScratchNumericError);
      expect((caught as ScratchNumericError).code).toBe(row.error);
      return;
    }
    const actual = engine.evaluate(row.operator, input), reference = fromBits(row.expectedBits!);
    expect(Number.isFinite(actual)).toBe(true);
    // Classification and representative rules take priority over the 4-ULP interval,
    // which for tiny references can otherwise include zero or the opposite sign.
    if (reference === 0 || row.exact) expect(toBits(actual)).toBe(row.expectedBits);
    else {
      expect(actual).not.toBe(0);
      expect(actual < 0).toBe(reference < 0);
      expect(withinScratchFourUlps(actual, reference)).toBe(true);
      expect(actual).toBeGreaterThanOrEqual(fromBits(row.lowerBits!));
      expect(actual).toBeLessThanOrEqual(fromBits(row.upperBits!));
    }
  });
});
