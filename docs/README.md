# NEXUS documentation

Current release: **0.6.0-alpha.14** — Community operations UX, official announcements and private legal review. PostgreSQL is the normalized billing and
entitlement source of truth. Current documents retain their established paths
where moving them would create unnecessary link churn.

本準備の基点となる保存済み実装は **alpha15・alpha16**（[alpha15の実装記録](design/alpha15-scratch-implementation-evidence.md)、[alpha16の検証状況](design/alpha16-validation-status.md)）です。**alpha17** は、このPCで追加した運用準備と合成ローカル検証を指します。公開リリースは上記の **0.6.0-alpha.14** のままで、各検証記録の未完了事項と本番受入を確認してください。

- [運用PC準備と未完了事項](design/alpha17-pc-setup-status.md)

- [DB接続のcold/warm診断と未達条件](design/alpha17-db-connection-diagnosis.md)

- [連携検証計画](design/alpha17-integration-validation-plan.md)
- [統合検証の結果と未完了事項](design/alpha17-integration-validation-status.md)

## alpha17 運用PC準備

- [起動・停止・診断の入口](../起動用/README.md)
- [今回の設計と許可範囲](design/alpha17-operations-plan.md)
- [Operator policy・最小権限と期限処理](design/alpha17-operator-wiring.md)
- [DB／Redisの配置と未実施条件](design/alpha17-datastore-operations.md)
- [静的公開の世代切替と未確認のhosting能力](design/alpha17-static-publication.md)
- [WinSCPのstaging限定転送](design/alpha17-winscp-staging.md)
- [Windows転送helperの終了・隔離検証](design/alpha17-windows-job.md)
## alpha14

- [Scope and local verification](alpha14-acceptance.md)
- [Official site](official-site-r3.md)
- [Announcements and private legal review](alpha14-official-publications-acceptance.md)
- [Publication conditions](alpha14-publication-gates.md)
- [Existing test failures](alpha14-existing-test-failures.md)

## Website design

- [alpha.8 implementation and validation](alpha8-community-operations.md)
- [alpha.8 market parity decisions](research/alpha8-market-parity.md)

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

- [alpha.11 analysis clarity, follow-up and focused verification](alpha11-analysis-clarity.md)
- [alpha.10 Discord UX, analysis lifecycle, usage and recovery](alpha10-analysis-operations.md)

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

- [alpha.12 implementation and focused verification](alpha12-hosted-beta.md)
- [alpha.12 outbox review fixes and delivery regression](alpha12-outbox-review-fixes.md)
- [alpha.12 local operator procedures (Mac / Windows 11)](alpha12-operator-operations.md)
- [alpha.12 authentication and data lifecycle inventory](alpha12-data-inventory.md)
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

- [alpha.9 owner-gated commerce design and validation](alpha9-owner-commerce.md)
