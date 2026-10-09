# Private legal review inputs

The public repository does not include legal review drafts, original file hashes,
owner details or real contact addresses. The public Terms, Privacy and related
routes remain availability pages. They are not agreement or consent targets.

Only the separate authenticated operator server loads candidate documents. Set
`NEXUS_LEGAL_REVIEW_MANIFEST` to an absolute path to an owner-managed JSON manifest
outside the repository. Leave it unset to keep candidate review unavailable.
There is no built-in document, fixture or public-route fallback.

The manifest and its four Markdown inputs must be in the same private directory.
Input file names must be basenames, not paths. Keep this directory out of source
control, static assets, backups intended for sharing and Site exports. Restrict
local read/write access appropriately: the explicitly configured manifest is the
trust source for hashes and extraction instructions. Updating it is an intentional
local review-input change, not a publication operation.

## Manifest format

The strict JSON structure is described by `LegalReviewManifest` in
`apps/operator/src/legal-candidates.ts`:

- `schemaVersion`: `1`
- `status`: `UNPUBLISHED_REVIEW_ONLY`
- `sources`: exactly `ja`, `en`, `conditions` and `announcements`. Each contains
  `fileName` (Markdown basename), `bytes` (exact byte count, at most 2 MiB) and
  `sha256` (the 64-character lowercase SHA-256 of that local file).
- `layouts`: exactly `ja` and `en`, each with the fields below.
- `reviewVersion`, `reviewDate` (ISO date), `presentationRevision`: review metadata,
  separate from the contractual version, effective date and operator settings.

Each language layout contains:

- `boundaries`: unique, complete marker lines for `terms`, `privacy` and `beta`,
  in that order, each ending with a newline. `appendix` is also required for the
  Japanese input; it is optional for English. Text before the first boundary is
  the source introduction. Original newlines and blank lines are preserved.
- `sections`: `terms` and `privacy`, each containing the literal `prefix` and
  `suffix` surrounding its numbered heading. These are literal text, not regular
  expressions. Terms must contain consecutive sections 1–12; Privacy 1–14.
- `editorial`: `terms`, `privacy` and `beta`, each an array of exact editorial
  spans to move out of that document's body. Use an empty array when none exist.
  Each listed span must occur exactly once in that body.

The loader preserves the introduction, document editorial spans, Japanese
appendix and two supporting notes as separate operator-only review notes. English
review retains the Japanese-note locale; no translation is generated. The existing
presentation layer changes the legacy Beta label to `Closed Beta 1` and normalizes
English numbered heading levels. Files on disk are never modified.

A manifest is limited to 64 KiB. Every read verifies file bounds, UTF-8, byte count,
hash, boundaries and section numbering. References that escape the private
manifest directory through a symlink or junction are rejected. Missing, malformed,
changed or incomplete inputs return `LEGAL_CANDIDATE_UNAVAILABLE` without private
paths or filesystem diagnostics. Inputs are re-read on every review request.

## Local contact configuration

`NEXUS_LEGAL_CONTACTS_PATH` may point to a separate absolute local JSON file with
exactly `supportEmail`, `rightsEmail` and `confirmedOn` (an ISO date). General
support and personal-information requests have separate addresses and purposes.
This file is used only for private operator review. It does not configure SMTP,
send mail, populate public contact pages or activate a request intake service.
Leave it unset when no confirmed contacts are available. Do not commit actual
addresses or this configuration file.

## Validation and publication boundary

`tests/fixtures/legal-candidates.ts` creates temporary **TEST ONLY** inputs and a
manifest for unit/browser validation. Its text is deliberately synthetic, contains
no legal terms and is never used as a runtime default. The focused tests cover
complete sections, separate notes, source tampering, malformed configuration,
missing inputs and no-cache behavior. The browser harness uses the production
loader with an explicitly configured synthetic manifest and disposable services.

Candidate review, owner settings, final legal approval, admission/consent gates
and release decisions remain separate. Configuring local inputs or contacts does
not approve publication, user agreement, data collection or external delivery.
