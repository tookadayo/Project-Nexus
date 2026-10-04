# Corporate product website QA

Reviewed on 2026-10-04 against the corporate product website redirection directive and the current implementation. This review supersedes the earlier concept-site QA. It checks the public Discord product site, not a new product service or live billing flow.

## Scope and visual evidence

Both languages are captured at **1440, 1280, 1024, 768, 390 and 360px**. First-screen and full-page PNGs are saved in the ignored `.local/nexus-corporate-qa/`, using `{en|ja}-{width}.png` and `{en|ja}-{width}-full.png`. The full product preview and primary CTA are visible within a 1440×900 first screen. Narrow layouts place the product immediately after the explanation and CTA, with readable UI rather than scaling a desktop screenshot down.

The review covers product clarity, three-feature skim, hierarchy, paragraph readability, section spacing, actual CTA destinations, menu, FAQ and footer. The page has ordinary sections without chapter storytelling, continuous motion or scroll control. Screenshots distinguish illustrative cohort and attention numbers from real customer results.

## Changes made during review

- Grounded all public copy and metadata in shipped Discord observation and operations.
- Removed concept simulation, imagined source adapters, developer API and invented plans. Public pricing removes planned names and comparison rows as well.
- Kept observation windows explicit: first connections use a completed sample cohort and a per-member 72-hour window.
- Matched Journey bar widths to sample counts.
- Added explicit button colors to isolate the light site from the app's dark color scheme.
- Restored background scrolling immediately when Escape dismisses the native mobile menu, while retaining focus containment and restoration.
- Unified the public product, pricing, support, privacy and terms pages with the homepage navigation, mark, colors and real product preview. Removed numbered chapter labels from the detailed product page as well.
- Kept plan-card feature labels smaller than plan headings, and corrected Japanese phrase wrapping.

## Verification

| Check                             | Result                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| ESLint and TypeScript             | Passed                                                                    |
| Formatting and `git diff --check` | Passed                                                                    |
| Unit tests                        | 363 passed in 33 files                                                    |
| Workspace build                   | 19 package tasks passed; final Web build passed after visual refinements  |
| Full browser regression           | 28 passed, including 6 new product-site tests                             |
| Production public-page check      | 2 passed: both languages, 6 public pages, all 6 widths (72 layout checks) |
| Home screenshots                  | Both languages, 6 widths, first-screen and full-page images reviewed      |
| Product and CTA at 1440×900       | Both fully visible in the first screen                                    |

Tests cover public pages/assets and metadata, available-only pricing, JavaScript-disabled content, native FAQ disclosure, preview keyboard tabs, menu focus/Escape, both languages and all six viewport widths. The responsive tests detect horizontal overflow and clipped visible content. Production checks also verify the installation CTA falls back to support when no Discord application ID is configured, and that no numbered product chapters remain. Production screenshots use `production-{locale}-{page}-{width}.png` in the same local review directory.

An initial full browser run encountered one Chromium `ERR_NO_BUFFER_SPACE` during a dashboard navigation. The isolated rerun passed, and the following complete run passed all 28 tests without retries. No application code was changed to hide the browser failure.

The original incoming concept files were preserved in an ignored local ZIP before replacement. Next's generated type-reference changes were restored to the incoming tracked form after the checks. No commit, push or deployment was performed for this redirection.

No production deployment, real Discord actions, payments or third-party certification are part of this website check. The site accurately identifies the alpha release and unconfigured paid checkout. Product and billing implementations were not changed by this redirection.
