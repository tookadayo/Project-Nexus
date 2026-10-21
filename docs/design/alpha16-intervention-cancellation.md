# Native intervention cancellation

`packages/lifecycle/src/intervention-control.ts` adds the existing lifecycle run's pre-admission cancellation path. It uses the existing `suppressed` terminal state with fixed reason `OPERATOR_CANCELLED`; no new Run kind, state table, retained payload or permission is introduced.

The request binds the selected run and its observed `suggested`, `approval` or `queued` state through the existing lifecycle Web request ledger, prepared key, fingerprint and `If-Match`. A current authorized server proof is required again after locks. The native transaction locks the run then its delivery queue, rejects any attempt/admission/unresolved delivery, stops only unsent pending queue rows, and terminalizes the run. The existing worker claims only queued runs and must win that same row lock, so a concurrent delivery claim prevents a false cancellation result. Delivered, running or unknown effects are not recalled or retried.

The 14-day minimal operation audit uses a constant target class; it does not copy the Run ID, participant, message, variable or result into a longer-lived record. The existing source run retains its own purpose and deadline. The new capability still depends on the existing lifecycle request policy, which has no operational default.

This is source implementation only. No existing run was cancelled and no test, database or external delivery was executed. The G5 checks must cover stale state, a delivery claim racing cancellation, previous attempts, current proof expiry, and duplicate request identities.
