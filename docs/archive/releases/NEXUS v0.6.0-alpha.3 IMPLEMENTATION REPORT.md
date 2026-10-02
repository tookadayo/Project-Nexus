> Historical release evidence. Preserved from its original release; current contracts are indexed in [Documentation](../../README.md) and [Stripe readiness](../../billing/stripe-readiness.md).

# NEXUS v0.6.0-alpha.3 Implementation Report

## Implemented

- Public website and authenticated operations dashboard now share NEXUS visual tokens and responsive navigation.
- The product loop is visible across the public story, Discord control panel, and dashboard: observe, detect, explain, recommend, act, measure.
- Package versions are `0.6.0-alpha.3`. The existing rate limiter, diagnostic references, privacy boundaries, guild authorization, and fail-closed billing were retained.

## Discord UX

- Control Panel prioritizes today's arrivals, observed first connections, and posts awaiting a reply. New Members puts outcomes before technical observation details.
- Attention distinguishes open, staff acknowledged but unresolved, snoozed, and resolved. Buttons perform staff actions; a select offers 30 minutes, 1 hour, and end-of-day snooze.
- Registered three permission-gated message context commands and one user context command. The interaction worker rechecks operator permission and uses private responses. Context payloads store identifiers, not message bodies.
- Goals and measurement descriptions now state the observed event precisely. Event signup is never called attendance; playtest channel response is not called verified participation.

## Web UX

- `/` is a public landing page; `/product`, `/pricing`, `/support`, `/privacy`, and `/terms` are public. `/dashboard` and `/dashboard/[guildId]` remain protected. OAuth preserves a validated guild-specific return path; `/servers` separates sign-in from bot installation.
- Dashboard adds a first-screen operations banner, an actionable Attention queue, Insights, Improvements, Results, and Goals & Rules. Settings forms have improved label spacing and visible save actions.
- Observed rule values are shown until an edit is saved. Actioning an Attention item updates the displayed queue count without a page reload.

## Pricing

- Free, Starter, Growth, Scale, and Enterprise cards and comparison rows derive from the Plan Registry. Currency is **USD**. List prices are $0, $15, $49, $149 per month, and contact for Enterprise.
- Features reserved in entitlement data but not shipped to customers are marked Planned. Paid checkout remains unavailable; enquiry links do not imply purchase or activation.

## Measurement changes

- A first connection requires an observed direct reply or voice connection within the member's first 72 hours. A reaction added by the member is a light activity signal and does not count as first connection.
- Attention candidates are limited to observed newcomer posts within the first 72 hours. The Web action endpoint accepts only items still in the current scoped queue.
- Zero is shown only when there is an eligible observed denominator. Otherwise the interface shows a collecting or unavailable state. Channel comparison retains minimum sample thresholds.
- No message body, attachment content, DM content, or presence collection was added.

## Tests

| Gate                     | Result                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| ESLint                   | Passed                                                                                                    |
| TypeScript               | Passed                                                                                                    |
| Unit                     | 148 passed                                                                                                |
| Integration              | 65 passed, including context permissions and the 72-hour connection boundary                              |
| Browser E2E              | 12 passed, including public access, responsive layouts, Attention actions, and server-card visual fixture |
| Performance              | 2 passed, including 10,000 and 50,000 member cases                                                        |
| Windows runtime manager  | Passed                                                                                                    |
| Next.js production build | Passed                                                                                                    |

## Visual QA

Playwright screenshots were reviewed at 375, 768, 1280, and 1440 pixels where relevant. Checked landing desktop/mobile/tablet/large desktop; product desktop; pricing desktop/mobile; server cards desktop/mobile; dashboard overview desktop/mobile; New Members; Attention; Insights; Goals & Rules; and Settings. Form spacing, misleading zero-denominator text, and mobile comparison guidance were corrected after review. Server-card screenshots use the production card component with illustrative fixture guilds, because live OAuth credentials are not part of this test environment.

## Known limitations

- Paid billing, checkout, AI explanations, Webhooks, public API, multi-server plan management, role-based Web access, and audit export are not activated by this release. The pricing page identifies planned features.
- The current event signal proves signup, not attendance. The current reaction event records the actor adding a reaction; it does not identify who received one.
- Live Discord rendering and a real Discord OAuth/install journey still require a configured application and guild. CI on GitHub is not represented by local test results.

## Manual Discord checks

With a configured test guild, verify command registration and propagation; public panel placement; JA/EN Home, New Members, Attention empty/populated, Insights, Settings, and setup; ACK, each snooze choice, and Resolve; message context authorization and private replies; user context authorization and private replies; and the guild-specific Web Dashboard link. Repeat with an operator lacking Manage Guild or a configured Discord manager role to confirm denial.

## Screens created

Public Landing, Product, Pricing, Support, Privacy, Terms, Server Selection; Dashboard Overview, New Members, Attention, Insights, Improvements, Results, Goals & Rules, Settings; Discord Control Panel Home, New Members, Attention, Analysis, Improvements, Results, and Settings.
