# Measurement evidence contract

NEXUS separates the value, observation state and coverage state. `0` is an observed result; it cannot stand for missing input, an empty eligible denominator, an unfinished window or unknown permissions.

Every current canonical and adaptive metric carries a `MetricEvidence` record: definition/version, value, numerator, denominator, sample, required surfaces, evidence sources, window, collection epoch IDs, coverage reasons and comparison blockers. The older metric fields remain compatibility adapters. Consumers must read evidence before showing a percentage, comparison or recommendation.

Observation states are `OBSERVED`, `NO_ELIGIBLE`, `COLLECTING`, `INSUFFICIENT_SAMPLE`, `UNKNOWN`. Coverage states are independently `COMPLETE`, `PARTIAL`, `LOWER_BOUND`, `UNKNOWN`. A small observed count can still be useful; it does not authorize a comparison. Unknown and collecting values are null. Unknown denominators are null.

Required surfaces come from the metric definition, never a guild-wide partial flag. Private thread coverage affects thread measurements; it does not invalidate voice co-presence. A verified explicit channel scope can be complete even when Discord cannot provide a full guild channel census. “Complete” always refers to the declared scope and observation window.

Comparisons require sufficient samples, complete required coverage, attributed collection epochs, compatible definitions, equal non-overlapping windows, no collection gap and no major incident caveat. Capability or permission changes in a relevant window block comparison. Evidence describes observation, not causation.

Member eligibility requires independently observed `pending` and member flags. Legacy default false rows remain unknown. Direct replies require the Discord reply message type and default message reference, within the same channel/guild. Forward references, mentions and later messages in a channel are not direct replies. Thread responses, reactions, event subscriptions and voice co-presence keep their separate meanings.

Primary specifications: [message references](https://docs.discord.com/developers/resources/message), [threads](https://docs.discord.com/developers/topics/threads), [voice states](https://docs.discord.com/developers/resources/voice), [scheduled events](https://docs.discord.com/developers/resources/guild-scheduled-event). Verified 2026-10-02.
