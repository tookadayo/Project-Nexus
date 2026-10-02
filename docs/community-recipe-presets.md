# Versioned community measurement recipes

Seven initial presets: Social, LFG / gaming, Support / forum, Creator / fan, Event / Stage, Voice first, Large / mixed. Existing Community Profile modes and explicit channel/tag mappings remain valid. The wizard separates available features, observed usage, candidate purposes and administrator confirmation. A channel or tag name is never a semantic source.

An immutable recipe revision freezes the preset definition, strong/supporting signals, aggregate transitions, voice threshold, later activity window, analysis scope, explicit mappings and operational context. Changing these creates a new revision. Changing an unrelated UI preference does not. New facts and membership episodes are pinned to the current revision. Existing confirmed profiles migrate to an `alpha4-profile-v1` record, not a guessed alpha.5 definition. Existing facts are not backfilled with a recipe.

| Preset | Main evidence | Aggregate transitions |
| --- | --- | --- |
| SOCIAL | Direct human replies, thread responses, qualified voice co-presence; reactions/polls support | Join → post; post → reply / first connection; connection → later activity |
| LFG_GAMING | Administrator-mapped LFG posts/responses and qualified co-presence | Join → LFG post; post → response; response → voice; voice → another day |
| SUPPORT_FORUM | First human response, mapped or explicit resolution | Question → response → confirmed resolution, matched to the same post |
| CREATOR_FAN | Reactions, poll participation, signup and provable attendance | Join → reaction / poll; signup → attendance |
| EVENT_STAGE | Signup, observed Voice/Stage attendance, another event attendance | Signup → attendance; attendance → another event |
| VOICE_FIRST | Voice join and qualified co-presence | Join → voice; voice → co-presence; co-presence → another day |
| LARGE_MIXED | Surface queues, aggregate transitions, coverage and latency quantiles | Independent text, question, event and later activity transitions |

Transitions are observations, not causal funnels or a personal activity history. They require chronological order and the correct unit: member, post or event/member. Repeated attendance means distinct observed event IDs; recurring-series inference is deferred. External or unknown event types cannot establish attendance. Archive/lock does not establish resolution. Reactions and event registration cannot establish a connection.

Entry mode is administrator context, not a conversion metric. Apply to Join starts after approved membership; applications, rejection and approval rates are unavailable. Discovery pre-join views and conversion are unavailable.
