import {z} from "zod";
/** Closed descriptors only. No Facts, observations, arbitrary SQL, code,
 * approval flags or source payload can be submitted through this schema. */
const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const instant=z.string().refine(value=>{
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);if(!match)return false;
 const ms=`${match[1]}.${(match[2]??"").padEnd(3,"0").slice(0,3)}Z`,at=Date.parse(ms);
 return Number.isFinite(at)&&new Date(at).toISOString()===ms;
});
const ref=z.object({observationId:z.uuid(),revision:identifier}).strict();
const period={windowStart:instant,windowEnd:instant,periodRole:z.enum(["CURRENT","PREVIOUS"])};
const currentPeriod={...period,periodRole:z.literal("CURRENT")};
const target={targetId:identifier,liveVersion:identifier};
const sourceConfig=z.object({sourceId:z.uuid(),revisionId:z.uuid()}).strict().optional();
export const nativeSourceRequest=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("AUTO_RUN_OUTCOMES"),flowId:identifier,liveRevision:z.number().int().positive(),...period,healthRefs:z.array(ref).min(1).max(20).optional()}).strict(),
 z.object({kind:z.literal("REPORT_DELIVERY"),scheduleId:z.uuid(),liveRevision:z.number().int().positive(),...period,healthRefs:z.array(ref).max(20).optional()}).strict(),
 z.object({kind:z.literal("REPORT_GENERATION_STATE"),scheduleId:z.uuid(),liveRevision:z.number().int().positive(),healthRefs:z.array(ref).max(20).optional()}).strict(),
 z.object({kind:z.literal("EXPERIMENT_STATE"),issueCode:identifier,...target,healthRefs:z.array(ref).min(1).max(20).optional()}).strict(),
 z.object({kind:z.literal("PLAYBOOK_STATE"),issueCode:identifier,...target,healthRefs:z.array(ref).min(1).max(20).optional()}).strict(),
 z.object({kind:z.literal("STRUCTURED_ISSUE_PERIODS"),issueCode:identifier,...target,baseTargetType:identifier,baseTargetId:identifier,baseLiveVersion:identifier,periods:z.array(z.object({windowStart:instant,windowEnd:instant}).strict()).length(3),healthRefs:z.array(ref).min(1).max(20).optional()}).strict(),
 z.object({kind:z.literal("DATA_SOURCE_HEALTH"),healthRef:ref}).strict(),
 z.object({kind:z.literal("ONBOARDING_FIRST_ACTION"),...target,...currentPeriod,sourceConfig}).strict(),
 z.object({kind:z.literal("HELP_BACKLOG_COHORT"),...target,...currentPeriod,sourceConfig}).strict(),
 z.object({kind:z.literal("ENGAGEMENT_CONTINUATION_COHORT"),...target,...currentPeriod,sourceConfig}).strict(),
 z.object({kind:z.literal("CHANNEL_PARTICIPATION_COHORT"),channelId:z.string().regex(/^\d{17,20}$/),liveVersion:identifier,...period,sourceConfig}).strict(),
 z.object({kind:z.literal("EVENT_RSVP_ATTENDANCE_COHORT"),...target,...period,sourceConfig}).strict(),
 z.object({kind:z.literal("AUTO_EXECUTION_OBSERVATION"),flowId:identifier,liveRevision:z.number().int().positive(),...currentPeriod,healthRefs:z.array(ref).min(1).max(20).optional()}).strict(),
 z.object({kind:z.literal("PERMISSION_REQUIREMENTS"),...target,...currentPeriod,healthRefs:z.array(ref).min(2).max(20).optional()}).strict(),
]);
export type NativeSourceRequest=z.infer<typeof nativeSourceRequest>;
