/** Versioned, deterministic binary64 helpers. No clock, entropy or host math library. */
export const SCRATCH_NUMERIC_VERSION = "nexus-binary64-exact-v1" as const;
export type ScratchRoundingMode = "tiesAwayFromZero" | "tiesTowardPositiveInfinity";
export type ScratchMathOperator = "abs" | "floor" | "ceiling" | "sqrt" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "ln" | "log" | "exp" | "exp10";
export type ScratchTranscendentalOperator = Exclude<ScratchMathOperator, "abs" | "floor" | "ceiling" | "sqrt">;
/** In-memory server capability. Never part of a saved definition or checkpoint. */
export type ScratchMathEvaluator = (operator: ScratchTranscendentalOperator, value: number) => number;
/** Host safety work reservation: measured MPFR mean / exact sqrt, with 2x retry headroom. */
export const SCRATCH_TRANSCENDENTAL_WORK = 32;
export class ScratchNumericError extends Error {
  constructor(readonly code: "NumericOverflow" | "NumericUnderflow" | "DomainError" | "ZeroDivision" | "PrecisionRangeError" | "RoundingModeRequired" | "NumericCertificationUnavailable" | "NumericEngineUnavailable" | "NumberRequired") {
    super(code);
    this.name = "ScratchNumericError";
  }
}
function finite(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ScratchNumericError("NumberRequired");
  return value === 0 ? 0 : value;
}
function modeRequired(mode: ScratchRoundingMode): void {
  if (mode !== "tiesAwayFromZero" && mode !== "tiesTowardPositiveInfinity") throw new ScratchNumericError("RoundingModeRequired");
}
const bitLength = (value: bigint) => value === 0n ? 0 : value.toString(2).length;
/** x = coefficient * 2**exponent, exactly, including subnormal inputs. */
export function binary64Dyadic(value: number): { coefficient: bigint; exponent: number } {
  finite(value);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false), exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  return { coefficient: ((bits >> 63n) === 0n ? 1n : -1n) * (exponent === 0 ? fraction : (1n << 52n) + fraction), exponent: exponent === 0 ? -1074 : exponent - 1075 };
}
/** Exact rational -> binary64, round to nearest, ties to even. */
export function rationalToBinary64(numerator: bigint, denominator: bigint, allowRoundedZero = false): number {
  if (denominator <= 0n) throw new ScratchNumericError("DomainError");
  if (numerator === 0n) return 0;
  const negative = numerator < 0n, n = negative ? -numerator : numerator;
  let exponent = bitLength(n) - bitLength(denominator);
  if (exponent >= 0 ? n < (denominator << BigInt(exponent)) : (n << BigInt(-exponent)) < denominator) exponent--;
  const quantum = Math.max(-1074, exponent - 52);
  const scaled = quantum < 0 ? n << BigInt(-quantum) : n;
  const divisor = quantum > 0 ? denominator << BigInt(quantum) : denominator;
  let quotient = scaled / divisor;
  const remainder = scaled % divisor;
  if (remainder * 2n > divisor || (remainder * 2n === divisor && (quotient & 1n) === 1n)) quotient++;
  const result = Number(quotient) * 2 ** quantum;
  if (!Number.isFinite(result)) throw new ScratchNumericError("NumericOverflow");
  if (result === 0 && !allowRoundedZero) throw new ScratchNumericError("NumericUnderflow");
  return result === 0 ? 0 : negative ? -result : result;
}
function dyadicToBinary64(coefficient: bigint, exponent: number, allowRoundedZero = false): number {
  return rationalToBinary64(exponent >= 0 ? coefficient << BigInt(exponent) : coefficient, exponent < 0 ? 1n << BigInt(-exponent) : 1n, allowRoundedZero);
}
/** Mathematical modulo, using the divisor sign, without overflowing a/b. */
export function scratchModulo(left: number, right: number): number {
  const a = binary64Dyadic(left), b = binary64Dyadic(right);
  if (b.coefficient === 0n) throw new ScratchNumericError("ZeroDivision");
  const exponent = Math.min(a.exponent, b.exponent);
  const x = a.coefficient << BigInt(a.exponent - exponent), y = b.coefficient << BigInt(b.exponent - exponent);
  let remainder = x % y;
  if (remainder !== 0n && (remainder < 0n) !== (y < 0n)) remainder += y;
  return dyadicToBinary64(remainder, exponent);
}
function roundRational(numerator: bigint, denominator: bigint, mode: ScratchRoundingMode): bigint {
  modeRequired(mode);
  const negative = numerator < 0n, magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twice = (magnitude % denominator) * 2n;
  if (twice > denominator || (twice === denominator && (!negative || mode === "tiesAwayFromZero"))) quotient++;
  return negative ? -quotient : quotient;
}
export function scratchRound(value: number, mode: ScratchRoundingMode): number {
  const dyadic = binary64Dyadic(value);
  const integer = roundRational(dyadic.exponent >= 0 ? dyadic.coefficient << BigInt(dyadic.exponent) : dyadic.coefficient, dyadic.exponent < 0 ? 1n << BigInt(-dyadic.exponent) : 1n, mode);
  const rounded = Number(integer);
  if (!Number.isFinite(rounded)) throw new ScratchNumericError("NumericOverflow");
  return rounded === 0 ? 0 : rounded;
}
/** ECMAScript shortest round-trip decimal, then exact decimal rounding. */
export function scratchDecimalRound(value: number, digits: number, mode: ScratchRoundingMode): number {
  finite(value); modeRequired(mode);
  if (!Number.isInteger(digits) || digits < -308 || digits > 308) throw new ScratchNumericError("PrecisionRangeError");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value))!;
  let coefficient = BigInt(match[2]! + (match[3] ?? ""));
  if (match[1]) coefficient = -coefficient;
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0) + digits;
  const rounded = roundRational(exponent >= 0 ? coefficient * 10n ** BigInt(exponent) : coefficient, exponent < 0 ? 10n ** BigInt(-exponent) : 1n, mode);
  return rationalToBinary64(digits < 0 ? rounded * 10n ** BigInt(-digits) : rounded, digits > 0 ? 10n ** BigInt(digits) : 1n, true);
}
function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(bitLength(value) / 2));
  while (true) {
    const next = (estimate + value / estimate) / 2n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}
