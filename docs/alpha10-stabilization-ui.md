# alpha.10 Discord UX stabilization

Design record, 2026-10-08 (Asia/Tokyo).

Reuse: Components V2 primitives, signed and actor-bound custom IDs, four-stage draft wizard, current CommunityModel, SettingsService revision checks, analysis result storage, Outbox, and private deferred interaction responses.

Change: stable home entrances with separate free basic and counted detailed analysis; recursive payload validation; metric units and unknown labels; result summaries and paged details; signed history navigation; category selection expanded to explicit channels; review before attention creation.

Add: payload export, desktop/mobile Japanese/English rendering approximation, manual Discord acceptance checklist, scope review paging, and non-destructive batched channel/purpose setup.

Conflicts: existing scope/model arrays cap configuration at 100 channels and the wizard replaces rather than accumulates selections. Existing all/exclude scope settings must retain their legacy meaning. New category choices are snapshots; future channels are not silently included. Existing analysis type identifiers remain intact.

Migration: UI itself does not reset settings or balances. Existing installed panel messages use their saved location and Outbox. Legacy actor-bound buttons remain readable until expiry; changed preview conditions require re-opening preview. Updated entries may be refreshed individually; do not bulk-post panels. Scope/model persistence migration is coordinated with the shared resolver change.

Unchanged: private thread exclusion, purchase-pack sales disabled, Stripe Live disabled, plan allowances, Guild credit ownership, UTC monthly renewal, onboarding content, Discord channel/role structure, and public result publication requiring explicit authorization.

