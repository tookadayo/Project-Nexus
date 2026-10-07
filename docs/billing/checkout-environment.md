# alpha.9 checkout environment

Use existing Discord OAuth/IdentityVault settings documented in
[server verification](../server-verification.md). No extra identity provider, email
scope or browser Discord secret is required. Migration 045 must be applied first.

Sandbox development requires `NEXUS_STRIPE_ENABLED=true`,
`NEXUS_STRIPE_MODE=SANDBOX`, test secret and publishable keys, signed webhook
secret, and Checkout/public-sales gates enabled. Use `NODE_ENV=development`;
production rejects test secret keys. Secrets belong in ignored environment files
or managed secret storage. Never set secret `NEXT_PUBLIC_*` variables.

`NEXUS_STRIPE_CHECKOUT_UI=ELEMENTS` is the default. Set `HOSTED` for rollback of
only the payment UI; Owner/Principal authorization remains. Portal needs the
existing restricted Portal configuration. Disabling new sales preserves receipt,
reconciliation and existing-contract management.

Live additionally requires every existing commercial/legal/Discord/operations
approval listed in `.env.example`, a production key and signed production webhook.
These defaults remain false. Do not enable Tax or Live from this validation work.
