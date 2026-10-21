import {describe,it,expect} from "vitest";
import {nativeCohortDefinition,nativeCohortRevisionRequest,nativeCohortTarget} from "../../packages/rules/src/native-cohort-config";
import {cohortRatio,nativeCohortWindow,nativeFirstActionSources} from "../../packages/rules/src/native-cohort-projections";
import {nativeSourceRequest} from "../../packages/rules/src/native-source-request";
import {nativeCohortDefinitions} from "../fixtures/alpha16-native-cohorts";
describe("alpha16 exact native cohort definitions and windows (fixture only)",()=>{
 it("requires typed native bindings and rejects arbitrary code/body/approval instead of accepting a generic source payload",()=>{
  for(const definition of nativeCohortDefinitions){expect(nativeCohortDefinition.safeParse(definition).success).toBe(true);for(const extra of [{sql:"SELECT *"},{body:"PRIVATE_MESSAGE"},{approved:true},{personalScore:1}])expect(nativeCohortDefinition.safeParse({...definition,...extra}).success).toBe(false);}
  expect(nativeCohortRevisionRequest.safeParse({sourceId:"a1682000-0000-4000-8000-000000000004",revisionId:"a1682000-0000-4000-8000-000000000005",baseVersion:0,enabled:true,definition:nativeCohortDefinitions[0]}).success).toBe(true);
 });
 it("uses seven calendar dates across both DST transitions rather than imposing 168 elapsed hours",()=>{
  const definition={...nativeCohortDefinitions[2]!,timeZone:"America/New_York"};
  expect(nativeCohortWindow(definition,"2026-10-26T04:00:00Z","2026-11-02T05:00:00Z")).toEqual({windowKind:"CALENDAR",previousStart:"2026-10-19T04:00:00.000000Z"});
  expect(nativeCohortWindow(definition,"2026-03-02T05:00:00Z","2026-03-09T04:00:00Z").windowKind).toBe("CALENDAR");
  expect(()=>nativeCohortWindow(definition,"2026-10-26T04:00:00Z","2026-11-02T04:00:00Z")).toThrow("NATIVE_COHORT_CALENDAR_WINDOW_MISMATCH");
  expect(()=>nativeCohortWindow(definition,"2026-10-26T12:00:00Z","2026-11-02T13:00:00Z")).toThrow("NATIVE_COHORT_CALENDAR_WINDOW_MISMATCH");
 });
 it("keeps II-B channel/event elapsed windows distinct from II-A calendar windows",()=>{
  const definition={...nativeCohortDefinitions[3]!,timeZone:"America/New_York"};
  expect(nativeCohortWindow(definition,"2026-10-26T04:00:00Z","2026-11-02T04:00:00Z").windowKind).toBe("ELAPSED");
  expect(()=>nativeCohortWindow(definition,"2026-10-26T04:00:00Z","2026-11-02T05:00:00Z")).toThrow("NATIVE_COHORT_ELAPSED_WINDOW_MISMATCH");
 });
 it("preserves empty populations and rejects an impossible intersection",()=>{
  expect(cohortRatio("0","0")).toEqual({kind:"ratio",numerator:"0",denominator:"0"});
  expect(cohortRatio("2","3","5")).toEqual({kind:"ratio",numerator:"2",denominator:"3",eligibleEvents:"5"});
  expect(()=>cohortRatio("4","3")).toThrow("RULE_COHORT_INTERSECTION_INVALID");
 });
 it("pins actual native Onboarding and channel observation versions rather than using the source head ordinal",()=>{
  expect(nativeCohortTarget("fixture-source",99,nativeCohortDefinitions[0]!).liveVersion).toBe("3:3:fixture");
  expect(nativeCohortTarget("fixture-source",99,nativeCohortDefinitions[3]!).liveVersion).toBe("a".repeat(64));
  expect(nativeCohortTarget("fixture-source",99,nativeCohortDefinitions[2]!).liveVersion).toBe("99");
 });
 it("does not prove historical REST or role absence from a current Gateway heartbeat",()=>{
  expect(nativeFirstActionSources({op:"event",event:"message.sent",withinSeconds:86400})).toEqual({intents:["messages"],supported:true});
  expect(nativeFirstActionSources({op:"all",rules:[{op:"role_present",roleId:"922222222222222222"},{op:"event",event:"voice.duration",withinSeconds:86400}]})).toEqual({intents:["voice"],supported:false});
  expect(nativeFirstActionSources({op:"event",event:"native_onboarding.observed_completed",withinSeconds:86400}).supported).toBe(false);
 });
 it("separates report generation point observation from retained delivery-window input",()=>{
  const request={kind:"REPORT_GENERATION_STATE",scheduleId:"a1682000-0000-4000-8000-000000000006",liveRevision:1};
  expect(nativeSourceRequest.safeParse(request).success).toBe(true);
  expect(nativeSourceRequest.safeParse({...request,lastSuccessAt:"2026-10-16T00:00:00Z"}).success).toBe(false);
  expect(nativeSourceRequest.safeParse({...request,approved:true}).success).toBe(false);
 });
});
