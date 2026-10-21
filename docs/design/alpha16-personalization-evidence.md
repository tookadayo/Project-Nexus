# ADD03 / ADD04 implementation evidence — 2026-10-16

This records source implementation and prepared acceptance code, not passing execution. The parent instructed that tests, type checking, lint, builds, migrations, browser checks and real environment operations wait until all alpha16 implementation is reported ready. None were run for this work.

## Contract and scope

Read the formal source README, migration plan §4.2 ADD03/ADD04, contract decisions, decision gate, design index, IA supplement and latest `alpha16-spec-deltas.md`. Original specification files remain unchanged. The latest user instruction removes approval before viewing recommended responses. Reading and displaying an existing response still uses current authorization; a retained-purpose gate is not display approval.

`packages/operations/src/alpha16-personalization.ts` adds a strict typed service for saved templates and the private Preference Center. `migrations/065_alpha16_personalization.sql` defines immutable template revisions, versioned template metadata, actor-scoped preferences and prepared request identities. No table has a lifetime default. The parent owns migration registration and privacy/maintenance integration.

Templates support current-guild list/detail, create from an existing immutable Automation revision, edit into another template revision, copy, delete and create a new Automation draft. Definitions pass the existing validation and Scratch numeric capability checks. Applying a template calls existing `AutomationService.save` with expected revision zero and one prepared request identity. It creates a draft only: no publish, enable, execute, second runtime or implicit source-flow mutation. Deleted templates immediately lose their definition snapshots/name. Credential-shaped fields and recognizable credential strings are rejected; this is a bounded structural safeguard, not a claim to detect every possible secret in arbitrary prose.

The Preference Center accepts only `suggestionDisplay=SHOW|HIDE` and `personalNotifications=UNCHANGED|MUTED`. It cannot opt someone into DM delivery or add a recipient. Current actor identity comes from live server authorization, never request parameters. No other person, other guild, unknown field, raw template definition or activation flag is accepted. Save/reset require the observed version. Reset clears settings while preserving a minimal version until the same class expires. Existing notification delivery contracts remain authoritative; no new notification service was added. The parent owns consumer wiring, including recommendations list preference application.

Browser routes are `/templates`, `/templates/data`, `/preferences`, `/preferences/data`. The BFF verifies the live OAuth/server membership snapshot, current operations permission, displayed guild and current verified connection. Mutation uses existing CSRF protections, strict bounded JSON, server-prepared request key and expected version. Source Automation revisions remain scoped by guild. Unknown draft outcomes are read-only reconciled against the existing Automation request identity and never automatically sent again.

## Independent retained-purpose gates

| Class | Purpose | Operational status |
|---|---|---|
| TEMPLATE_DEFINITION | Saved template metadata and immutable definition revisions | No duration chosen; writer disabled |
| PERSONAL_PREFERENCE | Active private settings and minimal reset/version state | No duration chosen; writer disabled |
| PERSONALIZATION_REQUEST | Prepared/finished mutation identity, fingerprint and minimal result IDs | No duration chosen; writer disabled |

`PERSONALIZATION_POLICY` is undefined. The 48-hour Fact and 14-day suggestion/audit limits do not silently set these classes. A class needs its explicit purpose-specific policy before writes. Edits/copies/request records are capped by existing resource expiry and do not extend it. Readable existing records remain available until their own expiry under current authorization. Cleanup exports cover actor, guild and expiry and use canonical scope locks. Backups and restored deletion receipts remain the parent platform's existing policy.

## Prepared verification

- `tests/unit/alpha16-personalization.test.ts`: strict input, private subject boundaries, unknown fields, secret-shaped content, canonical fingerprints and independent policy/expiry caps.
- `tests/integration/alpha16-personalization.test.ts`: eight database scenarios for disabled defaults, immutable CRUD and source protection, draft-only reuse, actor/guild privacy/reset, CAS/request binding, concurrent edits and deletion hooks. All durations are explicitly synthetic fixture values.
- `tests/e2e/alpha16-personalization.spec.ts`: ten synthetic browser scenarios using the actual client: Japanese/English, 320px, disabled lifetime gate, empty/errors, private changes, source/new draft, cancel, double click, CSRF/guild/version headers, conflict and unknown non-resend.

Unexecuted: all acceptance code above, type checking, lint/build, schema installation, browser UI review and Windows/runtime deployment checks. No credentials, production data, deployment, merge or commit changed. Existing `apps/web/next-env.d.ts` remains at SHA256 `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000` at the last static check.


## Current authorization after waits

Both new service options receive the shared `MaintenanceAuthorizationProof`. The BFF alone constructs it from trusted scope, actor hash and live snapshot checkedAt + 10 seconds; JSON cannot supply it. Reads recheck it after canonical locks and before returning data, including after BFF permission/source reads. Writes recheck after row/key waits, immediately before SQL and before committing the local transaction. Missing, wrong actor/scope and elapsed proofs fail closed. Template draft save handles the legacy initial nontransactional authorization separately; the real save transaction checks after template/key waits and uses an optional final-write callback after Automation locks.

If Automation SAVE already returns a known committed result but proof expiry or another receipt failure prevents finalizing the separate personalization receipt, the service returns that minimal known result with `requestRecorded=false`; it does not invent a failed save or resend it. Read-only reconciliation can use the existing Automation request identity. Root actor erasure handling, including optional erased user-ID reference scrubbing from template snapshots, remains intact. Added fixture code covers required read proofs, actor/scope/deadline mismatches, awaited authorization expiry and final-write expiry without a template row. All remain unexecuted.
