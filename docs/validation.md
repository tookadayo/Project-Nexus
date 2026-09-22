# Validation record

2026-09-22, Windows, Node.js 24.18.1, pnpm 11.19.0.

## Local implementation gate

| Check | Result before quality pass |
| --- | --- |
| ESLint | PASS |
| TypeScript (strict root + web) | PASS |
| Vitest unit / property | 12 passed |
| PostgreSQL / Redis integration | 13 passed |
| Turborepo / Next.js production build | 17 packages passed |
| Playwright browser E2E | 2 passed |

The full integration scenario uses real PostgreSQL, Redis Streams, BullMQ, Ed25519-signed HTTP requests, domain services, Outbox execution and scoped API reads. Discord REST is simulated. Tests verify preference changes revoke a proved NEXUS grant, not an unrelated manual grant.

Browser E2E starts an isolated PostgreSQL instance and the real API/Next.js services. Its fixture database is synthetic and separate from production. Screenshots: test-results/overview-desktop.png and test-results/overview-mobile.png.

## Not executed

- Live Discord installation, Client rendering, native Modal interaction, Gateway RESUME and REST permissions: user confirmed .env is not prepared.
- Linux Docker/Testcontainers route: Docker is unavailable on this Windows host.
- Production deployment/load testing: outside requested scope.

## Quality review

In progress. No skipped tests, disabled typechecking or weakened assertions are used to conceal failures. Pending items include additional recovery/retention boundary checks and packaging documentation review.
