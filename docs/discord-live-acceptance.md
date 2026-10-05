# Discord live acceptance — alpha.7

Status: **PARTIAL** (2026-10-02). Read-only REST acceptance against the configured development guild passed: bot-member screening and flags were explicitly returned, capability discovery succeeded, and three channels were observable with a known current total. No identifiers or credentials were written to the public record. Automated tests use fake Discord transports, recorded metadata and local PostgreSQL/Redis. Developer Portal toggles and real multi-account actions have not been exercised. Controlled multi-account activity, live OAuth, Gateway reconnect/intent-loss acceptance and Developer Portal obfuscation toggles were **NOT RUN**. The environment provides one development Bot/guild but no controlled participants or the full seven-guild acceptance setup.

| Controlled guild      | Required scenario                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Small text            | Join, explicit pending/guest observation, post, direct reply, forward, mention, later unrelated message                |
| LFG + threads + voice | Administrator-mapped LFG purpose, other-human thread response, reaction/poll, five-minute co-presence, move/AFK/leave  |
| Forum support         | Question, first human response, mapped resolved tag; archive/lock must not resolve                                     |
| Event + Stage         | Signup/remove/signup; delivered ACTIVE voice/stage presence; audience/speaker transitions; external attendance UNKNOWN |
| Large / mixed         | Aggregate queues, median/p75 sample gate, selected scopes and teams; no personal ranking                               |
| Non-Community         | Ordinary text/voice without inventing Community-only features                                                          |
| Missing visibility    | Missing VIEW_CHANNEL, private threads, permission loss/restoration and affected metrics only                           |

For each scenario record collection epoch, normalized signal, scoped final projection, metric evidence, Discord payload and Web display. Use IDs in protected test records, not public audit screenshots. Repeat events/reconnect safely; verify final state and action dedupe. Do not send production-wide messages or move roles on unrelated members.

## Channel Obfuscation acceptance

Discord's [official rollout notice](https://docs.discord.com/developers/change-log#channel-obfuscation-for-users-and-bots) specifies the 2026-11-16 REST/Gateway change. Developer Portal → application → Bot → Private Channel Obfuscation supports early Gateway testing. Enable it only in the controlled test application, or use the documented Gateway capability when appropriate. The early Gateway option does not itself opt REST into the later behavior.

1. Remove VIEW_CHANNEL on a controlled channel. Deliver an obfuscated channel payload and verify only documented usable metadata is retained. No hidden name/tag/owner may assign purpose.
2. Exercise a visible-only Get Guild Channels fixture before the REST rollout; exercise the real omission after rollout when available.
3. Verify visible count can be shown while the server total and percentage remain unavailable/lower-bound. Previous snapshots must not restore an old total.
4. Use an explicit observable include scope to verify metric-specific completeness can differ from server-wide census completeness.
5. Restore permissions, refresh capabilities and verify scope-change epochs block direct comparison across the transition.

## Release record

Automated replay, coverage, normalizer, integration and payload tests are reported separately in the quality audit. Full live acceptance remains incomplete until the controlled scenarios actually run. The reproducible read-only check is `node --import tsx scripts/discord-read-only-acceptance.ts`; it sends no messages and changes no Discord settings. Privileged intent approval and the obfuscation Portal drill remain hosted rollout requirements.
