# Privileged intent operations

Verified against official Discord documentation on 2026-10-02. Recheck before hosted rollout or renewal: [Gateway intents](https://docs.discord.com/developers/events/gateway), [privileged intent access changes](https://support-dev.discord.com/hc/en-us/articles/40281523410967-Changes-to-Privileged-Intent-Access-for-Discord-Apps).

## Required and excluded intents

Guild Members is NEXUS's privileged intent. It supplies membership joins/leaves/updates, Rules Screening pending state, guest/native onboarding/Home Action flags when exposed, and supported thread membership observations. It is needed for reliable eligible newcomer denominators, lifecycle changes and member-state correctness. Available Discord features do not establish actual community purpose.

Message Content and Guild Presences are explicitly excluded. NEXUS does not read DMs or collect voice audio. Ordinary message/reaction/poll/voice/event intents provide only the metadata described in the [privacy inventory](privacy-data-inventory.md). Intent configuration and event delivery are separate observations; requesting an intent without a successful connection does not prove availability.

## Review and renewal

Discord requires privileged intent review for apps reaching **10,000 unique reachable users**, with annual reapplication for continuing access under the published policy. This is an app-level threshold, not guild size or the former guild-count threshold. Use Discord's application/Developer Portal evidence for the reachable-user threshold; NEXUS must not create a cross-server member identity to calculate it. Observe the Portal's notification/deadline, including the documented application period, rather than inventing a NEXUS-derived deadline.

Assign an owner and backup owner for review. Record approval, renewal due date, submitted purpose and policy changes in the deployment's operations register. Schedule the annual renewal externally with enough preparation time. Code implementation is not proof of Discord approval.

Review packet:

1. App ID and intended Guild Members use, installed bot intent configuration, minimum permissions and privacy boundary.
2. A test server showing an observed member join, screening pending → cleared, guest exclusion and UNKNOWN legacy state.
3. Discord Home and Web screenshots showing eligible counts, sample/coverage/method, recipe confirmation and the member-intent failure warning.
4. Privacy inventory, detailed retention choices, member and guild deletion demonstration, and authenticated tenant isolation.
5. Integration Health and Collection Health screenshots showing gap/intent loss comparison blockers.
6. Explanation of why standard intents alone cannot establish eligible newcomer membership and why Message Content/Presence are unnecessary.
7. Security controls: scoped IdentityVault encryption/HMAC, least privilege, current execution-time authorization, one-use verification, encrypted OAuth sessions, safe logs and secret management.
8. Genuine live acceptance evidence from controlled guilds. Synthetic fixtures must be labelled synthetic; never submit them as a live test.

Redact tokens, verification codes, personal identifiers and unrelated channels from review attachments. Keep request, approval and renewal records in the deployment's protected operations storage.

## Intent-loss runbook

1. Inspect Discord's Gateway close/error category and Developer Portal intent/approval state. Do not infer a permission or storage cause from a generic failure.
2. Stop interpreting newcomer, screening and membership lifecycle results as zero. Integration Health reports unavailable/unknown member observation; affected evidence excludes comparisons.
3. Confirm whether access was disabled, denied, not requested or simply not yet observed. A heartbeat does not prove member-intent availability.
4. Correct the app intent configuration or complete the required Discord review. Reconnect using the supported intent set.
5. Confirm fresh Gateway delivery and a new Collection Epoch. Missing history is a gap, not a backfill opportunity. Do not overwrite unknown legacy flags with false defaults.
6. Check scoped capability discovery, queue lag, new member eligibility and privacy deletion in a controlled server.
7. Resume recommendations only when sample, required coverage, definition versions and comparison windows are compatible and the measured window has no unresolved gap or severe incident caveat.

Current repository tests simulate intent availability/loss and safe fallback. They do not demonstrate Portal approval, annual renewal or production reachable-user eligibility.
