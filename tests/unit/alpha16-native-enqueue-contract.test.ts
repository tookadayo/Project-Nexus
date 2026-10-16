import {expect,it} from "vitest";
import {enqueueRequest} from "../../packages/rules/src/domain";
import {nativeSourceRequest} from "../../packages/rules/src/native-source-request";

const descriptor={kind:"AUTO_EXECUTION_OBSERVATION",flowId:"flow_fixture",liveRevision:1,
 windowStart:"2026-10-01T00:00:00Z",windowEnd:"2026-10-02T00:00:00Z",periodRole:"CURRENT"} as const;
const request={configVersion:1,inputs:[],nativeInputs:[descriptor],reason:"MANUAL"};
it("accepts a closed native resource descriptor without an earlier Fact snapshot",()=>{
 expect(enqueueRequest.parse(request)).toEqual(request);
 expect(enqueueRequest.safeParse({...request,nativeInputs:undefined}).success).toBe(false);
});
it("never lets a caller pick the enqueue clock or assert telemetry/approval",()=>{
 for(const extra of [{evaluationAsOf:"2026-10-02T00:00:00Z"},{approved:true},{sql:"SELECT 1"},{heartbeatAt:"2026-10-02T00:00:00Z"},{value:{eligible:"3",anomalous:"0"}}]){
  expect(enqueueRequest.safeParse({...request,nativeInputs:[{...descriptor,...extra}]}).success).toBe(false);
 }
 expect(enqueueRequest.safeParse({...request,evaluationAsOf:"2026-10-02T00:00:00Z"}).success).toBe(false);
});
it("bounds the native batch and rejects invalid timestamps and extra context",()=>{
 expect(enqueueRequest.safeParse({...request,nativeInputs:Array.from({length:21},()=>descriptor)}).success).toBe(false);
 expect(nativeSourceRequest.safeParse({...descriptor,windowStart:"2026-02-30T00:00:00Z"}).success).toBe(false);
 expect(nativeSourceRequest.safeParse({...descriptor,actorHash:"another-member"}).success).toBe(false);
});
