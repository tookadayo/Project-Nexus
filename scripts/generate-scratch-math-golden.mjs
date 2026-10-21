/** Independent, test-only transcendental fixtures. No production/MPFR imports.
 * Run: node scripts/generate-scratch-math-golden.mjs [--preview|--check]
 * Exact binary64 dyadics become terminating decimal strings via BigInt; input
 * Number.toString(), Math transcendental functions, and production outputs are
 * never used as the oracle. See fixture.oracle.limitations before using it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { Buffer } from "node:buffer";
import Decimal from "../packages/automation/vendor/math-oracle/decimal.js-10.6.0/decimal.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUTPUT = resolve(ROOT, "tests/fixtures/scratch-math-golden.json");
const PROOF = resolve(ROOT, ".local/alpha15-scratch-math-golden-20261015");
const VENDOR = resolve(
  ROOT,
  "packages/automation/vendor/math-oracle/decimal.js-10.6.0",
);
const SCRIPT = fileURLToPath(import.meta.url);
const SIGN = 1n << 63n;
const FRACTION = (1n << 52n) - 1n;
const MAX = 0x7fefffffffffffffn;
const INF = 0x7ff0000000000000n;
const MASK = (1n << 64n) - 1n;
const PRECISE = [400, 800];
const OPERATORS = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "ln",
  "log",
  "exp",
  "exp10",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = (bits) => bits.toString(16).padStart(16, "0");
const fromNumber = (number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, number, false);
  return view.getBigUint64(0, false);
};
const rational = (n, d = 1n) => ({ n, d });
function dyadic(bits) {
  const magnitude = bits & ~SIGN,
    exponent = Number(magnitude >> 52n);
  assert(exponent !== 2047, "INPUT_MUST_BE_FINITE");
  const coefficient = (magnitude & FRACTION) + (exponent ? 1n << 52n : 0n);
  const power = exponent ? exponent - 1075 : -1074;
  const sign = bits & SIGN ? -1n : 1n;
  return power >= 0
    ? rational(sign * (coefficient << BigInt(power)))
    : rational(sign * coefficient, 1n << BigInt(-power));
}
function exactDecimalString({ n, d }) {
  if (n === 0n) return "0";
  // Every input and centered remainder is dyadic. d is exactly a power of two.
  assert(d > 0n && (d & (d - 1n)) === 0n, "DYADIC_DENOMINATOR_REQUIRED");
  const power = d.toString(2).length - 1;
  const coefficient = n * 5n ** BigInt(power);
  return `${coefficient}e-${power}`;
}
function decimalRational(value) {
  assert(value.isFinite(), "HIGH_PRECISION_RESULT_NONFINITE");
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(
    value.toString(),
  );
  assert(match, "DECIMAL_TEXT_INVALID");
  const digits = match[2] + (match[3] ?? ""),
    power = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  const coefficient = BigInt(digits) * (match[1] ? -1n : 1n);
  return power >= 0
    ? rational(coefficient * 10n ** BigInt(power))
    : rational(coefficient, 10n ** BigInt(-power));
}
const compareRational = (a, b) => {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
const addRational = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const negateRational = (value) => rational(-value.n, value.d);
function floorPositive(value) {
  assert(value.n >= 0n && value.d > 0n);
  let lower = 0n,
    upper = MAX;
  while (lower < upper) {
    const middle = (lower + upper + 1n) >> 1n;
    if (compareRational(dyadic(middle), value) <= 0) lower = middle;
    else upper = middle - 1n;
  }
  return { bits: lower, exact: compareRational(dyadic(lower), value) === 0 };
}
function nearestBits(value) {
  if (value.n === 0n) return 0n;
  const negative = value.n < 0n,
    magnitude = negative ? negateRational(value) : value;
  const floor = floorPositive(magnitude);
  if (floor.exact) return floor.bits | (negative ? SIGN : 0n);
  // Infinity's predecessor spacing is 2^971. Overflow starts at MAX+2^970.
  const next =
    floor.bits === MAX ? rational(1n << 1024n) : dyadic(floor.bits + 1n);
  const sum = addRational(dyadic(floor.bits), next),
    midpoint = rational(sum.n, sum.d * 2n);
  const order = compareRational(magnitude, midpoint);
  const rounded =
    order < 0 || (order === 0 && (floor.bits & 1n) === 0n)
      ? floor.bits
      : floor.bits + 1n;
  if (rounded === 0n) return 0n; // Public zero is always +0.
  return rounded | (negative ? SIGN : 0n);
}
function directedBits(value, mode) {
  if (value.n === 0n) return 0n;
  const negative = value.n < 0n,
    floor = floorPositive(negative ? negateRational(value) : value);
  const magnitude =
    floor.bits +
    (floor.exact
      ? 0n
      : (negative ? mode === "floor" : mode === "ceil")
        ? 1n
        : 0n);
  // Allowed outputs are finite. Intersect an interval crossing MAX with the
  // finite binary64 range; this never grants an Infinity output.
  return magnitude === 0n
    ? 0n
    : (magnitude > MAX ? MAX : magnitude) | (negative ? SIGN : 0n);
}
function fourUlpBounds(referenceBits) {
  const reference = dyadic(referenceBits),
    exponent = Number((referenceBits & ~SIGN) >> 52n);
  const power = exponent ? exponent - 1075 : -1074;
  const width =
    power >= 0
      ? rational(4n << BigInt(power))
      : rational(4n, 1n << BigInt(-power));
  return {
    lowerBits: hex(
      directedBits(addRational(reference, negateRational(width)), "ceil"),
    ),
    upperBits: hex(directedBits(addRational(reference, width), "floor")),
  };
}
function centeredDegrees(input) {
  // Signed remainder avoids rounding -MIN to 360 before argument reduction.
  let remainder = input.n % (360n * input.d);
  if (remainder > 180n * input.d) remainder -= 360n * input.d;
  if (remainder < -180n * input.d) remainder += 360n * input.d;
  return rational(remainder, input.d);
}
function knownExact(operator, input) {
  const is = (integer) => input.n === BigInt(integer) * input.d;
  if (["sin", "cos", "tan"].includes(operator)) {
    const centered = centeredDegrees(input);
    if (centered.n % (45n * centered.d) !== 0n) return null;
    const quadrant = Number(centered.n / (45n * centered.d));
    if (operator === "tan") {
      if (Math.abs(quadrant) === 2)
        return { error: "DomainError", reason: "exact-degree-pole" };
      if (quadrant % 4 === 0)
        return { value: 0, reason: "exact-degree-representative" };
      if (quadrant % 2 !== 0)
        return {
          value: quadrant === -3 || quadrant === 1 ? 1 : -1,
          reason: "exact-degree-representative",
        };
    }
    if (quadrant % 2 !== 0) return null;
    if (operator === "sin")
      return {
        value: quadrant === 2 ? 1 : quadrant === -2 ? -1 : 0,
        reason: "exact-degree-representative",
      };
    return {
      value: quadrant === 0 ? 1 : Math.abs(quadrant) === 4 ? -1 : 0,
      reason: "exact-degree-representative",
    };
  }
  if (operator === "asin" && (is(0) || is(1) || is(-1)))
    return {
      value: is(1) ? 90 : is(-1) ? -90 : 0,
      reason: "exact-inverse-endpoint",
    };
  if (operator === "acos" && (is(0) || is(1) || is(-1)))
    return {
      value: is(1) ? 0 : is(-1) ? 180 : 90,
      reason: "exact-inverse-endpoint",
    };
  if (operator === "atan" && (is(0) || is(1) || is(-1)))
    return {
      value: is(1) ? 45 : is(-1) ? -45 : 0,
      reason: "exact-inverse-representative",
    };
  if ((operator === "ln" || operator === "log") && is(1))
    return { value: 0, reason: "exact-logarithm-representative" };
  if (operator === "log" && (is(10) || is(100)))
    return { value: is(100) ? 2 : 1, reason: "exact-logarithm-representative" };
  if ((operator === "exp" || operator === "exp10") && is(0))
    return { value: 1, reason: "exact-exponential-representative" };
  return null;
}
function classify(operator, input) {
  if (
    (operator === "asin" || operator === "acos") &&
    (input.n < -input.d || input.n > input.d)
  )
    return "DomainError";
  if ((operator === "ln" || operator === "log") && input.n <= 0n)
    return "DomainError";
  // Safe monotonic cutoffs prevent pointless exp(MAX) computation. Narrow
  // boundary neighborhoods are evaluated normally at both precisions.
  if (operator === "exp") {
    if (input.n > 711n * input.d) return "NumericOverflow";
    if (input.n < -746n * input.d) return "NumericUnderflow";
  }
  if (operator === "exp10") {
    if (input.n > 310n * input.d) return "NumericOverflow";
    if (input.n < -326n * input.d) return "NumericUnderflow";
  }
  return null;
}
function createOracle(precision) {
  const D = Decimal.clone({
    precision,
    rounding: Decimal.ROUND_HALF_EVEN,
    minE: -1000000,
    maxE: 1000000,
  });
  const pi = D.acos(-1);
  const stats = { sineCalls: 0, cosineCalls: 0, maximumSeriesTerms: 0 };
  function trigSeries(x, cosine) {
    // Public decimal.js trig adds the argument's significant digits to its
    // requested precision, which would exceed its fixed1025-digit pi for an
    // 800-digit radian. Exact degree reduction has already bounded |x|<=pi, so
    // independently sum the entire sine/cosine series with Decimal arithmetic.
    // No angle range or requested precision is silently reduced.
    if (cosine) stats.cosineCalls++;
    else stats.sineCalls++;
    const square = x.times(x);
    let term = new D(cosine ? 1 : x),
      sum = term;
    for (let index = 1; index <= 2048; index++) {
      const first = cosine ? 2 * index - 1 : 2 * index;
      term = term
        .negated()
        .times(square)
        .div(first * (first + 1));
      const next = sum.plus(term);
      if (next.eq(sum)) {
        stats.maximumSeriesTerms = Math.max(
          stats.maximumSeriesTerms,
          index + 1,
        );
        return next;
      }
      sum = next;
    }
    throw Error("ORACLE_SERIES_DID_NOT_CONVERGE");
  }
  // Cutoff inequalities are checked without production/libm/MPFR results.
  assert(new D(711).exp().gt(new D((1n << 1024n).toString())));
  assert(
    new D(-746).exp().lt(new D(exactDecimalString(rational(1n, 1n << 1075n)))),
  );
  assert(new D(10).pow(310).gt(new D((1n << 1024n).toString())));
  assert(
    new D(10)
      .pow(-326)
      .lt(new D(exactDecimalString(rational(1n, 1n << 1075n)))),
  );
  const evaluate = (operator, inputBits) => {
    const input = dyadic(inputBits),
      classified = classify(operator, input);
    if (classified) return { error: classified };
    const exact = knownExact(operator, input);
    if (exact?.error)
      return { error: exact.error, exact: true, reason: exact.reason };
    if (exact)
      return {
        expectedBits: hex(fromNumber(exact.value)),
        exact: true,
        reason: exact.reason,
      };
    const x = new D(exactDecimalString(input));
    let value;
    if (["sin", "cos", "tan"].includes(operator)) {
      const reduced = new D(exactDecimalString(centeredDegrees(input)));
      const radians = reduced.times(pi).div(180);
      value =
        operator === "sin"
          ? trigSeries(radians, false)
          : operator === "cos"
            ? trigSeries(radians, true)
            : trigSeries(radians, false).div(trigSeries(radians, true));
    } else if (operator === "asin") value = x.asin().times(180).div(pi);
    else if (operator === "acos") value = x.acos().times(180).div(pi);
    else if (operator === "atan") value = x.atan().times(180).div(pi);
    else if (operator === "ln") value = x.ln();
    else if (operator === "log") value = x.logarithm(10);
    else if (operator === "exp") value = x.exp();
    else if (operator === "exp10") value = new D(10).pow(x);
    else throw Error("UNREGISTERED_ORACLE_OPERATOR");
    const real = decimalRational(value),
      bits = nearestBits(real);
    if ((bits & ~SIGN) === INF) return { error: "NumericOverflow" };
    if (bits === 0n && real.n !== 0n) return { error: "NumericUnderflow" };
    return { expectedBits: hex(bits), ...fourUlpBounds(bits) };
  };
  evaluate.stats = stats;
  return evaluate;
}

function corpus() {
  const cases = [],
    seen = new Set();
  const add = (operator, inputBits, label) => {
    assert((inputBits & ~SIGN) < INF, "FINITE_CORPUS_INPUT_ONLY");
    const key = `${operator}:${hex(inputBits)}`;
    if (!seen.has(key)) {
      seen.add(key);
      cases.push({
        id: `${operator}.${label}.${hex(inputBits)}`,
        operator,
        inputBits: hex(inputBits),
      });
    }
  };
  const number = (operator, input, label) =>
    add(operator, fromNumber(input), label);
  const around = (operator, input, label, radius = 1) => {
    const center = fromNumber(input);
    for (let offset = -radius; offset <= radius; offset++)
      add(operator, center + BigInt(offset), `${label}.${offset}`);
  };
  let seed = 0x6e65787573616c35n;
  const random = () => {
    seed ^= seed << 13n;
    seed ^= seed >> 7n;
    seed ^= seed << 17n;
    return (seed &= MASK);
  };
  const exponents = [
    0, 1, 2, 128, 512, 1022, 1023, 1024, 1536, 1792, 2045, 2046,
  ];
  const wide = exponents.flatMap((exponent) => {
    const bits = (BigInt(exponent) << 52n) | (random() & FRACTION);
    return [bits, bits | SIGN];
  });
  for (const operator of ["sin", "cos", "tan"]) {
    for (const input of [
      0, -0, 30, -30, 45, -45, 90, -90, 180, -180, 270, -270, 360, -360,
    ])
      number(operator, input, "representative");
    for (const bits of [1n, 28n, 29n, 100n, 0x0010000000000000n, MAX]) {
      add(operator, bits, "boundary");
      add(operator, bits | SIGN, "boundary");
    }
    for (const input of [90, -90, 180, 270])
      around(operator, input, "pole-neighbor");
    for (const bits of wide) add(operator, bits, "seeded-exponent");
  }
  for (const operator of ["asin", "acos"]) {
    for (const input of [0, -0, -1, -0.5, 0.5, 1])
      number(operator, input, "representative");
    for (const bits of [1n, 0x0010000000000000n, MAX]) {
      add(operator, bits, "boundary");
      add(operator, bits | SIGN, "boundary");
    }
    around(operator, 1, "domain-neighbor");
    around(operator, -1, "domain-neighbor");
    for (const bits of wide.slice(0, 16))
      add(operator, bits, "seeded-exponent");
  }
  for (const input of [0, -0, -1, 1, -0.5, 0.5])
    number("atan", input, "representative");
  for (const bits of [1n, 0x0010000000000000n, MAX, ...wide]) {
    add("atan", bits, "wide");
    add("atan", bits | SIGN, "wide");
  }
  for (const operator of ["ln", "log"]) {
    for (const input of [0, -0, -1, 1, 0.5, 2, 10, 100])
      number(operator, input, "representative");
    for (const bits of [1n, 0x0010000000000000n, MAX]) {
      add(operator, bits, "boundary");
      add(operator, bits | SIGN, "boundary");
    }
    around(operator, 1, "unit-neighbor");
    for (const bits of wide.filter((bits) => !(bits & SIGN)))
      add(operator, bits, "seeded-exponent");
  }
  for (const operator of ["exp", "exp10"]) {
    for (const input of [0, -0, -1, 1, -10, 2])
      number(operator, input, "representative");
    for (const bits of [1n, 0x0010000000000000n, MAX]) {
      add(operator, bits, "boundary");
      add(operator, bits | SIGN, "boundary");
    }
    const boundaries =
      operator === "exp"
        ? [709.782712893384, -745.1332191019411, -708.3964185322641]
        : [308.25471555991675, -323.60724533877976, -307.6526555685888];
    for (const boundary of boundaries)
      around(operator, boundary, "rounding-threshold", 2);
    for (const input of operator === "exp"
      ? [-746, -745, -710, 700, 710, 711]
      : [-326, -324, -323, 300, 309, 310])
      number(operator, input, "monotonic-cutoff");
  }
  assert(cases.length <= 400, `CORPUS_TOO_LARGE:${cases.length}`);
  return cases;
}

function selfChecks() {
  const checks = [];
  const check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name);
    checks.push(name);
  };
  check(
    "MIN input exact decimal to rational round-trip",
    nearestBits(decimalRational(new Decimal(exactDecimalString(dyadic(1n))))),
    1n,
  );
  check(
    "negative MIN remains signed through centered modulo",
    centeredDegrees(dyadic(SIGN | 1n)),
    dyadic(SIGN | 1n),
  );
  check(
    "MAX modulo 360 independent integer result",
    centeredDegrees(dyadic(MAX)),
    rational(128n),
  );
  check(
    "binary64 half-MIN rounds to positive zero ties-even",
    nearestBits(rational(1n, 1n << 1075n)),
    0n,
  );
  check(
    "three half-MIN rounds to even two-MIN",
    nearestBits(rational(3n, 1n << 1075n)),
    2n,
  );
  check(
    "binary64 unit midpoint ties-even",
    nearestBits(rational((1n << 53n) + 1n, 1n << 53n)),
    fromNumber(1),
  );
  check(
    "overflow midpoint rounds to infinity",
    nearestBits(rational((1n << 1024n) - (1n << 970n))),
    INF,
  );
  check(
    "four-ULP binade bound is eight downward neighbors",
    fourUlpBounds(fromNumber(1)),
    { lowerBits: "3feffffffffffff8", upperBits: "3ff0000000000004" },
  );
  check("zero/subnormal four-ULP width is four MIN", fourUlpBounds(0n), {
    lowerBits: "8000000000000004",
    upperBits: "0000000000000004",
  });
  check(
    "negative representative four-ULP direction",
    fourUlpBounds(fromNumber(-1)),
    { lowerBits: "bff0000000000004", upperBits: "bfeffffffffffff8" },
  );
  return checks;
}

async function main() {
  const started = performance.now(),
    preview = process.argv.includes("--preview"),
    verify = process.argv.includes("--check");
  assert(!(preview && verify), "CHOOSE_PREVIEW_OR_CHECK");
  const checks = selfChecks(),
    manifest = JSON.parse(
      await readFile(resolve(VENDOR, "manifest.json"), "utf8"),
    );
  assert.equal(
    manifest.sha256,
    "433210122e8149972f64054c54b0ce0872e5f15a3c5835aab57ff1a8e6d071b1",
  );
  const sourceHash = hash(await readFile(SCRIPT)),
    low = createOracle(PRECISE[0]),
    high = createOracle(PRECISE[1]);
  const allCases = corpus();
  const selected = preview
    ? allCases.filter(
        (row) =>
          ((row.operator === "sin" || row.operator === "tan") &&
            [
              "0000000000000001",
              "000000000000001c",
              "000000000000001d",
              "8000000000000001",
              "7fefffffffffffff",
            ].includes(row.inputBits)) ||
          ([
            "cos",
            "asin",
            "acos",
            "atan",
            "ln",
            "log",
            "exp",
            "exp10",
          ].includes(row.operator) &&
            row.inputBits ===
              (row.operator === "cos"
                ? "7fefffffffffffff"
                : row.operator === "asin" || row.operator === "atan"
                  ? "0000000000000001"
                  : row.operator === "acos"
                    ? "3fefffffffffffff"
                    : row.operator === "ln" || row.operator === "log"
                      ? "4000000000000000"
                      : "3ff0000000000000")),
      )
    : allCases;
  const cases = [];
  for (const row of selected) {
    const first = low(row.operator, BigInt(`0x${row.inputBits}`)),
      second = high(row.operator, BigInt(`0x${row.inputBits}`));
    assert.deepEqual(first, second, `PRECISION_DISAGREEMENT:${row.id}`);
    cases.push({ ...row, ...second });
    if (cases.length % 25 === 0)
      process.stdout.write(
        `oracle ${cases.length}/${selected.length} ${row.operator}\n`,
      );
  }
  const fixture = {
    schemaVersion: 1,
    oracle: {
      library: "decimal.js",
      version: "10.6.0",
      license: "MIT",
      sourceArtifactSha256: manifest.sha256,
      generatorSha256: sourceHash,
      precisions: PRECISE,
      precisionAgreement:
        "expected binary64 bits/error plus interval endpoints are identical at both precisions",
      input:
        "Exact signed binary64 dyadic converted using BigInt to a terminating decimal string; no Number.toString conversion.",
      degrees:
        "Signed exact BigInt modulo360 centered to [-180,180], then high-precision multiplication by pi/180. Inverse functions return degrees.",
      trigonometry:
        "Independent sine/cosine entire Taylor series using Decimal arithmetic on |radians|<=pi; stop when the sum is unchanged at the requested precision, at most2048 terms. tan=sin/cos. Avoids decimal.js public trig's precision+argument.sd pi-limit amplification without shrinking inputs/precision.",
      rounding:
        "Exact integer/rational binary64 round-to-nearest ties-to-even of the high-precision Decimal result; public zero normalized to +0.",
      fourUlp:
        "Correctly rounded binary64 reference r, abs(y-r)<=4*ulp(r), evaluated as exact rationals. ulp(r)=2^(floor(log2(abs(r)))-52), or 2^-1074 for zero/subnormal. lower/upper are ceil/floor of that absolute interval intersected with finite binary64 outputs, not four adjacent steps.",
      exact:
        "Entries marked exact require their stated representative value/pole exactly; no ULP tolerance supersedes domain or exact representatives.",
      limitations: [
        "Finite corpus and two-precision convergence are not proof over every finite input.",
        "Two precisions share decimal.js algorithms and constants; matching results cannot exclude shared-library defects.",
        "Decimal transcendental outputs are high-precision approximations, not formally directed real enclosures. Their converged binary64 rounding is an independent test reference, not a universal correct-rounding certificate.",
        "Fixed pi and ln10 constants have 1025 digits; requested400/800 significant digits plus internal guards remain below that limit.",
        "Existing abs/floor/ceiling/sqrt have separate evidence and are not included here.",
      ],
      sources: [
        "https://mikemcl.github.io/decimal.js/",
        "https://registry.npmjs.org/decimal.js/10.6.0",
      ],
    },
    corpus: {
      seed: "6e65787573616c35",
      selection: preview ? "preview" : "fixed full corpus",
      fullFiniteInputSpaceCovered: false,
      productionOutputInspectedToChooseExpectations: false,
    },
    cases,
  };
  const bytes = JSON.stringify(fixture, null, 2) + "\n",
    output = preview ? resolve(PROOF, "preview.json") : OUTPUT;
  await mkdir(dirname(output), { recursive: true });
  if (verify)
    assert.equal(
      await readFile(output, "utf8"),
      bytes,
      "GOLDEN_REGENERATION_MISMATCH",
    );
  else await writeFile(output, bytes);
  const proof = {
    mode: preview ? "preview" : verify ? "verify" : "generate",
    checkedAt: new Date().toISOString(),
    command: `node scripts/generate-scratch-math-golden.mjs${preview ? " --preview" : verify ? " --check" : ""}`,
    node: process.version,
    durationMs: performance.now() - started,
    generatorSha256: sourceHash,
    fixtureSha256: hash(bytes),
    fixtureBytes: Buffer.byteLength(bytes),
    output,
    totalCases: cases.length,
    counts: Object.fromEntries(
      OPERATORS.map((operator) => [
        operator,
        cases.filter((row) => row.operator === operator).length,
      ]),
    ),
    resultCounts: {
      expected: cases.filter((row) => row.expectedBits).length,
      domain: cases.filter((row) => row.error === "DomainError").length,
      overflow: cases.filter((row) => row.error === "NumericOverflow").length,
      underflow: cases.filter((row) => row.error === "NumericUnderflow").length,
    },
    precisionMatches: cases.length,
    series: { precision400: low.stats, precision800: high.stats },
    selfChecks: checks,
    artifact: manifest,
    vendorFiles: await Promise.all(
      ["decimal.mjs", "LICENCE.md"].map(async (name) => ({
        name,
        sha256: hash(await readFile(resolve(VENDOR, name))),
      })),
    ),
    limitations: fixture.oracle.limitations,
  };
  await mkdir(PROOF, { recursive: true });
  await writeFile(
    resolve(
      PROOF,
      preview
        ? "preview-proof.json"
        : verify
          ? "verify-proof.json"
          : "generation-proof.json",
    ),
    JSON.stringify(proof, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      mode: proof.mode,
      cases: proof.totalCases,
      durationMs: proof.durationMs,
      fixtureSha256: proof.fixtureSha256,
      counts: proof.counts,
      selfChecks: checks.length,
    }) + "\n",
  );
}

await main();
