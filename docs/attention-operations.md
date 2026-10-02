# Attention and team operations

The existing Attention lifecycle remains OPEN, ACKNOWLEDGED, SNOOZED, RESOLVED. Alpha.5 persists the reason, target surface, threshold, evidence, opened/acknowledged/resolved timestamps and resolution reason. Legacy acknowledgement/open timestamps remain unknown; they are excluded from latency statistics.

Text newcomer posts require a direct human reply. Administrator-mapped Support and LFG posts require another human participant in the observed post. Reactions, mentions, archive and lock do not resolve the queue. Forum response observations never set the direct-reply flag. Observed replies can automatically close a corresponding operational item. Operational resolution is separate from confirmed question resolution.

Integration failures are their own operational items and warnings. A cancelled event with observed signups creates an event review item. These are factual context, not a moderation casebook or a community health score.

Team statistics describe the stored queue: open backlog, oldest known opened item, acknowledgement/resolution medians, p75 resolution, opened/resolved counts and surface breakdown. There are no per-staff rankings or activity scores.

An action locks its scoped Attention row, verifies its current state, changes the lifecycle and inserts an idempotent `PANEL_REFRESH` outbox operation in the same transaction. Duplicate ACK/Resolve returns the existing result. The worker renders and edits the installed Discord panel outside a transaction/lock, respects the shared REST limiter and Retry-After, retries an idempotent edit safely and fences completion with a lease token. A refresh never creates a replacement message after an ambiguous edit. Pending refreshes for an already-rendered state can be coalesced while retaining their durable keys and completion records.

Recommendations require versioned evidence, sufficient sample, complete required coverage, compatible comparison periods and definitions, no unresolved collection gap, no severe integration failure and no incident caveat. They describe what happened, the evidence, why review is useful, a proposed action and the measurement to review afterwards. No causation is claimed. Unsupported alpha.4 comparison advice is suppressed.
