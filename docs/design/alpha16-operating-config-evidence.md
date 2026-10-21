# alpha16 measured operating config writer

2026-10-16. Source and fixtures prepared; no tests, type check, lint, build, browser, DB, migration or operating configuration has been executed. This extends the existing immutable CONFIG purpose and existing GOVERN authority. It does not approve fixture values or create a runtime permission from browser input.

## Native writer

`RulePlatform` accepts an optional seventh `RuleOperatingAdmission` constructor argument after the existing Case runtime configuration. The application factory does not inject a measured operating provider, so the existing environment remains disabled with `MEASURED_OPERATING_PROVIDER_UNCONFIGURED`. The default does not stop existing authorized proposal reads.

`activateConfig(scope, actor, { baseConfigVersion, draftConfigVersion, draftContentHash }, key)` reads the stored DRAFT under current GOVERN authorization, derives an APPROVED operational successor definition without changing the stored draft, and asks the trusted measured provider outside the DB transaction. It then reacquires canonical scope locks, current actor proof, privacy guards, GOVERN, the original version/hash and source metadata. The provider repeats local registry, measurement and source authorization checks under those locks. Scope, actor, config hash, measurement identity, explicit finite resource budget, input-source set, policy revision and expiry must agree.

The writer compares the latest canonical config version, retires the former ACTIVE state, cancels unfinished evaluations of that retired version, and inserts a new ACTIVE immutable successor. Its deadline is the earliest of the original draft deadline, the measured profile deadline and current CONFIG policy. Reading or reactivating the same old draft cannot extend its original deadline. The old definition, content hash, timestamps and expiry are unchanged. No external Apply or Discord work is executed.

`retireConfig(scope, actor, { baseConfigVersion, activeConfigVersion, activeContentHash }, key)` uses existing GOVERN, current actor proof, canonical locks, exact source hash and latest-version CAS. It remains available without a measurement provider to stop an existing config. It marks the old ACTIVE state RETIRED, creates a new immutable RETIRED successor with disabled approval, and changes queued/running evaluations to CANCEL_REQUESTED. It does not discard an UNKNOWN external effect, resend work, rewrite evaluation results or hide proposal history.

Both operations use CONFIG_ACTIVATE/CONFIG_RETIRE communication request keys. Keys only deduplicate communication; they do not authorize a write. Replays reconstruct the referenced version under current authorization/privacy/expiry. Minimal operation audit is recorded with the existing new 14-day class and no definitions, input values, measurement payload or secret.

## Measured admission and readiness

`packages/rules/src/operating-config.ts` defines the strict trusted provider boundary. An unconfigured provider, FIXTURE config, wrong scope/actor/config hash/policy, expired measurement, insufficient finite measured budget, missing source authorization or incompatible retention fails closed. The provider observes live/current conditions outside locks and must recheck existing local canonical measurement/registry/source metadata inside the transaction, without external work. Process-local opaque proofs cannot be copied into a request or restored from DB.

The operating profile identity binds config hash, scope, measured time/deadline/reference, budget, source registry, source set and retention revision. A fresh actor observation does not create a new profile identity or extend the stored config expiry. A different measured profile requires a new immutable config successor. No synthetic fixture or proposed numeric range is installed as a PC measurement.

Readiness is dynamic: the current ACTIVE config and stored profile must be unexpired, the currently observed trusted profile identity must match, current ANALYZE/source permissions and all evaluation persistence classes must pass. Missing TARGET_LIVE_SAFETY does not block evaluation or proposal visibility; external Apply remains independently disabled. Existing proposal list/detail/history reads do not acquire the new profile gate. The parent connected current profile expiry checks to new evaluation request/enqueue and worker claim/finalization.

The config DTO returns `currentVersion` from all canonical rows, including expired rows, independently of the display's unexpired item list. It includes `sourceConfigVersion`, `operatingProfileRevision`, `operatingProfileExpiresAt` and `mutationReadiness`. The independent `/rules/config` UI/BFF uses these exact stored candidates/version/hash and existing GOVERN; it does not accept a client-supplied profile, measurements, source grant or runtime permission.

## Schema, retention and validation

Migration `078_alpha16_rule_operating_profiles.sql` adds nullable profile revision/hash/expiry and immutable source-version provenance to the existing config table. The existing immutable-payload trigger protects these fields. There is no new profile history table or source-version FK that could prolong expired definitions/evaluations/Runs. Legacy ACTIVE rows without a verified finite profile remain readable as definitions but do not admit new evaluation.

Restore's required current additive schema is 053–078. The existing config expiry and canonical guild deletion remove these metadata fields with their containing row. No individual data is added to configuration; new minimal audit retains its separate 14-day expiry. Run terminal retention stays seven days, backup stays seven days, evaluation evidence stays 48 hours. Independent target safety/publication/restore lifetimes remain separate and unconfigured.

Prepared `tests/unit/alpha16-operating-config.test.ts` and `tests/integration/alpha16-operating-config.test.ts` cover default disablement, strict server/profile binding, absence of Apply safety policy during valid evaluation admission, stale measurement/source/actor, immutable ACTIVE/RETIRED successors, original expiry ceiling, request replay, currentVersion, cancellation of queued evaluations, source revocation and minimal audit. They have not been executed. Real PC measurement/provider installation, operational retention/source configuration and G3 activation remain outstanding; they were not authorized or performed by this source change.
