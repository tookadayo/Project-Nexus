# alpha15 source checkpoint before alpha16

2026-10-16. This is a source-saving checkpoint, not a release or deployment acceptance record.

## Authorized scope

The owner authorized saving alpha15 to its existing origin work branch before proceeding to alpha16. Work continues in `D:\Project Nexus`, branch `codex/alpha15-web-blocks`, from `e37fd32d4f7bcfabcc34d3a682de1a8e5910a92d`. The verified origin is `https://github.com/tookadayo/Project-Nexus.git`. No new checkout or project folder is created.

The approved Clear Product Phase A/B public website and dashboard baseline is saved separately from the alpha15 Scratch, numerical-engine and date/time continuation. Its existing source, production image assets, fixtures and historical reports remain together. See [Phase A](design/clear-product-phase-a-report.md) and [Phase B](design/clear-product-phase-b-report.md). This does not discard or silently replace those earlier changes.

The alpha15 continuation includes its required application sources, test sources, fixed third-party inputs, notices and source archives, source design documents, and implementation records:

- [Scratch implementation and acceptance evidence](design/alpha15-scratch-implementation-evidence.md).
- [Fixed numerical-engine source and distribution record](design/alpha15-math-engine-distribution.md).
- [Approved date/time design](design/alpha15-datetime-approved-20261016.md) and [implementation evidence](design/alpha15-datetime-implementation-evidence.md).
- [Earlier alpha15 implementation](alpha15-implementation.md), [coverage](alpha15-design-coverage.md) and [external validation](alpha15-external-validation.md).

`apps/web/next-env.d.ts` retains its pre-existing local development-route references as an unstaged generated change. `.local`, `.next`, dependencies, credentials, private legal inputs, browser reports and runtime-generated evidence are excluded. Vendored upstream source archives and runtime bundles are intentional required dependencies and licensing/reconstruction material, not local build caches.

## Saving exact artifacts

The checkout uses `core.autocrlf=true`. A read-only Git blob comparison found that normal filtering would change the vendored gmp-wasm bundle (raw blob `c8b5ac20e7930a940cea60b08438912a4402d294`, filtered blob `da3bf482a2c8bb2d7ea755b055a13b1b286ea2c5`). Its loader verifies the original SHA256, so this checkpoint adds only Git storage attributes for immutable vendor files and the recorded numerical reference fixture/generator. Application and dependency contents are unchanged. Existing nested license attributes remain in force.

The vendored `SOURCES.json` verification flags and collection timestamp describe the earlier collection/verification event. They do not certify this checkpoint as an externally distributed binary release, a rebuilt binary, a modified-library relink demonstration or completed distribution compliance. Existing notices, source material, procedures and remaining obligations are retained without upgrading those historical claims.

## Verification status

The owner deferred consolidated functional verification and fixes until alpha16 implementation is complete. No additional application test, type check, lint, benchmark or build is run for this saving operation. Git status/diff, candidate-file inspection, credential-pattern review, immutable-file hashes, index contents and remote references are inspected only to save the correct contents safely.

Earlier recorded checks remain historical evidence. The Scratch record contains its own unit/DB/browser runs and acceptance matrix; the later date/time record separately contains 209 selected unit, 67 selected DB/API and 33 browser cases. These overlap earlier work and must not be combined into a new all-feature acceptance total. Saving or pushing this checkpoint does not mark pending tests or external gates as passed.

## Remaining matters and alpha16 handoff

- The earlier Scratch matrix retained partial/unexecuted rows, including Choice ordinal and other specifically documented cases. The later date/time implementation covers the approved date/time portion without rewriting the old matrix as fully accepted.
- Saved resolved Instants, evaluated values and Run/schedule checkpoints remain fixed. Unevaluated time-zone-dependent calculations use current Intl; retaining a prior tzdb for all future calculations is not implemented.
- Actual Discord/OAuth, public HTTPS, target hosting/Tunnel operation, original-reference-image fidelity, real Windows credential ACL acceptance, backup expiry/offline restoration and distribution-specific numerical-engine obligations retain their documented limits.
- Rule-based AI is reserved for alpha16. No alpha16 implementation starts in this saving operation; the parent will supply the latest formal design first.
- The adopted **A deployment places all Next.js/BFF execution on the server PC as well**. The earlier read-only inventory's conclusion that every Next DB call must be moved into a separate API is superseded by that placement choice and must not be implemented as a new requirement. The public website/dashboard delivery boundary and Tunnel routing follow the forthcoming formal design.

The saving procedure uses ordinary commits and a non-forced push to the work branch. It does not merge master, deploy, alter production data, generate credentials, change network/security settings, or resolve conflicts destructively. Final commit IDs and the observed remote branch head are reported after the push; this document does not presume a successful push before it occurs.
