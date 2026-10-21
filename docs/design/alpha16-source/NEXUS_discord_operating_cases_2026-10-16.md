# NEXUS: Discord operating cases and deterministic recommendation branches

Research verified: 2026-10-16. Scope: public operating accounts and official guidance. No private Discord messages were collected. This is research and rule-design input, not implementation.

## What the evidence can and cannot establish

- **Documented operator case** means an identifiable operator described what their community did. It does not mean a controlled experiment established causality.
- **Operating practice** means a real community publishes the workflow it uses. Its effectiveness is not quantified unless expressly stated.
- **Official guidance** describes supported features or suggested practice; it is not a measured case study.
- Every **NEXUS branch** below is our proposed deterministic interpretation, not a claim that the source tested that rule.
- Historical counts describe the article's reporting period. They are not current server sizes. Undated articles are marked undated rather than given an invented publication date.
- Some old Discord community URLs now redirect to a new landing page. One announcement article remains available on Discord's `pax.discord.com` subdomain and is labeled preserved guidance below.
- No source supports a universal good retention percentage, universal response deadline, or causal guarantee that an event, welcome, or new channel improves a community.

## 20 evidence-backed operating patterns

### 01. Newcomers cannot find a usable first destination

**Type / date:** Official product guidance; updated 2023-03-31, checked 2026-10-16.

**Source:** [Community Onboarding FAQ](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ)

**Documented evidence/action:** Discord describes confusion around bots, roles, and channel lists. Onboarding assigns channels and roles through short questions; nonessential questions can wait until after joining. Administrators can preview the experience. Channels omitted from defaults/questions may be hard to discover. No quantified outcome is reported.

**Safe signals:** Configured default channels; role/permission preview failures; number of required steps; administrator-recorded newcomer navigation reports. Native onboarding/view analytics are usable only if actually available through an authorized source.

**NEXUS branches (inferred):**
- Destination invisible or unwritable: recommend a permission-path review first.
- Destination accessible but many mandatory choices: shorten optional choices and name one clear first action.
- Existing members cannot find a new channel: update discoverability, not the join flow alone.
- Controls protect a private/sensitive area: retain protection while simplifying instructions.

**Avoid / limits:** Do not disable safety gates merely because posting is low. Do not claim to measure unseen join-step abandonment. Preview with representative roles before proposing changes.

### 02. Newcomers introduce themselves but receive no human welcome

**Type / date:** Documented operator case, Photography Lounge / Ari Dutilh; undated article.

