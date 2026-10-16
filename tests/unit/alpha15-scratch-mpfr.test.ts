import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadScratchMpfrEngine, SCRATCH_MPFR_ARTIFACT } from "../../packages/automation/src/scratch-mpfr-loader.js";
import { reduceScratchDegrees, ScratchMpfrEngine, type ScratchMpfrBinding, type ScratchTranscendental } from "../../packages/automation/src/scratch-mpfr.js";
import { ScratchNumericError, withinScratchFourUlps } from "../../packages/automation/src/scratch-numeric.js";

let engine: ScratchMpfrEngine;
beforeAll(async () => { engine = await loadScratchMpfrEngine(); });
const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(16).padStart(16, "0"); };
function errorCode(op: ScratchTranscendental, value: number): string {
  try { engine.evaluate(op, value); return "success"; }
  catch (error) { if (error instanceof ScratchNumericError) return error.code; throw error; }
}

describe("pinned server MPFR directed interval adapter", () => {
  it("loads the pinned artifact once and exposes the fixed semantic profile", async () => {
    expect(await loadScratchMpfrEngine()).toBe(engine);
    expect(engine.profile).toBe("nexus-mpfr4.2.1-directed256-v1");
    expect(SCRATCH_MPFR_ARTIFACT.mpfrVersion).toBe("4.2.1");
  });
  it("uses exact degree endpoints, quadrants, negative symmetry and mathematical zero", () => {
    for (const [op, value, expected] of [
      ["sin", 0, 0], ["sin", -0, 0], ["sin", 90, 1], ["sin", -90, -1],
      ["sin", 180, 0], ["sin", 270, -1], ["sin", 360, 0],
      ["cos", 0, 1], ["cos", 90, 0], ["cos", 180, -1], ["cos", 270, 0],
      ["tan", 0, 0], ["tan", 45, 1], ["tan", 135, -1], ["tan", -45, -1], ["tan", 180, 0],
      ["asin", 0, 0], ["asin", 1, 90], ["asin", -1, -90],
      ["acos", 1, 0], ["acos", 0, 90], ["acos", -1, 180],
      ["atan", 0, 0], ["ln", 1, 0], ["log", 1, 0], ["exp", 0, 1], ["exp10", 0, 1],
    ] as const) expect(bits(engine.evaluate(op, value)), `${op}(${value})`).toBe(bits(expected));
  });
  it("evaluates all ten mathematical operations against exact or independently known identities", () => {
    for (const [op, value, reference] of [
      ["sin", 30, 0.5], ["cos", 60, 0.5], ["tan", 225, 1],
      ["asin", 0.5, 30], ["acos", -0.5, 120], ["atan", 1, 45],
      ["ln", 2, 0.6931471805599453], ["log", 100, 2],
      ["exp", 1, 2.718281828459045], ["exp10", 2, 100],
    ] as const) expect(withinScratchFourUlps(engine.evaluate(op, value), reference), `${op}(${value})`).toBe(true);
  });
  it("never converts a tiny negative degree to an approximate 360-degree input", () => {
    const reduction = reduceScratchDegrees("sin", -Number.MIN_VALUE);
    expect(reduction.numerator).toBe(1n);
    expect(reduction.denominator).toBe(1n << 1074n);
    expect(reduction.negative).toBe(true);
    expect(errorCode("sin", -Number.MIN_VALUE)).toBe("NumericUnderflow");
    const x = Number.MIN_VALUE * 100;
    expect(bits(engine.evaluate("sin", x))).toBe("0000000000000002");
    expect(bits(engine.evaluate("sin", -x))).toBe("8000000000000002");
    expect(bits(engine.evaluate("cos", -Number.MIN_VALUE))).toBe(bits(1));
  });
  it("preserves nonzero subnormal outputs for inverse trig and exponential functions", () => {
    expect(bits(engine.evaluate("asin", Number.MIN_VALUE))).toBe("0000000000000039");
    expect(bits(engine.evaluate("atan", -Number.MIN_VALUE))).toBe("8000000000000039");
    expect(bits(engine.evaluate("exp", -744))).toBe("0000000000000002");
    expect(bits(engine.evaluate("exp10", -323))).toBe("0000000000000002");
  });
  it("classifies domain, exact poles, nonzero underflow and overflow without epsilon", () => {
    for (const op of ["asin", "acos"] as const) for (const x of [-1.1, -1.0000000000000002, 1.0000000000000002, 1.1]) expect(errorCode(op, x)).toBe("DomainError");
    for (const op of ["ln", "log"] as const) for (const x of [0, -0, -Number.MIN_VALUE, -1]) expect(errorCode(op, x)).toBe("DomainError");
    for (const x of [90, -90, 270, -270, 450]) expect(errorCode("tan", x)).toBe("DomainError");
    expect(errorCode("exp", 710)).toBe("NumericOverflow");
    expect(errorCode("exp10", 309)).toBe("NumericOverflow");
    expect(errorCode("exp", -746)).toBe("NumericUnderflow");
    expect(errorCode("exp10", -324)).toBe("NumericUnderflow");
    for (const op of ["exp", "exp10"] as const) {
      expect(errorCode(op, Number.MAX_VALUE)).toBe("NumericOverflow");
      expect(errorCode(op, -Number.MAX_VALUE)).toBe("NumericUnderflow");
    }
    for (const x of [NaN, Infinity, -Infinity]) expect(errorCode("sin", x)).toBe("NumberRequired");
  });
  it("handles the maximum finite degree as an exact rational residue", () => {
    // MAX_VALUE = (2^53-1)*2^971; exact residue mod360 =128, mod180=128.
    for (const op of ["sin", "cos", "tan"] as const) {
      expect(bits(engine.evaluate(op, Number.MAX_VALUE))).toBe(bits(engine.evaluate(op, 128)));
      expect(bits(engine.evaluate(op, -Number.MAX_VALUE))).toBe(bits(engine.evaluate(op, -128)));
    }
  });
  it("isolates and restores the binding exponent range and exception flags", async () => {
    const library = createRequire(import.meta.url)(fileURLToPath(new URL("../../packages/automation/vendor/math-engine/gmp-wasm-1.3.2/index.cjs", import.meta.url))) as { init(): Promise<{ binding: ScratchMpfrBinding }> };
    const b = (await library.init()).binding;
    const old = [b.mpfr_get_emin(), b.mpfr_get_emax(), b.mpfr_flags_save()];
    b.mpfr_set_emin(-2000); b.mpfr_set_emax(2000); b.mpfr_flags_restore(37, 63);
    const isolated = new ScratchMpfrEngine(b);
    expect(isolated.evaluate("sin", 1)).toBeGreaterThan(0);
    expect([b.mpfr_get_emin(), b.mpfr_get_emax(), b.mpfr_flags_save()]).toEqual([-2000, 2000, 37]);
    expect(() => isolated.evaluate("exp", 710)).toThrow("NumericOverflow");
    expect([b.mpfr_get_emin(), b.mpfr_get_emax(), b.mpfr_flags_save()]).toEqual([-2000, 2000, 37]);
    isolated.dispose();
    b.mpfr_set_emin(old[0]!); b.mpfr_set_emax(old[1]!); b.mpfr_flags_restore(old[2]!, 63);
    expect(() => isolated.evaluate("sin", 1)).toThrow("NumericCertificationUnavailable");
  });
  it("refines an unresolved binary64 classification once and fails closed at the fixed precision limit", async () => {
    const library = createRequire(import.meta.url)(fileURLToPath(new URL("../../packages/automation/vendor/math-engine/gmp-wasm-1.3.2/index.cjs", import.meta.url))) as { init(): Promise<{ binding: ScratchMpfrBinding }> };
    const b = (await library.init()).binding;
    let conversions = 0;
    const retryBinding = Object.create(b) as ScratchMpfrBinding;
    retryBinding.mpfr_get_d = (p, rounding) => {
      conversions++;
      return conversions === 1 ? 0 : conversions === 2 ? Number.MIN_VALUE : b.mpfr_get_d(p, rounding);
    };
    const retry = new ScratchMpfrEngine(retryBinding);
    expect(withinScratchFourUlps(retry.evaluate("sin", 30), 0.5)).toBe(true);
    expect(conversions).toBe(4);
    retry.dispose();
    conversions = 0;
    const unresolvedBinding = Object.create(b) as ScratchMpfrBinding;
    unresolvedBinding.mpfr_get_d = () => ++conversions % 2 === 1 ? 0 : Number.MIN_VALUE;
    const unresolved = new ScratchMpfrEngine(unresolvedBinding);
    expect(() => unresolved.evaluate("sin", 30)).toThrow("NumericCertificationUnavailable");
    expect(conversions).toBe(4);
    unresolved.dispose();
  });
});
