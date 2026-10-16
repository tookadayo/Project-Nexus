/** Synthetic descriptors only. No operational profile, source or approval. */
export const nativeCaseIds={guild:"955500000000000001",channel:"955500000000000002",priorEvent:"955500000000000003",event:"955500000000000004",message:"955500000000000005"};
const current={start:"2026-10-08T00:00:00Z",end:"2026-10-15T00:00:00Z"},prior={start:"2026-10-01T00:00:00Z",end:"2026-10-08T00:00:00Z"};
const period=(window:typeof current)=>({windowKind:"ELAPSED",timeZone:"UTC",window});
export const nativeCaseWindows={current,prior};
export const nativeCaseSourceDescriptors=[
 {kind:"WELCOME_REPLIES",settingsRevision:1,channelId:nativeCaseIds.channel,rootMessageIds:[nativeCaseIds.message],flowVersionId:null},
 {kind:"CANONICAL_ISSUE",settingsRevision:1,channelId:nativeCaseIds.channel,attentionKey:nativeCaseIds.message,attentionVersion:0,reopenContract:"SAME_NATIVE_ISSUE_CLOSED_TO_OPEN_V1"},
 {kind:"MATURED_PARTICIPATION",settingsRevision:1,channelIds:[nativeCaseIds.channel],signals:["message.sent"],campaignClass:"SYNTHETIC_CAMPAIGN",newSeries:{current:{joinWindow:{start:"2026-10-08T00:00:00Z",end:"2026-10-09T00:00:00Z"},period:period(current)},prior:{joinWindow:{start:"2026-10-01T00:00:00Z",end:"2026-10-02T00:00:00Z"},period:period(prior)},maturityOffsetSeconds:0,maturityWindowSeconds:86400},establishedSeries:{current:{joinWindow:{start:"2026-09-30T00:00:00Z",end:"2026-10-01T00:00:00Z"},period:period(current)},prior:{joinWindow:{start:"2026-09-23T00:00:00Z",end:"2026-09-24T00:00:00Z"},period:period(prior)},maturityOffsetSeconds:8*86400,maturityWindowSeconds:86400}},
 {kind:"UPCOMING_EVENT",settingsRevision:1,eventId:nativeCaseIds.event},
 {kind:"FORMAT_COMPARISON",settingsRevision:1,channelIds:[nativeCaseIds.channel],purposeClass:"STUDY",current:{eventIds:[nativeCaseIds.event],period:period(current)},prior:{eventIds:[nativeCaseIds.priorEvent],period:period(prior)},minN:2,comparisonContract:"FORMAT.DEDICATED_ATTENDANCE_COMPARISON_V1"},
 {kind:"INTEGRATION_ERRORS",settingsRevision:1,contract:"CURRENT_NATIVE_INTEGRATION_COMPONENT_ERRORS_V1"},
 {kind:"CHANNEL_MESSAGE_COUNT",settingsRevision:1,channelId:nativeCaseIds.channel,population:"ALL_OBSERVED_HUMAN_POSTS_V1"},
 {kind:"EVENT_REPEAT",settingsRevision:1,channelIds:[nativeCaseIds.channel],current:{eventIds:[nativeCaseIds.event],period:period(current)},prior:{eventIds:[nativeCaseIds.priorEvent],period:period(prior)},campaignClass:"SYNTHETIC_EVENT_SERIES",repeatContract:"EVENT.REPEAT_WINDOW_V1"},
 {kind:"ANNOUNCEMENT_MENTIONS",settingsRevision:1,channelId:nativeCaseIds.channel,messageId:nativeCaseIds.message,countContract:"DISTINCT_ROLE_EVERYONE_TARGETS_V1"}
] as const;