**Source:** [Photography Community](https://discord.com/community/case-study-photography-community)

**Documented evidence/action/outcome:** A beginner-friendly photography server used introductions and personal welcomes, alongside weekly themed photo contests. The operator reported new-member retention around 20–30% and attributed part of it to immediate human interaction; this attribution was not experimentally tested. The same article recommends inactive-member pruning and a mass revival ping, which should not be adopted as defaults.

**Safe signals:** In a designated introductions channel, aggregate first posts lacking a non-bot reply, wait duration, and voluntary welcome-duty coverage.

**NEXUS branches (inferred):**
- No human reply during staffed periods: propose a small welcoming rotation.
- Automated welcomes but no human replies: show these separately.
- Many greetings but no continuing conversation: offer one interest-linked next destination rather than more greetings.
- Introduction optional or intentionally quiet: suppress participation-pressure advice.

**Avoid / limits:** Never force personal introductions, infer loneliness, or remove quiet members. Do not copy the historical retention percentage as a target. Human replies indicate contact, not necessarily a good welcome.

### 03. Help requests remain unanswered: timing, expertise, or visibility?

**Type / date:** Current published operating practice; Python Discord; undated.

**Source:** [Python Discord Help Channels](https://www.pythondiscord.com/pages/guides/pydis-guides/help-channel-guide/)

**Documented evidence/action:** Python Discord separates specialist topical channels from a general help forum. It explicitly explains that unanswered questions can reflect quiet hours or unavailable expertise. Askers/staff control closure, solved sessions remain searchable, and the workflow limits concurrent posts per asker. No response-rate outcome is supplied.

**Safe signals:** Help-forum post age; explicit topic/status tags; bot-versus-human replies; staff-selected expertise categories; advertised service hours.

**NEXUS branches (inferred):**
- No reply outside published coverage: wait for the next coverage window.
- No reply during coverage, broad topic: include in one bounded unanswered queue.
- Specialist tag with no available specialist: recommend an appropriate topic route, preserving the original context link.
- Explicit awaiting-details status: request the missing detail once rather than pinging more helpers.
- Solved by asker: remove from unanswered queue.

**Avoid / limits:** A bot acknowledgment, any reply, inactivity, or archive state is not resolution. Avoid duplicate cross-posting and mass helper mentions. Replicate workflow principles, not Python Discord's concurrency restriction blindly.

### 04. Questions receive answers that do not help the asker progress

**Type / date:** Current published operating practice; Python Discord; undated.

**Source:** [Helping Others](https://www.pythondiscord.com/pages/guides/pydis-guides/helping-others/)

**Documented evidence/action:** Python Discord asks helpers to understand the underlying problem, request missing information, adapt explanations, and teach rather than merely supply finished answers. It distinguishes closing a question from helping someone understand. No measured improvement is reported.

**Safe signals:** Explicit asker status choices; unresolved/reopened counts; staff-reviewed clarification categories. Avoid automated evaluation of a member's intelligence or expertise.

**NEXUS branches (inferred):**
- Answer exists but asker marks unclear: suggest one clarifying follow-up or a simpler worked example.
- Missing reproduction/error information: suggest a concise intake checklist.
- Repeated reopening on one documented topic: review its guide for missing steps.
- No asker confirmation: retain unknown outcome rather than declaring either failure or success.

**Avoid / limits:** Message length, quick replies, and reaction counts cannot establish answer quality. Do not shame beginners, auto-grade helpers, or enforce a long form on every casual question. Helpful-clarification completion and explicit resolution are better local evaluation criteria than raw answer volume.

### 05. Rapid member growth is followed by diluted participation

**Type / date:** Documented operator case; MCAT / Shrooberry; undated.

**Source:** [MCAT Community](https://discord.com/community/case-study-mcat-community)

**Documented evidence/action/outcome:** The operator described rapid growth and engagement around a 30% benchmark. They added recurring game nights, professional AMAs, study parties, and opt-in event notification roles. They also offered distinctive study materials and sessions. The article says the problem was addressed but supplies no post-change uplift or controlled comparison.

**Safe signals:** Join-cohort counts; explicitly defined participation denominators; opt-in event interests; recurring event participation; published community purpose.

**NEXUS branches (inferred):**
- Joining grows while returning participation falls: inspect newcomer access/contact before increasing promotion.
- Existing members return but new members do not: run a newcomer-suitable session with a clear next step.
- Interest exists and hosts have capacity: pilot one repeatable, purpose-linked activity.
- Hosts are overloaded: improve existing sessions before adding another.

**Avoid / limits:** Do not infer students' health, finances, academic status, or motivation. Do not copy healthcare content into unrelated communities. Separate campaign visitors from established members and never promise the historical benchmark as an expected result.

### 06. Successful events outgrow the available moderation team

**Type / date:** Documented operator case; 100 gecs / Avery; undated.

**Source:** [100 Gecs Community](https://discord.com/community/case-study-100-gecs)

**Documented evidence/action/outcome:** Online music festivals attracted new members. The operator reported difficulty recruiting enough capable, willing moderators, then tightened permissions and automated routine moderation. They said this reduced some manual work and bought recruitment time. Member-growth figures are historical; moderation reductions are qualitative.

**Safe signals:** Event schedules; aggregate joins; queue age; unassigned cases; human-confirmed repetitive violations; willing coverage slots.

**NEXUS branches (inferred):**
- Event influx plus rising queue delay: recommend temporary coverage and a tested event plan.
- Repetitive, unambiguous spam dominates: propose a narrow rule for staff review.
- Context-dependent reports dominate: add human triage, not broader punishment automation.
- Team cannot cover the next event: reduce scope or capacity before inviting more attendees.

**Avoid / limits:** Do not automatically sanction people for being new, copying a phrase, or matching a simplistic score. Do not select moderators solely by activity. The source is not evidence that stringent moderation is always better or that automated punishment eliminates the need for an appeals path.

### 07. The planned event format does not fit community behavior

**Type / date:** Documented operator case; Delta Force / Kyle Zhou; undated.

**Source:** [Delta Force community case study](https://discord.com/developer-case-studies/delta-force)

**Documented evidence/action/outcome:** The team reported limited turnout for art contests and more than 100 submissions for an April Fools' meme event. They maintained dedicated suggestions/bug channels and separated critical fixes from longer-term requests. Reported 30–50% retention lacks a disclosed denominator/window and should not be reused as a benchmark.

**Safe signals:** Event-type submission counts; explicit member preference polls; operational effort; structured bug/request tags; acknowledgement age.

**NEXUS branches (inferred):**
- One format repeatedly underperforms with similar visibility: test a lower-barrier format members explicitly request.
- Interest is strong but attendance weak: inspect timing/access before changing the theme.
- Critical bug reports accumulate: recommend a responsible-owner escalation.
- Feature requests accumulate: publish a review/status cadence rather than promise delivery.

**Avoid / limits:** Do not scrape developer DMs, infer sentiment or demographics, or equate meme volume with unanimous preference. The event comparison is observational, not proof of a causal format effect. Cross-platform branding and launch campaigns confound general growth claims.

### 08. A long release gap leaves regulars without a shared activity

**Type / date:** Documented retrospective; Sabotage Studio; published 2026-02-05, campaign 2019–2022.

**Source:** [Sabotage Studio interactive community case](https://discord.com/developer-case-studies/sabotage)

**Documented evidence/action/outcome:** Sabotage ran a story-based ARG, faction activities, and automated game systems during a multi-year release gap. Winning participants were recognized in an in-game trophy. A backer-verification bot encountered spam-filter problems under an initial surge; the account reports processing over 10,000 backers. No controlled retention uplift is given.

**Safe signals:** Announced release intervals; opted-in activity participation; host capacity; task-completion totals; integration error counts.

**NEXUS branches (inferred):**
- Known content gap plus voluntary interest: propose a small collaborative challenge connected to the community's purpose.
- High participation but rising operational errors: stabilize the existing activity before expansion.
- Little demand: offer a lighter asynchronous activity or allow a quiet period.

**Avoid / limits:** Do not copy rigid three-strike bans, scripted DM vetting, public personal recognition, or engagement currency automatically. Avoid activity farming and unnecessary custom-bot development. Historical custom systems show possible patterns, not current platform guarantees or proof that every waiting period needs gamification.

### 09. Members submit ideas but cannot see what happened next

**Type / date:** Documented operator case; Rocket League Germany / Tom; undated.

**Source:** [Rocket League Germany](https://discord.com/community/case-study-rocket-league-germany)

**Documented evidence/action:** The operator describes direct interaction, responding to member requests, and providing voice discussions or a suggestion channel. The historical server had over 28,000 members and 15 moderators. No measured effect of suggestions or a staffing ratio is established.

**Safe signals:** Structured suggestion status; acknowledgement time; scheduled review dates; named role owning review; duplicate-topic counts confirmed by staff.

**NEXUS branches (inferred):**
- Many suggestions have no acknowledgement: recommend an intake owner and visible review cadence.
- Acknowledged but undecided: publish a short status and next review date.
- Accepted but blocked: identify the dependency without inventing a delivery commitment.
- Declined or duplicate: link the explanation or canonical issue respectfully.
- Voice-only feedback: offer an equivalent text route.

**Avoid / limits:** Votes do not settle safety, inclusion, or feasibility decisions. Do not infer staff needs from a historical members-to-moderators ratio. No automatic promise to implement popular suggestions; no exposure of confidential staffing discussions.

### 10. Conversation is dispersed across overlapping channels

**Type / date:** Official community guidance; undated.

**Sources:** [Understanding Server Insights](https://discord.com/community/understanding-server-insights); [Channel Categories and Names](https://discord.com/community/channel-categories-and-names)

**Documented guidance:** Discord warns that excess channels can spread conversation thin, advises reading activity in context, and recommends concise, distinct names, useful topics, and role-based visibility checks. It also says short activity dips can reflect external circumstances. No measured universal threshold is established.

**Safe signals:** Administrator-labeled channel purpose; unique human contributors; conversations/threads; explicit overlap labels; authorized aggregate readership, if supplied; active permissions.

**NEXUS branches (inferred):**
- Same purpose, low use, no protected function: propose one reversible consolidation trial.
- High readership but few posts: retain as a resource channel.
- Seasonal/event purpose: mark dormant and schedule review around its season.
- New channel: wait through an adequate observation period.
- Confusing names or hidden destination: fix discoverability before consolidation.

**Avoid / limits:** Do not delete channels from message count alone. Exempt reporting, accessibility, rules, archive, and specialist resources. Preserve history and redirect links. A bot may not possess native readership metrics; missing data must remain unknown, not zero.

### 11. An event is judged only by its headcount

**Type / date:** Official community guidance; undated.

**Source:** [Understanding Event Metrics](https://discord.com/community/understanding-event-metrics)

**Documented guidance:** Discord advises scheduling around availability, improving events incrementally, and evaluating their purpose. It notes that community-led events can be smaller than moderator-led events and still matter. Its numeric rules of thumb are not validated universal benchmarks.

**Safe signals:** Scheduled start/time zone; opt-in availability polls; registrations; aggregate attendance where technically available; event purpose; organizer effort; voluntary feedback.

**NEXUS branches (inferred):**
- High registrations, low attendance: check permissions, reminder delivery, time clarity, and last-minute changes.
- Low registrations but good attendee feedback: improve discoverability or keep the intentionally small format.
- High first attendance but low repeat: ask a brief optional format question, rather than assert dissatisfaction.
- Community-led event lacks resources: offer a host checklist and bounded moderator support.

**Avoid / limits:** Do not infer a member's physical location from activity hours. Attendance is not equivalent to speaking time or satisfaction. Avoid forcing successful small events to scale. Compare similar formats, durations, cohorts, and stated objectives.

### 12. Important announcements compete with routine chatter and pings

**Type / date:** Official preserved community guidance, dated 2023-08-22; publishing FAQ updated 2025-04-01.

**Sources:** [Server Information and Announcement Channels](https://pax.discord.com/community/server-information-and-announcement-channels); [Announcement Channel FAQ](https://support.discord.com/hc/en-us/articles/360032008192-Announcement-Channel-FAQ)

**Documented guidance:** Discord distinguishes durable reference information from new updates, recommends leading with important context, and describes optional news-notification roles. Published announcement posts can appear in following servers; publishing changes the audience.

**Safe signals:** Announcement category; authorized mention counts; canonical update link; duplicates; explicit report of missing information; published/unpublished state where available.

**NEXUS branches (inferred):**
- Repeated routine mass pings: propose opt-in topic notifications or a digest.
- Members repeatedly ask an already-announced operational detail: check visibility and a concise reference page.
- Time-sensitive correction: surface the changed fact and exact audience to an authorized operator.
- Topic update suitable for external followers: propose publishing only after checking audience/content.

**Avoid / limits:** Never assume reactions prove that everyone read an announcement. Do not publish internal incidents, private plans, or support details to follower servers. Do not use missing reaction counts as evidence of notification fatigue.

### 13. Important moderation work is buried in noisy logs

**Type / date:** Official moderation guidance; 2022-06-03.

**Source:** [Creating Moderation Team Channels](https://discord.com/safety/creating-moderation-team-channels)

**Documented guidance:** Discord suggests private moderator spaces fitted to actual needs, a readily available handbook, separate censor logs to inspect false positives, and separation of noisy logging from actionable coordination. It explicitly discourages creating every possible channel by default. No quantified outcome is supplied.

**Safe signals:** Aggregate unresolved queue size; oldest unassigned item; acknowledged alerts; explicit case owner/status; configuration metadata. Sensitive case bodies stay outside ordinary engagement analytics.

**NEXUS branches (inferred):**
- Critical alerts mixed with high-volume bot logs: recommend a restricted triage queue.
- Duplicate action on one case: add explicit ownership and handoff status.
- Recurring rule ambiguity: update a short staff decision reference.
- Tiny team and low volume: use one structured queue rather than a channel hierarchy.

**Avoid / limits:** Do not create broad surveillance logs merely because a guide lists them. Do not expose reports in public dashboards. More channels can worsen fragmentation; the goal is an accountable next action, not maximum logging.

### 14. Moderation coverage depends on too few volunteers

**Type / date:** Official moderation guidance; 2022-06-03.

**Source:** [Understanding and Avoiding Moderator Burnout](https://discord.com/safety/understanding-and-avoiding-moderator-burnout)

**Documented guidance:** Discord recommends breaks, shared duties, clear expectations, voluntary channel assignments, rotation, and appreciation. This is wellbeing guidance, not a validated method to diagnose burnout from behavior.

**Safe signals:** Explicit availability; opted-in rota; aggregate queue load; assignment concentration; stated capacity limits. Health information and private staff conversations are unnecessary.

**NEXUS branches (inferred):**
- Queue delay rises while coverage is thin: recommend redistributing duties or reducing event scope.
- One person owns most pending work: ask a lead to arrange backup coverage.
- A volunteer explicitly requests a break: remove expected coverage and plan a handoff.
- Load is low but duty expectations are unclear: clarify responsibilities rather than recruit by default.

**Avoid / limits:** Never label someone burned out, depressed, introverted, or unreliable from posting/online patterns. Do not turn volunteer work into surveillance or a performance leaderboard. Do not prescribe more social events as a remedy for an already overloaded team.

### 15. A moderation filter creates preventable false positives

**Type / date:** Official product documentation; updated 2026-06-15.

**Source:** [AutoMod FAQ](https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ)

**Documented behavior:** AutoMod supports configurable keyword rules, exemptions, alerts, and responses. Discord states custom keyword rules accept multiple languages; the listed ready-made word lists and spam-content filter are English-only. Some filters use machine learning, so the external platform's behavior must not be described as wholly deterministic.

**Safe signals:** Rule identifier/version; aggregate flags; human-confirmed false-positive count; affected channel category; language configured by the administrator; outcome of a staff review.

**NEXUS branches (inferred):**
- False positives cluster on one rule: propose a narrow matching/exemption review.
- Several filters overlap: inspect which rule actually triggered before changing all of them.
- No review data: recommend an alert-review sample, not a correctness claim.
- Non-English community: do not assume built-in English lists cover its needs.

**Avoid / limits:** No automatic guilt, sanction escalation, or global allowlisting from a keyword hit. Keep NEXUS's deterministic recommendations distinct from third-party probabilistic safety signals. Narrow exceptions must not silently exempt broad sensitive areas.

### 16. A burst of joins may be legitimate attention or a raid

**Type / date:** Official safety guidance; updated 2023-07-28.

**Source:** [How to Protect Your Server from Raids 101](https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101)

**Documented guidance:** Discord describes raid preparation and response using AutoMod, mention-spam controls, Slowmode, temporary verification changes, and reporting. It advises returning verification settings after the raid is stopped. No universal join-rate threshold is supplied.

**Safe signals:** Aggregate join rate; known campaign/event calendar; observed repeated disruptive actions; staff incident status; safety-system alert type. Use minimal incident data and restricted access.

**NEXUS branches (inferred):**
- Join spike matches a planned launch and no disruption: monitor capacity; do not classify a raid.
- Join spike plus repeated confirmed abuse: prioritize the incident playbook over growth advice.
- Only a platform warning exists: request staff review and show uncertainty.
- Incident resolved: remind an authorized moderator to review temporary restrictions and affected legitimate members.

**Avoid / limits:** No automatic bans based solely on account age, avatar, shared language, or being newly joined. NEXUS recommendations should not silently change security settings. Growth and safety priorities need an explicit incident override.

### 17. Reporting or transparency could expose the people being protected

**Type / date:** Official moderation guidance; 2022-06-03.

**Source:** [Confidentiality in Moderation](https://discord.com/safety/confidentiality-in-moderation)

**Documented guidance:** Discord warns that sharing every detail even within staff can expose unnecessary personal information. Sensitive cases may require a narrower leadership group; logs can retain information that should not persist. Transparency must be balanced against privacy. No measured outcome is reported.

**Safe signals:** Report-channel permissions; access-role count; retention configuration; aggregate case count/status with small-group suppression. Not report narratives, private messages, or personal attributes.

**NEXUS branches (inferred):**
- Public report route exposes complainants: recommend an authorized private reporting path.
- Public summary includes identifiable details: recommend redaction and aggregate status only.
- Sensitive information copied into broad logs: route to an authorized privacy review.
- Feedback is ordinary and public by design: preserve an easy public channel without requiring private disclosure.

**Avoid / limits:** Do not ingest report contents into ordinary community recommendations, deanonymize reporters, or publish accused-person lists. Do not retain deleted-message bodies by default. Incident handling belongs to authorized humans, with a specific purpose and limited access.

### 18. An image-only update or voice-only event excludes some members

**Type / date:** Official accessibility/product guidance; image-upload article updated 2026-06-11; accessibility blog 2022-07-07.

**Sources:** [Image uploads and alt text](https://support.discord.com/hc/en-us/articles/211866427-How-do-I-upload-images-and-GIFs); [Discord accessibility improvements](https://discord.com/blog/improving-app-accessibility-a11y-updates)

**Documented guidance:** Discord supports image descriptions, advises describing communicative meaning including relevant image text, and documents keyboard/screen-reader support and text chat in voice channels. These are capabilities, not proof that every server uses them well.

**Safe signals:** Attachment description presence where exposed; announcement format checklist; text companion channel; voluntary access feedback. No disability profiling.

**NEXUS branches (inferred):**
- Operational details exist only in an image: suggest equivalent plain text and a useful description.
- Voice event lacks a text participation route: propose one with a text facilitator.
- Decorative image has redundant adjacent text: avoid duplicate verbosity.
- Access problem is reported: route the specific barrier for review without naming affected members publicly.

**Avoid / limits:** Do not infer disability from participation mode, require diagnosis disclosure, or record/transcribe voice without explicit consent and an appropriate policy. Presence of alt text is not proof of quality or accessibility compliance.

### 19. A quiet community may still be serving its readers

**Type / date:** Official historical community guidance; published 2020-12-03, update noted 2020-12-22.

**Source:** [Fostering a Thriving, Partner-Worthy Community](https://discord.com/blog/fostering-a-thriving-partner-worthy-community-on-discord)

**Documented guidance:** Discord explicitly treats reading/viewing as participation, describes optional introductions, and illustrates self-assignable roles for desired notifications and finding teammates. It recommends walking through the newcomer experience. Historical Partner Program requirements in the article should not become NEXUS's generic health thresholds.

**Safe signals:** Purpose designated by administrators; aggregate readership/return data only when supplied through an authorized source; voluntary reactions and explicit feedback; no per-person lurker labels.

**NEXUS branches (inferred):**
- Resource server, stable visits, low posting: report stable consumption; suppress generic activation advice.
- Social server, members ask for easier entry: offer one optional low-pressure participation format.
- Read data unavailable: describe message activity only, not total engagement.
- Good reading but missed urgent tasks: improve task clarity rather than demand conversation.

**Avoid / limits:** Never prune, shame, or contact individual non-posters automatically. Do not infer shyness, disengagement, or personal wellbeing from silence. Offer choice; do not redefine every reader as a failed contributor.

### 20. Long-running discussions get buried or mistaken for resolved work

**Type / date:** Official product guidance; updated 2024-10-24.

**Source:** [Forum Channels FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ)

**Documented behavior:** Forums organize discussions as posts, with guidelines, tags, filtering, and inactivity-based movement to Older Posts. Discord recommends gradual rollout and feedback. Automatic inactivity handling and manual closing/locking have different implications; neither establishes that a problem was solved.

**Safe signals:** Channel type; post tags; explicit status; last reply time; archive/lock state; staff-reported confusion; role accessibility.

**NEXUS branches (inferred):**
- Multiple overlapping help discussions are buried in live chat: propose one forum pilot.
- Help post becomes old without an explicit resolution: retain unresolved/unknown state.
- Forum exists but posting is low: check onboarding visibility and tag complexity first.
- Ongoing casual chat works well: leave it in text chat.
- Pilot creates friction: retain a fallback route and review before expansion.

**Avoid / limits:** Do not convert every channel, delete history, or equate archived with solved. Verify actual current server capabilities and permissions before proposing setup steps. A forum is an organizational tool, not a substitute for available helpers.

## Deterministic rule design implications

The following is original design synthesis. It specifies explainable behavior, not a model that learns member traits.

### A. Use a decision ladder, not a single engagement score

1. **Safety incident?** Show the restricted incident route; suppress growth prompts likely to worsen it.
2. **Data available and fresh?** If missing, unavailable, bot-dominated, or too small, return a bounded observation or abstain.
3. **Access works?** Broken permission or onboarding paths take precedence over motivational advice.
4. **A person/task awaits response?** Route unresolved help, unacknowledged suggestions, or first-contact gaps before proposing new activities.
5. **Operating capacity sufficient?** If not, redistribute/reduce work before adding events or channels.
6. **What purpose is the space serving?** Distinguish live conversation, reference information, support, announcements, seasonal activity, and confidential reporting.
7. **What reversible change addresses the specific bottleneck?** Choose one with a defined owner and review condition.

### B. Keep state distinctions explicit

For support, a useful finite state set is:
- newly opened
- no human response yet
- awaiting asker information
- awaiting specialist
- discussion ongoing
- asker-confirmed solved
- staff-closed with a reason
- inactive/archived, outcome unknown

A reply event alone can move a post out of “no human response”; it cannot move it into “solved.” Human-set tags or explicit workflow commands should carry those meanings. Unsupported inference should yield `unknown`.

For suggestions, distinguish submitted, acknowledged, under review, accepted, declined with reason, duplicate, blocked, and completed. “Accepted” is not “scheduled” and must not become an implied promise.

For events, distinguish interested/registered, attended, contributed, opted into future notices, and explicit feedback. Do not call an RSVP attendee or a voice-channel connection a speaker.

### C. Example branches with deliberately different actions

These are hypothetical examples, not measured server facts or production thresholds.

1. **Help burst after a release:** Thirty posts arrive, many with the same staff-confirmed version issue. Recommend a visible known-issue note linked from the intake form and a single owner for updates. Do not send thirty identical helper pings.
2. **Quiet specialist queue:** Four niche questions wait overnight and the advertised specialist coverage begins tomorrow. Recommend waiting until that coverage window, then reviewing unresolved posts. Do not call the server unresponsive.
3. **Busy chat hides first contact:** General chat is active, but several introduction posts have no human response. Recommend welcome coverage in that channel, not a server-wide event.
4. **Many replies, unresolved requests:** Help threads have many messages but explicit “still stuck” status. Recommend clarification or specialist handoff, not a celebratory response-rate report.
5. **Resource channel has no messages:** The channel is intentionally staff-only and references are still accessed. Retain it and check freshness. Do not merge it into general chat.
6. **Two overlapping hobby channels:** Both are opt-in, lightly used, and admins confirm the same purpose. Propose a time-bounded shared-topic trial with preserved archives and an easy reversal.
7. **Event success overloads staff:** Registrations are high and old moderation cases remain unassigned. Recommend a smaller event or additional willing hosts. Do not recommend more promotion.
8. **Attendance falls after time change:** The format is unchanged, but the event moved by several hours. First test schedule/access explanations. Do not infer that members lost interest.
9. **One-time campaign attracts visitors:** Join count spikes while the established cohort remains steady. Report campaign-cohort behavior separately; do not portray it as community-wide decline.
10. **Safety filter is catching ordinary words:** Staff-confirmed false positives cluster on a specific rule. Recommend a narrow review and retest. Do not exempt every established member or disable all filtering.
11. **A raid ends:** The incident status is resolved but temporary restrictions remain. Recommend a security review with an authorized operator and a restoration checklist. Do not silently reopen the server.
12. **Image-only event poster:** The date, time, and join instructions exist only in the graphic. Recommend text equivalents once; do not repeatedly ping members who did not react.

### D. Inputs that do not require learning or sensitive inference

- Administrator-configured channel purposes and exceptions.
- Explicit workflow tags, commands, status transitions, opt-in interests, and duty availability.
- Counts/timestamps from authorized channels, filtered by human/bot/system origin.
- Role/channel access checks against a known expected path.
- Explicit event metadata, posting templates, rule identifiers, and administrator-confirmed incident states.
- Optional, authorized aggregate exports from native analytics, clearly distinguished from bot-derived metrics.
- A small amount of administrator annotation for things automation cannot know: seasonal context, special-purpose channels, response expectations, whether a post was helpful, whether an incident was confirmed.

A rule engine need not secretly become a sentiment model. If text matching is used, describe it as a candidate trigger with narrow vocabulary and human review, not an understanding of sarcasm, intent, relationship quality, or toxicity.

### E. Recommendation record required for auditability

Each generated recommendation should contain:
- rule ID and version;
- evaluated time window and data coverage;
- observed facts with denominators;
- explicit reason this branch matched;
- known alternative explanations;
- one bounded proposed action and responsible role;
- who may see it;
- required authorization before a state change;
- a review/expiry date and cancellation condition;
- a reversible fallback;
- source references marked case, practice, or guidance;
- confidence in the **observation**, distinct from confidence in the **recommended intervention**.

For example, “8 of 12 new help posts had no non-bot reply during published support hours” is an observation. “There may be a coverage gap” is a hypothesis. “Review the queue and assign one available helper” is the proposed action. They should never be collapsed into “members are being ignored.”

### F. Evaluation without self-learning

Compare like-for-like periods and preserve context in the report. Use predeclared windows, criteria, and administrator-controlled thresholds. Outcomes should be relevant to the action: fewer unacknowledged requests, reduced queue age, verified access fixes, clearer suggestion states, confirmed resolution, accessible information, or sustainable host workload. More messages is often the wrong target.

Rules may be manually versioned after operator review. Do not silently optimize them against activity, automatically learn individual profiles, or treat a correlation as evidence of efficacy. Keep negative or null outcomes and make it easy to stop an ineffective recommendation.

### G. Privacy and operational guardrails

- No DMs, private conversations, medical inference, age inference, location inference, disability labels, political/religious categories, or hidden personality scores.
- Collect only authorized fields needed for the rule; retain aggregates where possible and suppress small-group reporting according to a declared privacy policy.
- Sensitive incident/report content must not feed general engagement analytics. Access to operational metadata still requires a justified role and purpose.
- Missing permission, partial coverage, expired data, and inaccessible native analytics are separate states, not zeros.
- Avoid intrusive “we noticed you stopped posting” outreach. Recommend server-level improvements, not pressure on named quiet members.
- Read-only recommendations do not authorize sending pings, moving channels, changing permissions, moderating people, publishing to followers, or implementing a large update.

## Priority for an initial practical rule catalogue

1. Unanswered-help state and coverage review.
2. First-contact and onboarding access failures.
3. Suggestions without an owner or visible status.
4. Moderator queue/capacity mismatch.
5. Announcement clarity and accessible text alternatives.
6. Event logistics and purpose-aware review.
7. Channel overlap with protected-purpose exclusions.
8. Safety incident override and post-incident restriction review.

These are specific enough to produce different next actions for superficially similar “low activity” situations. They also support an honest “no recommendation” outcome when evidence is missing or the server is already serving its intended purpose.
