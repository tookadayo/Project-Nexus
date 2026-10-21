# Fixed Unicode data for Scratch text profile

The implementation profile is `unicode-16.0.0-uax29-r45-default-egc-v1`.
It uses Unicode 16.0.0, UAX #29 revision 45 default extended grapheme
clusters (C1-1), and UAX #15 revision 56 normalization. No tailoring or
implicit normalization is applied. Unknown code points retain the properties
of unassigned code points in this release, even if a host has newer data.

Official references:

- <https://www.unicode.org/reports/tr29/tr29-45.html>
- <https://www.unicode.org/reports/tr15/tr15-56.html>
- <https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-3/>
- <https://www.unicode.org/Public/16.0.0/ucd/>

The original downloaded files, their URLs, byte lengths, and SHA-256 hashes
are recorded in `manifest.json`. Copyright and permission notices are retained
in the original files and `LICENSE.txt` (Unicode License V3). Data was obtained
from unicode.org on 2026-10-15. `generated.json` is a deterministic derivative,
not another upstream file. Only that 256,905-byte table enters the application
bundle; the original data and test files are development evidence.

Run `node packages/automation/vendor/unicode-16.0.0/generate.mjs` to reproduce
the table and manifest from the local source files. Regeneration requires no
network or installed package. A different Unicode release requires a new
semantic profile; do not update these data files in place for an existing Run.

Default full uppercase/lowercase conversion uses UnicodeData and unconditional
SpecialCasing plus the locale-neutral Final_Sigma context. Locale-specific
Lithuanian, Turkish, and Azeri rules are not selected. Full default case folding
uses CaseFolding statuses C/F, without Turkic T tailoring. Trim uses exactly the
Unicode 16 White_Space property; notably it does not trim U+FEFF. Line-ending
conversion accepts explicit LF/CRLF/CR targets and recognizes CRLF, CR, and LF
only. Normalization requires an explicit NFC/NFD/NFKC/NFKD form.

The runtime does not use Intl.Segmenter, host case conversion, host normalization,
locale defaults, Unicode property regular expressions, or an external service.
All operations reject malformed surrogate sequences. EGC indices are one-based.
Scalar-exact replace/split/contains remain distinct from EGC position operations;
they may change the visual composition of a grapheme.

The dedicated unit suite checks all 1,093 official GraphemeBreakTest cases and
all 19,965 NormalizationTest rows across the specified conformance equalities,
plus malformed UTF-16, EGC indices, Indic conjuncts, emoji, scalar/EGC boundary
differences, casing, trim, explicit modes, and shared resource budgets. These
finite tests do not claim exhaustive proof for every Unicode string or completion
of all NEXUS acceptance tests.
