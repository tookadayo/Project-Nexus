import { binary64Dyadic, ScratchNumericError, type ScratchMathOperator } from "./scratch-numeric.js";

/** The minimal audited gmp-wasm C binding surface; no package or WASM is imported here. */
export interface ScratchMpfrBinding {
  mpfr_t(): number; mpfr_t_free(p: number): void;
  mpfr_init2(p: number, precision: number): void; mpfr_clear(p: number): void;
  mpfr_set_d(p: number, value: number, rounding: number): number;
  mpfr_set_str(p: number, text: number, base: number, rounding: number): number;
  mpfr_get_d(p: number, rounding: number): number;
  mpfr_set(p: number, value: number, rounding: number): number;
  mpfr_neg(p: number, value: number, rounding: number): number;
  mpfr_const_pi(p: number, rounding: number): number;
  mpfr_mul(p: number, a: number, b: number, rounding: number): number;
  mpfr_div(p: number, a: number, b: number, rounding: number): number;
  mpfr_sub(p: number, a: number, b: number, rounding: number): number;
  mpfr_mul_ui(p: number, value: number, factor: number, rounding: number): number;
  mpfr_div_ui(p: number, value: number, divisor: number, rounding: number): number;
  mpfr_ui_div(p: number, numerator: number, divisor: number, rounding: number): number;
  mpfr_sin(p: number, value: number, rounding: number): number;
  mpfr_cos(p: number, value: number, rounding: number): number;
  mpfr_tan(p: number, value: number, rounding: number): number;
  mpfr_asin(p: number, value: number, rounding: number): number;
  mpfr_acos(p: number, value: number, rounding: number): number;
  mpfr_atan(p: number, value: number, rounding: number): number;
  mpfr_log(p: number, value: number, rounding: number): number;
  mpfr_log10(p: number, value: number, rounding: number): number;
  mpfr_exp(p: number, value: number, rounding: number): number;
  mpfr_exp10(p: number, value: number, rounding: number): number;
  mpfr_get_emin(): number; mpfr_get_emax(): number;
  mpfr_set_emin(value: number): number; mpfr_set_emax(value: number): number;
  mpfr_flags_save(): number; mpfr_flags_restore(flags: number, mask: number): void;
  mpfr_clear_flags(): void;
  malloc_cstr(text: string): number; free(pointer: number): void;
}
export type ScratchTranscendental = Exclude<ScratchMathOperator, "abs" | "floor" | "ceiling" | "sqrt">;
export const SCRATCH_MPFR_PROFILE = "nexus-mpfr4.2.1-directed256-v1" as const;
const N = 0, U = 2, D = 3, FLAGS_ALL = 63;
const WIDE_EMIN = -1073741823, WIDE_EMAX = 1073741823;
const OPERATORS: readonly string[] = ["sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "exp10"];
type Pair = readonly [number, number];
type TrigReduction = { numerator: bigint; denominator: bigint; operation: "sin" | "cos" | "tan"; negative: boolean; reciprocal: boolean };
function endpointsWithinOneQuantum(low: number, high: number): boolean {
  const a = binary64Dyadic(low), b = binary64Dyadic(high), exponent = Math.min(a.exponent, b.exponent);
  const gap = (b.coefficient << BigInt(b.exponent - exponent)) - (a.coefficient << BigInt(a.exponent - exponent));
  return gap >= 0n && gap <= 1n;
}

/** Only exact dyadic arithmetic is used for reduction, including the sign of tiny inputs. */
export function reduceScratchDegrees(operator: "sin" | "cos" | "tan", value: number): TrigReduction {
  const dyadic = binary64Dyadic(value);
  const magnitude = dyadic.coefficient < 0n ? -dyadic.coefficient : dyadic.coefficient;
  const denominator = dyadic.exponent < 0 ? 1n << BigInt(-dyadic.exponent) : 1n;
  const numerator = dyadic.exponent >= 0 ? magnitude << BigInt(dyadic.exponent) : magnitude;
  const period = BigInt(operator === "tan" ? 180 : 360) * denominator;
  let residue = numerator % period, negative = operator !== "cos" && value < 0;
  let operation = operator, reciprocal = false;
  if (operator === "tan") {
    if (residue === 90n * denominator) throw new ScratchNumericError("DomainError");
    if (residue > 90n * denominator) { residue = period - residue; negative = !negative; }
    if (residue > 45n * denominator) { residue = 90n * denominator - residue; reciprocal = true; }
  } else {
    if (residue > 180n * denominator) {
      residue = period - residue;
      if (operator === "sin") negative = !negative;
    }
    if (residue > 90n * denominator) {
      residue = 180n * denominator - residue;
      if (operator === "cos") negative = !negative;
    }
    if (residue > 45n * denominator) {
      residue = 90n * denominator - residue;
      operation = operator === "sin" ? "cos" : "sin";
    }
  }
  return { numerator: residue, denominator, operation, negative, reciprocal };
}

/**
 * Isolated synchronous MPFR evaluator. Initialize once in the server, never from a client bundle.
 * All computations produce enclosing directed-rounding intervals; only certified binary64
 * endpoints are returned. No host transcendental operation or fallback participates.
 */
export class ScratchMpfrEngine {
  readonly profile = SCRATCH_MPFR_PROFILE;
  private active = false;
  private disposed = false;
  private readonly arenas = new Map<number, number[]>();
  constructor(private readonly b: ScratchMpfrBinding) {}

  dispose(): void {
    if (this.active) throw new Error("ScratchMpfrEngineBusy");
    for (const pointers of this.arenas.values()) for (const p of pointers) { this.b.mpfr_clear(p); this.b.mpfr_t_free(p); }
    this.arenas.clear(); this.disposed = true;
  }

  evaluate(operator: ScratchTranscendental, value: number): number {
    if (!Number.isFinite(value)) throw new ScratchNumericError("NumberRequired");
    if (this.active || this.disposed || !OPERATORS.includes(operator)) throw new ScratchNumericError("NumericCertificationUnavailable");
    const exact = this.special(operator, value);
    if (exact !== undefined) return exact;
    const b = this.b;
    const saved = { emin: b.mpfr_get_emin(), emax: b.mpfr_get_emax(), flags: b.mpfr_flags_save() };
    this.active = true;
    try {
      if (b.mpfr_set_emin(WIDE_EMIN) !== 0 || b.mpfr_set_emax(WIDE_EMAX) !== 0) throw new ScratchNumericError("NumericCertificationUnavailable");
      b.mpfr_clear_flags();
      for (const precision of [256, 512]) {
        const result = this.interval(operator, value, this.arena(precision));
        const low = b.mpfr_get_d(result[0], N), high = b.mpfr_get_d(result[1], N);
        if (Number.isNaN(low) || Number.isNaN(high) || low > high) throw new ScratchNumericError("NumericCertificationUnavailable");
        if (low === high) {
          if (!Number.isFinite(low)) throw new ScratchNumericError("NumericOverflow");
          if (low === 0) throw new ScratchNumericError("NumericUnderflow");
          return low;
        }
        // The true real answer is inside the unrounded enclosure. Its rounded endpoints
        // may span at most one of the smaller endpoint quanta. Choosing low then leaves
        // margin for the final half-quantum rounding, including binade boundaries, within
        // the required absolute 4*ulp(real answer) bound. This is deliberately stricter
        // than comparing two rounded numbers with the full four-ULP allowance.
        // Zero/infinity classification boundaries must be resolved independently.
        if (low !== 0 && high !== 0 && Number.isFinite(low) && Number.isFinite(high)
          && endpointsWithinOneQuantum(low, high)) return low;
      }
      throw new ScratchNumericError("NumericCertificationUnavailable");
    } finally {
      b.mpfr_set_emin(saved.emin); b.mpfr_set_emax(saved.emax);
      b.mpfr_flags_restore(saved.flags, FLAGS_ALL); this.active = false;
    }
  }

  private special(op: ScratchTranscendental, x: number): number | undefined {
    if ((op === "asin" || op === "acos") && (x < -1 || x > 1)) throw new ScratchNumericError("DomainError");
    if ((op === "ln" || op === "log") && x <= 0) throw new ScratchNumericError("DomainError");
    if ((op === "ln" || op === "log") && x === 1) return 0;
    if (op === "asin" && (x === -1 || x === 1)) return x * 90;
    if (op === "acos" && (x === -1 || x === 0 || x === 1)) return x === -1 ? 180 : x === 0 ? 90 : 0;
    if ((op === "asin" || op === "atan") && x === 0) return 0;
    if ((op === "exp" || op === "exp10") && x === 0) return 1;
    // Conservative exact input bounds prevent huge exp arguments from requesting
    // internal work proportional to their unbounded mathematical output exponent.
    if ((op === "exp" && x > 1024) || (op === "exp10" && x > 309)) throw new ScratchNumericError("NumericOverflow");
    if ((op === "exp" && x < -1075) || (op === "exp10" && x < -324)) throw new ScratchNumericError("NumericUnderflow");
    if (op === "sin" || op === "cos" || op === "tan") {
      const r = reduceScratchDegrees(op, x);
      if (r.numerator === 0n) {
        const result = r.operation === "cos" ? 1 : 0;
        return result === 0 ? 0 : r.negative ? -result : result;
      }
      if (op === "tan" && r.numerator === 45n * r.denominator) return r.negative ? -1 : 1;
    }
    return undefined;
  }

  private arena(precision: number): number[] {
    let pointers = this.arenas.get(precision);
    if (!pointers) {
      pointers = Array.from({ length: 12 }, () => {
        const p = this.b.mpfr_t(); this.b.mpfr_init2(p, precision); return p;
      });
      this.arenas.set(precision, pointers);
    }
    return pointers;
  }

  private interval(op: ScratchTranscendental, x: number, p: number[]): Pair {
    const b = this.b;
    const [input, piLow, piHigh, a, c, low, high, temp, oneEighty, spare] = p as [number, number, number, number, number, number, number, number, number, number];
    b.mpfr_const_pi(piLow, D); b.mpfr_const_pi(piHigh, U);
    if (op === "sin" || op === "cos" || op === "tan") {
      const r = reduceScratchDegrees(op, x);
      // Strip powers of two before setting the exact binary significand. The folded
      // residue of a binary64 angle has <= 54 significant bits, never a 360-tiny loss.
      let n = r.numerator, exponent = -(r.denominator.toString(2).length - 1);
      while (n !== 0n && (n & 1n) === 0n) { n >>= 1n; exponent++; }
      if (n.toString(2).length > 64) throw new ScratchNumericError("NumericCertificationUnavailable");
      const text = b.malloc_cstr(`${n.toString(2)}@${exponent}`);
      try { if (b.mpfr_set_str(input, text, 2, N) !== 0) throw new ScratchNumericError("NumericCertificationUnavailable"); }
      finally { b.free(text); }
      b.mpfr_mul(a, input, piLow, D); b.mpfr_div_ui(a, a, 180, D);
      b.mpfr_mul(c, input, piHigh, U); b.mpfr_div_ui(c, c, 180, U);
      if (r.operation === "cos") {
        b.mpfr_cos(low, c, D); b.mpfr_cos(high, a, U);
      } else {
        const f = r.operation === "sin" ? b.mpfr_sin : b.mpfr_tan;
        f(low, a, D); f(high, c, U);
      }
      if (r.reciprocal) {
        b.mpfr_ui_div(temp, 1, high, D); b.mpfr_ui_div(high, 1, low, U); b.mpfr_set(low, temp, N);
      }
      if (r.negative) {
        b.mpfr_neg(temp, high, D); b.mpfr_neg(high, low, U); b.mpfr_set(low, temp, N);
      }
      return [low, high];
    }
    if (op === "asin" || op === "acos" || op === "atan") {
      // Positive arguments make division by the pi enclosure monotone. Oddness and
      // acos(-x)=180-acos(x) are applied with outward subtraction after conversion.
      b.mpfr_set_d(input, x < 0 ? -x : x, N);
      const f = op === "asin" ? b.mpfr_asin : op === "acos" ? b.mpfr_acos : b.mpfr_atan;
      f(a, input, D); f(c, input, U);
      b.mpfr_mul_ui(a, a, 180, D); b.mpfr_div(low, a, piHigh, D);
      b.mpfr_mul_ui(c, c, 180, U); b.mpfr_div(high, c, piLow, U);
      if (x < 0) {
        if (op === "acos") {
          b.mpfr_set_d(oneEighty, 180, N);
          b.mpfr_sub(temp, oneEighty, high, D); b.mpfr_sub(spare, oneEighty, low, U);
          b.mpfr_set(low, temp, N); b.mpfr_set(high, spare, N);
        } else {
          b.mpfr_neg(temp, high, D); b.mpfr_neg(high, low, U); b.mpfr_set(low, temp, N);
        }
      }
      return [low, high];
    }
    b.mpfr_set_d(input, x, N);
    const f = op === "ln" ? b.mpfr_log : op === "log" ? b.mpfr_log10 : op === "exp" ? b.mpfr_exp : b.mpfr_exp10;
    f(low, input, D); f(high, input, U);
    return [low, high];
  }
}