/** Correct rounding decided by integer comparison against the exact midpoint squared. */
export function scratchSquareRoot(value: number): number {
  const dyadic = binary64Dyadic(value);
  if (dyadic.coefficient < 0n) throw new ScratchNumericError("DomainError");
  if (dyadic.coefficient === 0n) return 0;
  const exponent = bitLength(dyadic.coefficient) - 1 + dyadic.exponent;
  const quantum = Math.floor(exponent / 2) - 52, shift = dyadic.exponent - 2 * quantum;
  const numerator = shift >= 0 ? dyadic.coefficient << BigInt(shift) : dyadic.coefficient;
  const denominator = shift < 0 ? 1n << BigInt(-shift) : 1n;
  let quotient = integerSquareRoot(numerator / denominator);
  const midpoint = denominator * (2n * quotient + 1n) ** 2n, scaled = 4n * numerator;
  if (scaled > midpoint || (scaled === midpoint && (quotient & 1n) === 1n)) quotient++;
  return Number(quotient) * 2 ** quantum;
}
/** Exact periodic residue for a future certified degree engine; never epsilon based. */
export function exactDegreeResidue(value: number, period: 180 | 360): { numerator: bigint; denominator: bigint } {
  const dyadic = binary64Dyadic(value);
  const denominator = dyadic.exponent < 0 ? 1n << BigInt(-dyadic.exponent) : 1n;
  const numerator = dyadic.exponent >= 0 ? dyadic.coefficient << BigInt(dyadic.exponent) : dyadic.coefficient;
  const modulus = BigInt(period) * denominator;
  return { numerator: ((numerator % modulus) + modulus) % modulus, denominator };
}
/** Acceptance metric abs(y-r) <= 4*ulp(r), evaluated exactly. This is not
 * a four-adjacent-floats metric, nor a substitute for domain/underflow checks. */
export function withinScratchFourUlps(actual: number, reference: number): boolean {
  const a = binary64Dyadic(actual), r = binary64Dyadic(reference);
  const commonExponent = Math.min(a.exponent, r.exponent);
  const difference = (a.coefficient << BigInt(a.exponent - commonExponent)) - (r.coefficient << BigInt(r.exponent - commonExponent));
  return (difference < 0n ? -difference : difference) <= (4n << BigInt(r.exponent - commonExponent));
}
export function scratchMathAvailable(operator: ScratchMathOperator): boolean {
  return ["abs", "floor", "ceiling", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "exp10"].includes(operator);
}
/** Transcendentals require the explicitly supplied fixed server engine. */
export function scratchMath(operator: ScratchMathOperator, value: number, evaluate?: ScratchMathEvaluator): number {
  finite(value);
  switch (operator) {
    case "abs": return value < 0 ? -value : value === 0 ? 0 : value;
    case "floor": return Math.floor(value) || 0;
    case "ceiling": return Math.ceil(value) || 0;
    case "sqrt": return scratchSquareRoot(value);
    default:
      if (!evaluate) throw new ScratchNumericError("NumericEngineUnavailable");
      return finite(evaluate(operator, value));
  }
}
