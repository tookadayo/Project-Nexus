# Official publications: operation and verification

Announcements use a separate authenticated local operator listener. Public
pages read only the current published revision. Local access alone does not
authorize editing or publication.

## Editorial workflow

1. Save a draft and review the exact saved revision, language, links and content.
2. Check that personal information, credentials and editorial notes are absent
   from material intended for publication.
3. Explicitly confirm publication for the intended destination and revision.
4. When editing a published article, save and preview the new revision. The
   existing published revision remains visible until another explicit publish.
5. Withdraw an incorrect article, inspect the result, then preview and manually
   publish a corrected revision if appropriate.

Stale revisions are rejected. Retry an uncertain operation using the same
request identity rather than submitting a new operation. Publication state and
metadata-only audit records change transactionally. The confirmation dialog
stays locked while a request is in flight; do not interpret an uncertain response
as confirmed success or failure.

## Public and private boundaries

- Public lists, details, category filters and language fallback exclude drafts.
  A missing English version explicitly falls back to the same published revision.
- Withdrawal removes the body from subsequent public reads. Previously saved or
  printed external copies cannot be recalled.
- Public content reads avoid shared stale caches. A failed read is not zero
  announcements; empty, unavailable and missing-article views remain distinct.
- Restricted Markdown is shared by preview and public rendering. Raw HTML,
  embedded images and unsafe links are not enabled by this workflow.
- Operator sessions, Host/Origin validation, CSRF, expiry and logout protections
  remain required. Do not expose the operator listener through public routing.
- Legal review inputs and settings stay private. Public legal availability pages
  do not publish candidates or create consent records. Support forms remain
  disabled until an approved intake path is implemented.

The [blank legal settings example](examples/legal-review-settings.json) is a
shape reference only. Populate private settings through the authorized operator
workflow. General support and rights requests have separate destinations.
Saving settings alone is neither publication nor permission to collect data.

## Verification

Use isolated, synthetic fixtures for the selected commands:

```sh
corepack pnpm exec vitest run tests/unit/official-public-routes.test.ts tests/unit/publication-markdown.test.ts tests/unit/official-news.test.ts tests/unit/official-legal-public.test.ts
corepack pnpm exec vitest run --config vitest.integration.ts tests/integration/official-publications.test.ts
node --import tsx tests/ui/official-publications.ts
```

The browser harness requires a web build and its isolated test infrastructure.
Run browser/server harnesses sequentially. Confirm draft exclusion, revision
conflicts, retry behavior, withdrawal, session boundaries, keyboard interaction
and JA/EN layouts. This document records no current PASS result. See
[known failures](alpha14-existing-test-failures.md) and
[remaining publication gates](alpha14-publication-gates.md).
