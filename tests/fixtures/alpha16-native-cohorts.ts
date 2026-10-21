import type {NativeCohortDefinition} from "../../packages/rules/src/native-cohort-config";
const common={settingsRevision:3,campaignClass:"FIXTURE_NATIVE_COHORT",timeZone:"UTC"};
export const nativeCohortDefinitions:NativeCohortDefinition[]=[
 {kind:"ONBOARDING_FIRST_ACTION",...common,flowVersionId:"a1682000-0000-4000-8000-000000000001",flowTargetVersion:"3:3:fixture",activationRevisionId:"a1682000-0000-4000-8000-000000000002",observationSeconds:86400,windowDays:7},
 {kind:"HELP_BACKLOG_COHORT",...common,panels:[{panelId:"a1682000-0000-4000-8000-000000000003",version:2}],slaSeconds:86400,stalledAfterSeconds:172800,windowDays:7},
 {kind:"ENGAGEMENT_CONTINUATION_COHORT",...common,channelIds:["933333333333333330"],signals:["message.sent"],windowDays:7},
 {kind:"CHANNEL_PARTICIPATION_COHORT",...common,channelId:"933333333333333330",channelTargetVersion:"a".repeat(64),populationChannelIds:["933333333333333330","933333333333333331"],signals:["message.sent"],windowDays:7},
 {kind:"EVENT_RSVP_ATTENDANCE_COHORT",...common,eventIds:["944444444444444440"],channelIds:["933333333333333332"],confirmation:"DISCORD_SUBSCRIPTION_AT_EVENT_START",attendance:"OBSERVED_VOICE_STAGE",windowDays:28},
];
