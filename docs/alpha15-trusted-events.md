# alpha15 trusted event ingress

Internal `ticketCreated` and `ticketUpdated` triggers use the existing operations
domain outbox. A ticket means an explicitly submitted OperationsIntake request:
the same guild must contain both its `OPERATIONS_REQUEST` attention record and
the actual request whose ID matches `intake:<uuid>`. Ordinary attention items,
analysis concerns, integration health signals and caller-provided event objects
do not qualify. Created events and versioned/status updates are captured at the
source transaction's commit. Intake creates its attention/outbox before its
request row, so the capture trigger is deferred until the complete record exists.
Recipients, active revision and generation are fixed in that transaction;
enabling a flow never replays historical outbox rows. Other outbox consumers keep
their independent `expanded_at` behavior.

Only selected registered fields become run inputs: `event.ticket` (TicketRef),
`event.state` (the fixed state Enum), `event.version` (Number), and
`event.occurredAt` (Instant). No evidence, message text, intake form contents or
profile is copied. Immediately before admission, the flow enabler's encrypted
identity is opened, current membership and CONFIGURE access are fetched again,
and settings, Beta generation, flow generation and revision are checked.

Discord interaction triggers are reached through the existing Discord panel's
Automations menu. It issues native component tokens bound to the current person,
guild, application, channel, flow revision/generation and a 15 minute instance.
Each instance can be used once; opening a new menu supersedes unused buttons.
There is no new Discord command or external event endpoint. The existing HTTP
edge validates Discord's signature and application ID, or receives a genuine
authenticated Gateway interaction, acknowledges before database work, then saves
an encrypted job and transport receipt. The automation bridge reads that job and
its acknowledgement diagnostic from the database. A Web manual button cannot
create this proof. Guild, person, application, channel, native token, instance,
revision, generation, acknowledgement deadline and current CONFIGURE permission
must all match. The run belongs to the actual person who pressed the button.

Interaction inputs are optional metadata only: `interaction.member` (MemberRef),
`interaction.channel` (ChannelRef), and `interaction.occurredAt` (Instant). This
increment does not adopt arbitrary modal fields or message content. The durable
inbox has a unique source/event/flow/revision key, and claiming a native instance
and enqueueing its receipt are atomic. An uncertain response is reconciled from
that receipt instead of repeating an external operation. A distinct second click
cannot reuse the instance. Pending, started and skipped receipt metadata can be
shown in the authenticated Web console without inputs or actor identities.

The worker considers at most 20 receipts per pass. Capture is bounded at 20
pending receipts per guild and 100 on the host, and 1,000 retained receipts per
guild and 10,000 on the host. Temporary native instances have the same retained
row ceilings and expire after 15 minutes. These conservative host safety limits
are not commercial plan capacity or a performance claim. Overflow does not create
a catch-up subscription. Admission still uses the separately measured run quota
and concurrent execution policy. A failed permission, expired deadline, changed
generation or unavailable admission is terminal for that receipt.

Pending receipts contain the required identifiers, state/version, timestamps and,
only for interaction admission, its encrypted actor identity. Admission clears
the ticket/channel input metadata and encrypted identity as soon as the receipt
becomes started or skipped. Receipt status and deletion-linkage metadata are
physically removed within seven days of receipt creation. Expired native instances and their
component tokens are deleted by the worker sweep. Actor erasure deletes their
interaction receipts, native instances and tokens; deleting a flow/guild cascades
its receipt and instance records. Restored or changed generations cannot resume
old pending admission. Existing intake storage and administrative audit retention
remain their separate original purposes.

Global stop is fenced in the settings transaction, including when stop and resume
both happen between worker passes. Stop increments active flow generations,
requests cancellation of unfinished runs, expires pending/approved receipts,
skips pending event admission and clears its input metadata, and removes old native
instances and tokens. Intake committed while stopped cannot enter the inbox.
Both stop and resume advance a schedule admission cutoff, so an occurrence from
before resume is skipped even inside the normal one-second lateness tolerance.
Definitions remain active for fresh inputs after an explicit resume; old queued
work is not revived. A queued run checks cancellation and deadline again under
the reservation row lock before consuming usage. Cancellation/expiry before
processing releases the reservation; already consumed runs keep their usage.
An interrupted external write retains UNKNOWN precedence and its evidence.
The direct cancellation path also treats an already committed UNKNOWN operation
as unresolved: cancellation between the operation checkpoint and the run's
terminal checkpoint cannot replace the run-level unknown result with CANCELLED.

## Continuing the same Run (CT05)

The new `awaitEvent` statement is distinct from the trigger inbox above. It
registers one current structured intake TicketRef, selected registered ticket
states, a version baseline and an expiry within the Run's original deadline.
Only the first qualifying `ticketUpdated` committed after registration is fixed.
Source capture and registration share the existing admission fences; no message
body, request fields or new cross-Run history is copied. Each Run has at most
1,000 continuation rows, also bounded by its normal shared execution budget.

The current real Run actor's READ entitlement, logical ticket retention and
applicable channel visibility are checked at registration and result use, within
the same privacy-fenced transaction. Current publication restrictions accompany
the resulting state/version. Timeout exposes no result. Match consumption and
the execution cursor are committed together; a crash before that checkpoint
retains the same first match. Consumed matches cannot wake later waits. A
pending formal approval in another parallel branch does not lose an event wake.
Enabling a new revision preserves an already-started old-revision Run. Stop,
cancellation, target erasure, Run deletion and offline restore invalidate the
continuation. Migration 058 and the latest deletion tombstones are required
before restoring service. Sixteen focused substrate tests cover these paths.

CT11 is a bounded current `readTicket` operation, rather than an event trigger or
a Discord Poll. It fixes the target, maximum attempts, positive interval and
deadline on entry. Confirmed attempt results can be reused after a crash, with
current READ/retention/visibility rechecked and both old and current publication
restrictions retained. Read failures and UNKNOWN stop; uncertain writes are
never repeated. Both statements use the existing editable tree and existing
typed predicates, without the separate Scratch condition/arithmetic redesign.
