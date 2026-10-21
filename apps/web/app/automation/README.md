# alpha15 automation editor

This client edits the registered `FlowDefinition` tree. Blocks and Steps display
the same statement objects and stable IDs. There is no JavaScript generator,
browser execution engine, wire graph, cross-run variable store or persistent Undo
store. The API compiles and validates the definition and binds validation,
structural simulation and impact review to the saved revision.

`AutomationWorkspace` is reusable inside the dashboard. `/automation` is a server
page guarded by `dashboardContext`; every request goes through the independently
authorized `/api/automation` BFF with the displayed guild header. UI props confer
no authority. Saving an uncertain mutation blocks further writes until its
request ID can be reconciled; the client does not repeat the write.

## Editor-library assessment (2026-10-15)

The current application has React 19 / Next 16 installed and no Blockly or
Scratch Blocks dependency. The bundled Next guides for Server and Client
Components, layouts/pages, route handlers and CSS were read before implementation.

- [Blockly 13 release](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.0.0)
  adds default keyboard and screen-reader support, including custom-field work
  that the application must still do.
- [Blockly JSON serialization](https://docs.blockly.com/guides/configure/serialization/)
  supports extensible workspace state. It does not replace a domain definition.
- [Connection checks](https://docs.blockly.com/guides/create-custom-blocks/inputs/connection-checks/)
  match type labels and have limitations around surrounding scope and generics.
  NEXUS therefore still needs its own server checks.
- [Scratch Blocks package](https://raw.githubusercontent.com/scratchfoundation/scratch-blocks/develop/package.json)
  is a separate editor package built on Blockly. It is not the Scratch VM and
  adopting its presentation would not provide NEXUS execution semantics.

Decision for this increment: use nested native DOM controls over the registered
tree. This avoids a new unverified dependency/serialization layer and provides
direct click, tap and keyboard alternatives for every implemented tree edit.
C-shaped container boundaries, sentence blocks, value sockets and condition
shapes are CSS presentation; text, branch names and type labels carry meaning
independently of color. This is a scoped implementation decision, not a claim
that a custom editor has matched Blockly's accessibility coverage or that a
hands-on comparison of both libraries was completed. The comparative library
prototype and screen-reader/IME/touch-device certification remain unperformed.

## Validation evidence

The isolated Playwright fixture bundles the real editor with existing esbuild
and React. It mocks only the same-origin API, never Discord. Run with the installed
tools (no package installation required):

```
node node_modules/@playwright/test/cli.js test --config playwright.alpha15-editor.config.ts
```

Tests cover JA/EN at 320px, unset versus explicit zero, invalid fractional count,
same-tree Steps, revision-bound checks, double click, Undo confirmation
invalidation, cancel, lost save response, permission failure and network failure, production confirmation and admission
uncertainty, formal role-approval confirmation, deep links, and desktop nesting.
The independent editor-model tests cover stable IDs, local-reference rewriting,
branch scope and bounded Undo history.
Artifacts are under `.local/alpha15-editor/`.

The service evaluates the same typed definition with explicit mock inputs,
action outcomes, outputs and clock data. Missing mocks stay undetermined and
cannot satisfy the activation check. Mock values never enter production inputs,
production random commits or formal approval. Live Discord state and contract
verification are not claimed by the simulation. Unregistered capabilities remain unavailable and are shown with
their reasons. Real OAuth/Discord, Windows restart, public HTTPS and production
effects were not exercised by this fixture.

## Approved continuation

The trigger inspector now edits manual typed declarations and opts into fixed,
metadata-only ticket/interaction fields from `event-contract.ts`. Display names
may change; source identifiers and types cannot. Ticket events cover verified
Operations Intake requests. Discord interactions start through the existing
NEXUS panel and an actor-bound, expiring, one-use native button. Web controls
cannot impersonate that actor. Event admission receipts expose only metadata;
there is no requeue or resend control.

Parallel blocks have two or three editable branches and explicit named results.
The compiler checks branch-local reads and exact output types. Only existing
writable parent locals can receive results, together at a successful all-join.
Run detail projections show runnable, waiting, approval and completed branches,
including nested joins. Unsaved definitions do not supply labels for a fixed run.

Structured ordinary posts use strict `LegacyMessageSpec`, `EmbedSpec` and
`RichTextSpec` types. Registered rich-text parts and embed fields are editable
without JSON or code execution; the same safe compiler builds the preview and
transport content. Plain content is escaped exactly once. Mentions stay off and
V2 is a separate unavailable capability. A message step selects exactly one
plain content or structured message input. Existing `RichText` strings remain
readable for schema compatibility.

Pure value menus use the existing evaluator's browser-safe typed card registry.
List binders appear only in their calculation body, and pure calls preserve the
chosen revision. No operator semantics were added by the editor integration.
The separately approved message-construction operators `rich.text`, `rich.wrap`,
`rich.join`, `embed.build` and `message.legacy` allow variables inside those
typed parts. PlainText interpolation is escaped once; derived values inherit
publication restrictions. These operators add no external effects. Legacy
buttons/selects, modals, attachments and V2 parts remain unavailable.
Simulation supports an explicit UTC clock and typed, registered service-result
mocks. Those mocks cannot be constructed as production literals or grant
authority; `nexus.ticket.status.v1` exposes only the actual six-state enum and
version.

Continuation evidence adds editor bridge tests for strict Legacy versus V2,
escaped versus explicit rich formatting, service-only mock separation, narrow
intake references, joined outputs and duplicate mappings. Browser cases cover
the actual structured inspector, output binding/branch states, fixed event input
IDs, rejected receipts without retry, and role policy fingerprint echo. The
real-device accessibility and live OAuth/Discord limitations above still apply.

The approved bounded ticket controls retain this same DOM tree. `poll` exposes
an explicit typed ticket reference, 1–100 read attempts, a positive interval,
an exact UTC deadline and the existing Boolean condition editor. Its read-only
state/version result is scoped to the condition and matched/exhausted branches.
`awaitEvent` selects one or more of the existing six ticket states, the same
typed ticket and a deadline; only a matching update to a current Intake ticket
after subscription can resume it. Its result exists only in the matched branch.
Neither result exists in timeout branches or after the block, and neither is an
assignment target. Authorization/read errors remain stops rather than false
conditions or timeouts. Run cancellation remains a terminal run operation.

Simulation uses explicit mocked polling outcomes and state/version snapshots.
An awaited update requires an explicit match with state, version and UTC event
time, or an explicit timeout. Partial and absent event mocks remain undetermined.
A separate opt-in synthetic Intake reference is available only in the simulation
panel; it creates or retrieves no ticket and never enters a saved definition.
The existing Run start instant is listed as read-only metadata and can be used
with the already registered time calculations. No pending Scratch condition,
arithmetic or dedicated elif design is introduced by these controls.

The approved completion adds dedicated `resultBranch` and `optionalBranch`
containers. Parsed values and service-issued action outcomes have distinct
types; only a successful result branch receives its payload, while the other
branches receive a bounded reason code. Capturing an action outcome inserts its
required adjacent consumer in one reversible change. Unknown outcomes allow
only pure handling and remain terminally unknown. Optional zero, false and empty
values remain distinct from unset; literal empty text requires an explicit
control rather than silently turning a blank field into execution data.

Fixed lookup tables edit literal keys and typed row values separately, reject
duplicates and require an explicit no-match value. The type picker handles
recursive pairs, typed groups, found-item positions, minimum/maximum records,
parsed results, operation results and the three registered temporal values.
Registered schema IDs remain wire metadata; the primary UI uses ordinary names.

Formal approval containers select a later role action in the same step list
and set a UTC deadline. They cannot manufacture approval from a Boolean.
Named iteration results remain read-only after the loop and expose six distinct
states through typed operation outcomes. Run and simulation summaries show only
states and counts, without values or internal operation identities. Simulation
requires explicit approval outcomes and lets users opt into synthetic references
that never enter a saved definition or fetch real targets.

The definition manager creates and clones procedure/Pure versions, compares
their contents and reviews explicit caller updates. Procedure editing and manual
calls address `id@revision`; adding a new version never repins existing callers.
The same registered DOM tree remains the editing and Steps representation.

New Scratch definitions explicitly select `scratch.v1`; a missing profile keeps
the legacy evaluator. Saved revisions can be compared by content through the
existing authenticated, tenant-bound read permission. This comparison uses saved
definitions and does not read execution values or include unsaved edits.

The fourteen mathematical forms include exact binary64 helpers and a pinned
MPFR 4.2.1 WASM server engine for the ten transcendental functions. Angles use
degrees, nonzero subnormal results are retained, and a nonzero value rounded to
zero is an underflow error. The server supplies an ephemeral evaluator to
validation, simulation and execution; the browser, saved definition and resume
checkpoint contain no WASM engine or evaluator function. New transcendental
calls reserve 32 units from the existing shared evaluation budget before any
engine call. This is a host safety setting, not a commercial plan allowance.
See `docs/design/alpha15-scratch-mpfr-engine.md` and
`docs/design/alpha15-math-engine-distribution.md` for precision, artifacts,
independent verification, source material and remaining distribution checks.

Last-item access has two separate one-input forms: `list.lastOptional` returns
unset for an empty list, while `list.lastStrict` stops with `IndexError`. Numeric
index inputs still require an actual integer position. Random selection uses
the explicit draw block, and clearing a list uses its own expression form.
