import {describe,expect,it} from "vitest";
import {operationalNativeConfig} from "../../packages/rules/src/operational-context-native-contract";
import {aggregateReviewedQueue,completePostingCoverage} from "../../packages/rules/src/operational-context-native";

const at=new Date("2026-10-16T12:00:00Z");
const item=(key:string,minutes:number)=>({message_id:key,item_type:"OPERATIONS_REQUEST",version:3,status:"OPEN",opened_at:new Date(at.getTime()-minutes*60000),detected_at:new Date(at.getTime()-minutes*60000),updated_at:new Date(at.getTime()-60000)});
const review=(attentionKey:string,kind:"ACTIONABLE"|"NOISE"="ACTIONABLE")=>({attentionKey,expectedVersion:3,classification:kind,assignment:{kind:"DUTY" as const,ref:"TRIAGE" as const}});
describe("CASE13-20 exact existing native source contracts (synthetic only)",()=>{
 it("derives queue classification, oldest age and duty concentration from one complete saved population",()=>{
  const value=aggregateReviewedQueue([item("native-a",120),item("native-b",20)],[review("native-a"),review("native-b","NOISE")],at);
  expect(value).toMatchObject({actionable:1,noise:1,allReviewed:true,load:2,oldestMinutes:120,concentration:{state:"DEFINED",numerator:2,denominator:2,ratio:1}});
 });
 it("rejects partial review sets and stale native item versions",()=>{
  expect(()=>aggregateReviewedQueue([item("native-a",120)],[],at)).toThrow("CASE_NATIVE_QUEUE_REVIEW_INCOMPLETE");
  expect(()=>aggregateReviewedQueue([item("native-a",120)],[{...review("native-a"),expectedVersion:2}],at)).toThrow("CASE_NATIVE_QUEUE_VERSION_MISMATCH");
 });
 it("keeps absent assignments unknown and empty oldest age unknown rather than inventing a healthy queue",()=>{
  expect(aggregateReviewedQueue([item("native-a",120)],[{...review("native-a"),assignment:null}],at).concentration.state).toBe("SOURCE_UNKNOWN");
  expect(aggregateReviewedQueue([],[],at)).toMatchObject({load:0,oldestMinutes:null,concentration:{state:"UNDEFINED",denominator:0}});
 });
 it("accepts only role/duty references, existing record identities and explicit review classifications",()=>{
  const config={kind:"QUEUE_REVIEW",population:"CURRENT_RETAINED_NATIVE_ATTENTION_V1",itemTypes:["OPERATIONS_REQUEST"],reviews:[review("native-a")]};
  expect(operationalNativeConfig.parse(config)).toEqual(config);
  for(const extra of [{score:0.5},{memberId:"123456789012345678"},{body:"report narrative"},{actionableCount:15}])expect(()=>operationalNativeConfig.parse({...config,...extra})).toThrow();
  expect(()=>operationalNativeConfig.parse({...config,reviews:[{...review("native-a"),assignment:{kind:"PERSON",ref:"member"}}]})).toThrow();
 });
 it("does not accept FP counters, caller clocks, native approval or duplicate execution-review units",()=>{
  const config={kind:"FILTER_REVIEW",window:{start:"2026-10-16T10:00:00Z",end:"2026-10-16T11:00:00Z"},filter:{ruleHash:"a".repeat(64),expectedVersion:0,configuredLanguage:"ja-JP"},reviewSetId:"11111111-1111-4111-8111-111111111111",reviewUnit:"NATIVE_AUTOMOD_EXECUTION_EVENT",reviews:[{factId:"22222222-2222-4222-8222-222222222222",falsePositive:true}]};
  expect(operationalNativeConfig.parse(config)).toEqual(config);
  for(const extra of [{staffFpCount:30},{totalReviewed:30},{approved:true},{observedAt:at.toISOString()}])expect(()=>operationalNativeConfig.parse({...config,...extra})).toThrow();
  expect(()=>operationalNativeConfig.parse({...config,reviews:[...config.reviews,...config.reviews]})).toThrow();
 });
 it("requires actual complete location-stream and message intent coverage, not a nonempty sample",()=>{
  const start=new Date("2026-10-16T10:00:00Z"),end=new Date("2026-10-16T11:00:00Z"),row={first_seen:new Date("2026-10-16T09:00:00Z"),last_seen:at,epoch_start:new Date("2026-10-16T09:00:00Z"),epoch_end:null,introduced_at:new Date("2026-10-16T09:00:00Z"),gaps:false,gateway_state:"CONNECTED",last_gateway_at:at,messages:"AVAILABLE"};
  expect(completePostingCoverage(row,start,end,at)).toBe(true);
  for(const changed of [{gaps:true},{messages:"UNKNOWN"},{epoch_start:null},{last_gateway_at:new Date("2026-10-16T10:00:00Z")},{introduced_at:new Date("2026-10-16T10:30:00Z")}])expect(completePostingCoverage({...row,...changed},start,end,at)).toBe(false);
 });
 it("cannot enter platform alert types or fabricate aggregate viewing / low-posting states through a native source config",()=>{
  expect(operationalNativeConfig.parse({kind:"PLATFORM_ALERT"})).toEqual({kind:"PLATFORM_ALERT"});
  for(const field of [{platformAlertType:"NONE"},{platformAlertType:"RAID_ALERT"},{sourceAvailable:true},{postingActivity:"LOW_CONFIRMED"}])expect(()=>operationalNativeConfig.parse({kind:"PLATFORM_ALERT",...field})).toThrow();
 });
});
