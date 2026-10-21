import type { JsonValue } from "./types";
import { binary64Dyadic, rationalToBinary64 } from "./scratch-numeric";

export const SCRATCH_RANDOM_VERSION = "nexus-entropy-tape-v1" as const;
export type RandomTapeInput =
  | { mode: "integer"; lower: number; upper: number }
  | { mode: "decimal"; lower: number; upper: number }
  | { mode: "shuffle"; candidates: JsonValue[] }
  | { mode: "sample"; candidates: JsonValue[]; count: number };
export interface RandomTapePlan {
  algorithm: typeof SCRATCH_RANDOM_VERSION;
  input: RandomTapeInput;
  attemptLimit: number;
  /** Fixed sections, one per Fisher-Yates step or scalar selection. */
  bitWidths: number[];
  tapeBytes: number;
  reservedTrials: number;
}
export interface RandomTapeReservation {
  id: string;
  maxMaterialBytes: number;
  maxCandidateTrials: number;
}
/** Access-controlled resume data. Never send this material to execution logs. */
export interface RandomTapeMaterial extends RandomTapePlan {
  reservationId: string;
  entropyHex: string;
}
export type RandomTapeOutcome =
  | { state: "SUCCEEDED"; value: JsonValue; consumedTrials: number }
  | { state: "FAILED"; code: "RandomSamplingExhausted"; consumedTrials: number };
export class ScratchRandomError extends Error {
  constructor(readonly code: "RandomInputInvalid" | "RandomBudgetExceeded" | "RandomMaterialInvalid") {
    super(code); this.name = "ScratchRandomError";
  }
}
const invalid = () => { throw new ScratchRandomError("RandomInputInvalid"); };
const bitWidth = (width: bigint) => width === 1n ? 0 : (width - 1n).toString(2).length;
function positiveSafe(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function finite(value: number): boolean { return typeof value === "number" && Number.isFinite(value); }

/** Only plans/validates inputs. It does not generate or inspect random candidates. */
export function planRandomTape(input: RandomTapeInput, attemptLimit: number): RandomTapePlan {
  if (!positiveSafe(attemptLimit)) invalid();
  let widths: number[];
  if (input.mode === "integer" || input.mode === "decimal") {
    if (!finite(input.lower) || !finite(input.upper) || input.lower > input.upper) invalid();
    if (input.mode === "integer") {
      if (!Number.isSafeInteger(input.lower) || !Number.isSafeInteger(input.upper)) invalid();
      widths = [bitWidth(BigInt(input.upper) - BigInt(input.lower) + 1n)];
    } else widths = [input.lower === input.upper ? 0 : 53];
  } else if (input.mode === "shuffle" || input.mode === "sample") {
    if (!Array.isArray(input.candidates) || (input.mode === "sample" && (!Number.isSafeInteger(input.count) || input.count < 0 || input.count > input.candidates.length))) invalid();
    widths = input.mode === "sample" && input.count === 0 ? [] : Array.from({ length: Math.max(0, input.candidates.length - 1) }, (_, index) => bitWidth(BigInt(input.candidates.length - index)));
  } else return invalid();
  const nonzero = widths.filter(width => width > 0).length;
  const reservedTrials = input.mode === "decimal" ? nonzero : nonzero * attemptLimit;
  const bits = widths.reduce((sum, width) => sum + width * (input.mode === "decimal" ? 1 : attemptLimit), 0);
  if (!Number.isSafeInteger(bits) || !Number.isSafeInteger(reservedTrials)) throw new ScratchRandomError("RandomBudgetExceeded");
  // A caller-provided list snapshot must not change after planning or persistence.
  return { algorithm: SCRATCH_RANDOM_VERSION, input: structuredClone(input), attemptLimit, bitWidths: widths, tapeBytes: Math.ceil(bits / 8), reservedTrials };
}

/** Call only after reserving bytes/generation/trials for this dynamic key.
 * Persist the returned material uniquely BEFORE calling evaluateRandomTape.
 * A lost persistence acknowledgement must be reconciled, never re-seeded.
 */
export function prepareRandomTape(plan: RandomTapePlan, reservation: RandomTapeReservation, entropy: (bytes: number) => Uint8Array): RandomTapeMaterial {
  const expected = planRandomTape(plan.input, plan.attemptLimit);
  if (plan.algorithm !== expected.algorithm || plan.tapeBytes !== expected.tapeBytes || plan.reservedTrials !== expected.reservedTrials || JSON.stringify(plan.bitWidths) !== JSON.stringify(expected.bitWidths)) throw new ScratchRandomError("RandomMaterialInvalid");
  const shell = { ...expected, reservationId: reservation.id, entropyHex: "" };
  const materialBytes = new TextEncoder().encode(JSON.stringify(shell)).byteLength + 2 * plan.tapeBytes;
  if (!reservation.id || !positiveSafe(reservation.maxMaterialBytes) || !positiveSafe(reservation.maxCandidateTrials) || materialBytes > reservation.maxMaterialBytes || plan.reservedTrials > reservation.maxCandidateTrials) throw new ScratchRandomError("RandomBudgetExceeded");
  // Check before allocating or calling the bit source. No implicit RNG fallback.
  const tape = plan.tapeBytes === 0 ? new Uint8Array() : entropy(plan.tapeBytes);
  if (!(tape instanceof Uint8Array) || tape.byteLength !== plan.tapeBytes) throw new ScratchRandomError("RandomMaterialInvalid");
  return { ...shell, entropyHex: Array.from(tape, byte => byte.toString(16).padStart(2, "0")).join("") };
}
function readBits(hex: string, offset: number, length: number): bigint {
  let value = 0n;
  for (let index = 0; index < length; index++) {
    const position = offset + index, byte = Number.parseInt(hex.slice(Math.floor(position / 8) * 2, Math.floor(position / 8) * 2 + 2), 16);
    value = (value << 1n) | BigInt((byte >> (7 - position % 8)) & 1);
  }
  return value;
}
export function nextDownBinary64(value: number): number {
  if (!finite(value)) invalid();
  if (value === 0) return -Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, false);
  view.setBigUint64(0, view.getBigUint64(0, false) + (value > 0 ? -1n : 1n), false);
  return view.getFloat64(0, false);
}
/** Exact dyadic interpolation, followed by one binary64 rounding. */
export function decimalFrom53Bits(lower: number, upper: number, candidate: bigint): number {
  if (!finite(lower) || !finite(upper) || lower > upper || candidate < 0n || candidate >= 1n << 53n) invalid();
  if (lower === upper) return lower === 0 ? 0 : lower;
  const lo = binary64Dyadic(lower), hi = binary64Dyadic(upper), exponent = Math.min(lo.exponent, hi.exponent);
  const scale = 1n << 53n;
  const numerator = (lo.coefficient << BigInt(lo.exponent - exponent)) * (scale - candidate) + (hi.coefficient << BigInt(hi.exponent - exponent)) * candidate;
  let result = rationalToBinary64(exponent >= 0 ? numerator << BigInt(exponent) : numerator, exponent < 0 ? scale << BigInt(-exponent) : scale, true);
  if (result === upper) result = nextDownBinary64(upper);
  if (!(result >= lower && result < upper)) throw new ScratchRandomError("RandomMaterialInvalid");
  return result === 0 ? 0 : result;
}

