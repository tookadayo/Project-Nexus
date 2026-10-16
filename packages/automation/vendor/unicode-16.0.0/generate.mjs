// Unicode data and derived tables are covered by LICENSE.txt in this directory.
// Regenerate with: node packages/automation/vendor/unicode-16.0.0/generate.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Buffer } from "node:buffer";

const root = dirname(fileURLToPath(import.meta.url));
const inputs = [
  "auxiliary/GraphemeBreakProperty.txt",
  "auxiliary/GraphemeBreakTest.txt",
  "emoji/emoji-data.txt",
  "DerivedCoreProperties.txt",
  "UnicodeData.txt",
  "SpecialCasing.txt",
  "CaseFolding.txt",
  "DerivedNormalizationProps.txt",
  "PropList.txt",
  "NormalizationTest.txt",
  "LICENSE.txt",
];
const source = (file) => readFileSync(join(root, file), "utf8");
const lines = (file) =>
  source(file)
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].trim())
    .filter((line) => line && !line.startsWith("@"));
const range = (value) => {
  const [first, last = first] = value.trim().split("..");
  return [parseInt(first, 16), parseInt(last, 16)];
};
const properties = (file, property, subproperty) =>
  lines(file)
    .flatMap((line) => {
      const [span, prop, sub] = line.split(";").map((part) => part.trim());
      return prop === property && (!subproperty || sub === subproperty)
        ? [range(span)]
        : [];
    })
    .sort((a, b) => a[0] - b[0]);
const mapping = (value) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((cp) => parseInt(cp, 16));
const gcb = lines("auxiliary/GraphemeBreakProperty.txt")
  .map((line) => {
    const [span, prop] = line.split(";").map((part) => part.trim());
    return [...range(span), prop];
  })
  .sort((a, b) => a[0] - b[0]);
const upper = {},
  lower = {},
  fold = {},
  ccc = {},
  decomp = {},
  compose = {};
const exclusions = properties(
  "DerivedNormalizationProps.txt",
  "Full_Composition_Exclusion",
);
const excluded = (cp) =>
  exclusions.some(([first, last]) => cp >= first && cp <= last);
for (const line of lines("UnicodeData.txt")) {
  const fields = line.split(";");
  const cp = parseInt(fields[0], 16);
  if (fields[3] !== "0") ccc[cp] = Number(fields[3]);
  if (fields[12]) upper[cp] = mapping(fields[12]);
  if (fields[13]) lower[cp] = mapping(fields[13]);
  if (fields[5]) {
    const compatibility = fields[5].startsWith("<");
    const parts = mapping(fields[5].replace(/^<[^>]+>\s*/, ""));
    decomp[cp] = [compatibility ? 1 : 0, ...parts];
    if (!compatibility && parts.length === 2 && !excluded(cp))
      compose[`${parts[0]},${parts[1]}`] = cp;
  }
}
for (const line of lines("SpecialCasing.txt")) {
  const [point, lo, , up, condition = ""] = line
    .split(";")
    .map((part) => part.trim());
  if (!condition) {
    const cp = parseInt(point, 16);
    lower[cp] = mapping(lo);
    upper[cp] = mapping(up);
  } else if (!/^(Final_Sigma|lt|tr|az)( |$)/.test(condition)) {
    throw new Error(`Unimplemented casing condition ${condition}`);
  }
}
for (const line of lines("CaseFolding.txt")) {
  const [point, status, value] = line.split(";").map((part) => part.trim());
  if (status === "C" || status === "F")
    fold[parseInt(point, 16)] = mapping(value);
}
const data = {
  version: "16.0.0",
  gcb,
  pictographic: properties("emoji/emoji-data.txt", "Extended_Pictographic"),
  incbConsonant: properties("DerivedCoreProperties.txt", "InCB", "Consonant"),
  incbExtend: properties("DerivedCoreProperties.txt", "InCB", "Extend"),
  incbLinker: properties("DerivedCoreProperties.txt", "InCB", "Linker"),
  cased: properties("DerivedCoreProperties.txt", "Cased"),
  caseIgnorable: properties("DerivedCoreProperties.txt", "Case_Ignorable"),
  whitespace: properties("PropList.txt", "White_Space"),
  upper,
  lower,
  fold,
  ccc,
  decomp,
  compose,
};
const json = JSON.stringify(data) + "\n";
writeFileSync(join(root, "generated.json"), json);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  unicodeVersion: "16.0.0",
  segmentation:
    "UAX #29 revision 45, default extended grapheme clusters (C1-1)",
  normalization: "UAX #15 revision 56",
  casing:
    "Unicode 16 default full case conversion, locale neutral; full default case folding",
  sources: inputs.map((file) => ({
    file,
    url:
      file === "LICENSE.txt"
        ? "https://www.unicode.org/license.txt"
        : `https://www.unicode.org/Public/16.0.0/ucd/${file}`,
    bytes: readFileSync(join(root, file)).length,
    sha256: sha256(readFileSync(join(root, file))),
  })),
  generated: {
    file: "generated.json",
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
  },
};
writeFileSync(
  join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