Reference review: [Discord component reference](https://docs.discord.com/developers/components/reference), [overview](https://docs.discord.com/developers/components/overview), [interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding), [Ticket Tool quick start](https://ticket-tool.app/docs/getting-started/quick-start), [panels](https://ticket-tool.app/docs/concepts/panels), [Statbot stats](https://docs.statbot.net/docs/usage/commands/stats/) and [setup](https://docs.statbot.net/docs/guide/setup/) were read on 2026-10-08. Adopt recursive 40-component counting, Sections with one accessory and 1–3 Text Displays, 100-character custom IDs, 25 select options, one Primary per action group, Label modal children, 3-second initial response and 15-minute interaction token lifetime. Repository SDKs: discord-api-types ^0.38.55 and discord.js ^14.27.0. Adopt only stable entry panels, staged confirmation, preserved period choices and optional detail views from references. No competitor content, rankings, Presence collection or ticket lifecycle is copied.

Live Discord acceptance: **NOT RUN**. No server mutation or normal-account token is used. HTML previews are generated from actual bot payloads and are layout approximations only.


Implemented behavior, 2026-10-08:

- Home keeps five stable entries. Basic activity has six free views; detailed analyses have a separate allowance and UTC renewal. Shared installed panels contain generic entrances; every click defers a private response and checks current access before showing data. The shared message remains unchanged by a personal view.
- Basic and detailed reads use the shared resolver, including Forum/Media descendants, explicit exclusions, current permissions and tombstones. Confirmed purposes adapt social, showcase and voice summaries; channel names do not determine purpose.
- Detailed preview signs fixed UTC start/end dates, semantic configuration identity and optional correction origin. Zero remaining uses still permit a qualifying calculation correction at cost zero. Existing results retain their original calculation version; the old record is not rewritten.
- Main results display three relevant measurements with units and data state. Saved period, saved target count, calculation time and at most two observed baseline changes appear before expandable details. Median, co-presence and event participation limitations are visible. Verified zero and unavailable observations use different copy.
- History has five visible result actions, type selection and opaque server-side next/previous cursors. Queued cancellation and review creation have explicit controls; review creation displays evidence and duplicate state before confirmation. Privacy-invalidated results cannot be opened.
- Setup uses four stages: scope and purposes, notifications, team access, and what to view. Channel additions accumulate in batches of 25; category selection expands current eligible child IDs. Explicit exclusions survive re-expansion. Purpose changes apply to the last selected batch. Draft edits do not affect production; skip restores saved values. Final confirmation rechecks revision, permissions and plan limits. Every selected place remains reachable through paged review.
- Test notifications show the destination and exact sending effect before confirmation. Payment navigation includes the actor's own financial-management page without granting community access.

Reviewable artifacts are in [alpha10-ui/README.md](alpha10-ui/README.md). Full local generation produced 138 actual payload cases and 276 desktop/mobile images in Japanese and English; 66 cases cover S1–S8 home, basic activity, detailed preview and draft confirmation, including S7's 330-channel census and last review page. Representative current-result fixtures contain observed measurements; legacy/no-data cases remain separate. Six further ja/en cases cover basic posts, detailed preview and completed results with partial historical post coverage: observed participant-post lower bounds and unknown Bot totals are explained before evidence. Selected JSON and two mobile images are added without replacing the earlier evidence. All fixture counts are synthetic, not production findings.

| Verification | Result | Evidence |
| --- | --- | --- |
| UI/ACK/legacy acceptance unit regressions | PASS, 65 tests across 7 files | `tests/unit/stabilization-ui.test.ts`, `interaction-ack.test.ts`, `alpha10-ui.test.ts`, `alpha3-polish.test.ts`, `alpha3-product.test.ts`, `alpha5-payloads.test.ts`, `v060.test.ts` |
| Draft scope snapshot, batches, purpose preservation, explicit removal, skip rollback, invalid confirmation | PASS, 2 integration tests | `tests/integration/stabilization-setup.test.ts` |
| Existing setup approval and attention snooze integration | PASS, 2 targeted tests | `tests/integration/database.test.ts` |
| Signed HTTP → durable worker → Outbox/Streams slice | PASS, 1 targeted integration test | `tests/integration/streams.test.ts`; all ACKs private, shared panel preserved, no test notification before confirmation |
| Actual payload constraints and local desktop/mobile layout | PASS, 1 Playwright test over every payload | `playwright.discord.config.ts`, `tests/e2e/discord-panels.spec.ts` |
| TypeScript and targeted ESLint | PASS | Final root verification records the complete repository gate |
| Real Discord desktop/mobile, REST delivery, client modal rendering and screen-reader navigation | NOT RUN | Requires a development Guild and the explicit live acceptance procedure below |

Reproduce the local UI checks with Node 24 and the repository's pinned pnpm:

```sh
corepack pnpm exec vitest run tests/unit/stabilization-ui.test.ts tests/unit/interaction-ack.test.ts tests/unit/alpha10-ui.test.ts
corepack pnpm exec playwright test --config playwright.discord.config.ts
```

`NEXUS_PANEL_EXPORT_DIR` and `NEXUS_DISCORD_SCREENSHOT_DIR` can select durable output directories. The exporter validates recursive component counts, Section accessories, 100-character IDs, full-message Text Display totals, select option/value/placeholder bounds and one Primary per action group. The browser checks horizontal overflow at 700px and 375px. Text wrapping, selected-menu opening, native mention resolution, dates and scrolling differ from native Discord; approximate dates use UTC and relative timestamps are placeholders.

Live development-Guild acceptance remains **NOT RUN**. Do not count the local previews as live acceptance. When separately authorized for a development Guild, perform these steps with Japanese and English interfaces, desktop and mobile, an operator and an ordinary member:

1. Open the same installed panel as two actors. Enter basic activity and settings; only each actor sees their response. Ordinary members cannot open operational results or settings. The installed message, balances and other actor's response do not change.
2. With zero detailed uses, open every basic view and verify no quota reservation or ledger consumption. Open a normal detailed preview and verify Start is disabled; a backend-qualified correction preview must instead disclose zero cost and preserve its original dates.
3. Choose each detailed kind and 7/30/90 days. Confirm only after checking period, target count, quality and debit. Reopen a duplicate, cancel a queued run, and race cancellation with worker pickup; the response must explain the actual outcome.
4. Create more than 25 history records. Navigate forward/backward through every record, filter kinds, compare only compatible records and inspect saved calculation time. A different Guild/actor must not reuse a cursor or private button. Removed-data results must remain unreadable.
5. In a mixed server, draft 100+ places in batches, choose a category, remove one child and re-add the category. Review the last page, set different purposes on separate batches, skip changed optional stages, go Back, and confirm. Production changes only on final confirmation; explicit removals and prior purposes survive. Add a future child: it remains excluded until explicitly selected.
6. Lose a channel permission, delete/move/rename a channel, rename/delete a mapped tag and change manager/helper roles while a draft or preview is open. Confirmation rechecks current authority and eligibility; same-name replacement IDs never acquire old meanings. Conflicting mapped resolved/unresolved tags show unknown resolution.
7. Check observed zero, no observations, partial coverage, mixed Forum/Media replies, pure/primary voice, Stage, announcements/reactions/polls and external events. Unobserved attendance, bot/webhook human success and co-presence-as-conversation are never fabricated. Units stay attached to values. Periods before all-post collection began, including periods with no stored rows, cannot establish staff/Bot-inclusive totals or verified zero Bot posts; a fully observed current zero is distinct.
8. Create a review from a result, inspect evidence and duplicate status, confirm once, then open the same concern again. No duplicate operational item is created. Test notifications show the saved destination, send only after confirmation, and contain no broad mention.
9. Open My payments as a detached financial manager; community analysis and settings remain separately permission-gated. Refresh an individual installed panel through its saved location. Record screenshots, client versions, payload IDs and any Discord validation errors before marking live acceptance complete.