/** Deterministic evaluation of already committed material. The caller must commit
 * outcome + consumed logical trials + next PC in one CAS/transaction. A crash
 * replays these same bytes and consumes the same reservation, never new entropy.
 * Terminal/cancel/deadline checks and actual CPU accounting belong to the store.
 */
export function evaluateRandomTape(material: RandomTapeMaterial): RandomTapeOutcome {
  const plan = planRandomTape(material.input, material.attemptLimit);
  if (material.algorithm !== SCRATCH_RANDOM_VERSION || !material.reservationId || JSON.stringify(material.bitWidths) !== JSON.stringify(plan.bitWidths) || material.tapeBytes !== plan.tapeBytes || material.reservedTrials !== plan.reservedTrials || !/^(?:[a-f0-9]{2})*$/.test(material.entropyHex) || material.entropyHex.length !== plan.tapeBytes * 2) throw new ScratchRandomError("RandomMaterialInvalid");
  const input = plan.input;
  if (input.mode === "decimal") return { state: "SUCCEEDED", value: decimalFrom53Bits(input.lower, input.upper, plan.bitWidths[0] === 0 ? 0n : readBits(material.entropyHex, 0, 53)), consumedTrials: plan.reservedTrials };
  let offset = 0, consumedTrials = 0;
  const choices: bigint[] = [];
  for (const [index, width] of plan.bitWidths.entries()) {
    if (width === 0) { choices.push(0n); continue; }
    const count = input.mode === "integer" ? BigInt(input.upper) - BigInt(input.lower) + 1n : BigInt(input.candidates.length - index);
    let accepted: bigint | undefined;
    for (let attempt = 0; attempt < plan.attemptLimit; attempt++) {
      const candidate = readBits(material.entropyHex, offset + attempt * width, width); consumedTrials++;
      if (candidate < count) { accepted = candidate; break; }
    }
    if (accepted === undefined) return { state: "FAILED", code: "RandomSamplingExhausted", consumedTrials };
    choices.push(accepted); offset += width * plan.attemptLimit;
  }
  if (input.mode === "integer") return { state: "SUCCEEDED", value: Number(BigInt(input.lower) + choices[0]!), consumedTrials };
  const values = structuredClone(input.candidates);
  for (const [index, candidate] of choices.entries()) {
    const tail = values.length - 1 - index, selected = Number(candidate);
    [values[tail], values[selected]] = [values[selected]!, values[tail]!];
  }
  return { state: "SUCCEEDED", value: input.mode === "sample" ? values.slice(0, input.count) : values, consumedTrials };
}
