# NEXUS documentation

Current release: **0.6.0-alpha.7** — Stripe Commerce Launch Foundation. PostgreSQL is the normalized billing and
entitlement source of truth. Current documents retain their established paths
where moving them would create unnecessary link churn.

## Website design

- [Project Nexus product website and verified claims](design/nexus-website.md)
- [Website visual review and QA](design/nexus-website-qa.md)

## Billing and commercial contracts

- [Stripe integration and commerce architecture](billing/stripe-integration.md)
- [alpha.7 contract hardening](billing/contract-hardening-alpha7.md)
- [alpha.7 release validation](billing/contract-hardening-alpha7-validation.md)
- [Stripe readiness and Live gates](billing/stripe-readiness.md)
- [alpha.7 market validation](research/alpha7-market-validation.md)
- [Billing architecture](billing-architecture.md)
- [Billing security](billing-security.md)
- [Pricing and entitlements](pricing-entitlements.md)
- [Promotions and grants](promotion-system.md)
- [Discord Premium Apps](discord-premium-apps.md)
- [Plan migration](plan-migration.md)
- [Hosted beta blockers](hosted-beta-blockers.md)
- [Stripe readiness cleanup audit](billing/repository-cleanup.md)
- [Stripe readiness validation](billing/stripe-readiness-validation.md)

## Architecture, product and evidence

- [Measurement evidence contract](measurement-evidence-contract.md)
- [Collection epochs](collection-epochs.md)
- [Adaptive community model](adaptive-community-model.md)
- [Community recipes](community-recipe-presets.md)
- [Attention operations](attention-operations.md)
- [Metrics](architecture/metrics.md)
- [Scaling](scaling-architecture.md)
- [Background processing](background-processing.md)
- [Product language](product-language.md)

## Operations and security

- [Server verification](server-verification.md)
- [Backup and restore](backup-restore-operations.md)
- [Privacy inventory](privacy-data-inventory.md)
- [Privileged intents](privileged-intent-operations.md)
- [Discord capabilities](discord-capability-matrix.md)
- [Discord acceptance](discord-live-acceptance.md)
- [Validation](validation.md)

## Historical evidence

- [Release reports and quality audits](archive/releases/README.md)
- [Commercial hardening report](commercial-hardening-report.md) records the
  previous hardening pass; use the Stripe readiness document for current contracts.
- [Commercial repository audit](commercial-repository-audit.md) and
  [alpha.5 audit](alpha5-repository-audit.md) preserve the previous review evidence.
- `v02/`, the early architecture vertical-slice documents and ADRs retain useful
  historical design rationale. Historical source paths describe their original release.
