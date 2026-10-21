import {z} from "zod";

const instant=z.string().datetime({offset:false});
const window=z.object({start:instant,end:instant}).strict().refine(value=>Date.parse(value.start)<Date.parse(value.end),"INVALID_SOURCE_WINDOW");
const key=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const bucket=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("ROLE"),ref:z.string().regex(/^\d{17,20}$/)}).strict(),
 z.object({kind:z.literal("DUTY"),ref:z.enum(["TRIAGE","RESPONSE","FOLLOW_UP","ON_CALL"])}).strict(),
]);
/** A finite, explicitly reviewed subset of the existing native Attention
 * queue. The declarations label queue items, never people or report text. */
const queue=z.object({kind:z.literal("QUEUE_REVIEW"),
 population:z.literal("CURRENT_RETAINED_NATIVE_ATTENTION_V1"),
 itemTypes:z.array(z.enum(["TEXT_NEWCOMER","FORUM_SUPPORT","LFG_RESPONSE","EVENT_OPERATION","INTEGRATION_HEALTH","METRIC_TREND","OPERATIONS_REQUEST","ANALYSIS_CONCERN"])).min(1).max(8),
 reviews:z.array(z.object({attentionKey:key,expectedVersion:z.number().safe().int().nonnegative(),classification:z.enum(["ACTIONABLE","NOISE","UNREVIEWED"]),assignment:bucket.nullable()}).strict()).max(500),
}).strict().refine(value=>new Set(value.itemTypes).size===value.itemTypes.length&&new Set(value.reviews.map(row=>row.attentionKey)).size===value.reviews.length,"DUPLICATE_QUEUE_SOURCE");
/** ruleHash already exists in native AutoMod metadata. The internal registry
 * revision/language are explicit configuration, not an invented Discord rule
 * version. Review units are execution events, not unique people/messages. */
const filter=z.object({kind:z.literal("FILTER_REVIEW"),window,
 filter:z.object({ruleHash:z.string().regex(/^[a-f0-9]{64}$/),expectedVersion:z.number().safe().int().nonnegative(),configuredLanguage:z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/)}).strict(),
 reviewSetId:z.uuid(),reviewUnit:z.literal("NATIVE_AUTOMOD_EXECUTION_EVENT"),
 reviews:z.array(z.object({factId:z.uuid(),falsePositive:z.boolean()}).strict()).max(500),
}).strict().refine(value=>new Set(value.reviews.map(row=>row.factId)).size===value.reviews.length,"DUPLICATE_REVIEW_UNIT");
export const operationalNativeConfig=z.discriminatedUnion("kind",[
 queue,filter,
 z.object({kind:z.literal("PLATFORM_ALERT")}).strict(),
 z.object({kind:z.literal("CHANNEL_POSTING"),window}).strict(),
]);
export type OperationalNativeConfig=z.infer<typeof operationalNativeConfig>;
export const OPERATIONAL_NATIVE_FIELDS:Readonly<Record<string,readonly string[]>>=Object.freeze({
 CASE13:["actionableCount","noiseCount"],
 CASE14:["queueLoadCount","oldestOpenQueueAgeMinutes","assignmentConcentrationState","assignmentConcentrationNumerator","assignmentConcentrationDenominator"],
 CASE15:["ruleId","ruleVersion","reviewSetRef","staffFpCount","totalReviewed","triggeredRuleCount","configuredLanguage"],
 CASE19:["postingAggregate"],
 CASE20:["lastReplyAt"],
});
