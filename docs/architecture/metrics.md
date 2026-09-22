# Minimal analytics contract

All metric objects contain value (number or null), sampleSize, coverage and coverageRatio. Rates are fractions, not percentage points. Only PRODUCTION membership episodes joined in the selected interval are included. The overview query is capped at 45 days; default is the last 30 days. No individual lookup or cohort breakdown UI is provided in this slice, so no small-cohort data is published.

| Metric | Definition / denominator |
| --- | --- |
| New Members | Number of membership episodes joined in range; rejoins are separate episodes |
| Onboarding Start Rate | Episodes with a NEXUS start / all episodes |
| Onboarding Completion Rate | Started episodes with completion / started episodes |
| Activation Rate | First start-channel message within the configured window / episodes whose full activation window has elapsed |
| Silent Joiner Rate | No observed message within activation window / fully matured episodes |
| Median / P75 TTFV | Seconds from join to earliest activation; linear-interpolated quantiles among activated episodes |
| D1 / D7 / D30 Active Retention | A message in [join+D days, join+(D+1) days); only fully elapsed windows in the denominator |
| First Response Rate | First newcomer message receiving an explicit reply within 24h / first messages observed for at least 24h |
| Median First Response Time | Latency among qualifying first-message replies above |
| Unanswered after 1h / 6h / 24h | Count without reply by that threshold; sampleSize is messages old enough for that threshold |

Existing responder means their membership episode began before the newcomer episode. Bots and self replies do not qualify. Only explicit message references qualify. General message rows do not store reply target IDs; target rows receive only receivedExplicitReply and firstReplyLatencySeconds. Missing target metadata remains pending in the short-lived stream and lowers coverage.

Coverage is observed time divided by the requested observation span, subtracting the union of known gaps. Before the first heartbeat is unobserved. Last heartbeat has a 90-second liveness tolerance. Unresolved ingestion failures create open coverage gaps. Zero coverage suppresses values. All metric coverage currently uses the same conservative guild-wide time coverage; it is not a per-feature availability guarantee.

Metrics are computed deterministically on reads. Materialized long-term aggregate reports, advanced cohort analysis and native onboarding / voice activity collectors are outside WP-08's minimal slice. Tables and package boundaries allow subsequent work without introducing those features now.
