import {expect,it} from 'vitest';
import {MessageReferenceType,MessageType,ChannelFlags} from 'discord-api-types/v10';
import {memberEligibility} from '../../packages/shared/src/member-observation';
import {metricEvidence,comparisonEligibility,type EvidenceInput} from '../../packages/shared/src/metric-evidence';
import {normalizeMany,isDirectReply} from '../../packages/events/src/index';
import {IdentityVault} from '../../packages/identity/src/index';
const base:EvidenceInput={metricKey:'reply',definitionVersion:'reply-v2',definition:'A direct other-human reply',value:0,numerator:0,denominator:12,sampleSize:12,coverageState:'COMPLETE',requiredSurfaces:['messages'],evidenceSources:['MESSAGE_CREATE'],coverageReasons:[],windowStart:'2026-09-01T00:00:00Z',windowEnd:'2026-09-08T00:00:00Z',collectionEpochIds:['epoch']};
it.each([
 [{},'UNKNOWN'],
 [{screening_observed_at:'2026-10-02'},'UNKNOWN'],
 [{guest_observed_at:'2026-10-02'},'UNKNOWN'],
 [{screening_observed_at:'2026-10-02',guest_observed_at:'2026-10-02'},'ELIGIBLE'],
 [{screening_observed_at:'2026-10-02',screening_pending:true},'SCREENING_PENDING'],
 [{guest_observed_at:'2026-10-02',is_guest:true},'GUEST'],
] as const)('does not infer member eligibility from defaults (%j)',(fields,expected)=>{
 expect(memberEligibility({screening_pending:false,is_guest:false,screening_observed_at:null,guest_observed_at:null,...fields})).toBe(expected);
});
it.each([
 [{},'OBSERVED',0],
 [{denominator:0,sampleSize:0},'NO_ELIGIBLE',null],
 [{collecting:true},'COLLECTING',null],
 [{sampleSize:2},'INSUFFICIENT_SAMPLE',0],
 [{available:false},'UNKNOWN',null],
 [{coverageState:'UNKNOWN'},'UNKNOWN',null],
] as const)('preserves observation state (%j)',(fields,state,value)=>{
 const m=metricEvidence({...base,...fields});expect(m.observationState).toBe(state);expect(m.value).toBe(value);
});
it.each(['PARTIAL','LOWER_BOUND'] as const)('blocks comparison with %s coverage',coverageState=>{
 const m=metricEvidence({...base,coverageState});expect(m.value).toBe(0);expect(m.comparable).toBe(false);
});
it('blocks a collection gap and incompatible definitions/windows',()=>{
 expect(metricEvidence({...base,comparisonBlockers:['COLLECTION_GAP']}).comparisonBlockers).toContain('COLLECTION_GAP');
 const a=metricEvidence(base),b=metricEvidence({...base,definitionVersion:'reply-v1'});
 expect(comparisonEligibility(a,b).blockers).toEqual(expect.arrayContaining(['DEFINITION_MISMATCH','WINDOW_MISMATCH']));
});
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),guild='111111111111111111',channel='333333333333333333',message='444444444444444444';
const packet=(type:number,reference?:Record<string,unknown>)=>normalizeMany({t:'MESSAGE_CREATE',s:1,d:{guild_id:guild,id:message,channel_id:channel,author:{id:'222222222222222222',bot:false},timestamp:'2026-10-02T00:00:00.000Z',type,message_reference:reference,content:'DO NOT PERSIST',message_snapshots:[{message:{content:'SECRET'}}]}},0,'semantics',vault)[0]!;
it.each([
 [MessageType.Reply,{type:MessageReferenceType.Default,message_id:message},true],
 [MessageType.Reply,{message_id:message},true],
 [MessageType.Default,{type:MessageReferenceType.Forward,message_id:message},false],
 [MessageType.Reply,{type:MessageReferenceType.Forward,message_id:message},false],
 [MessageType.Default,{message_id:message},false],
 [MessageType.Default,undefined,false],
 [MessageType.Reply,{message_id:message,channel_id:'333333333333333334'},false],
])('separates direct reply from forward and same-channel posts', (type,reference,direct)=>{
 const e=packet(type as number,reference as Record<string,unknown>|undefined);expect(isDirectReply(e)).toBe(direct);expect(JSON.stringify(e)).not.toMatch(/SECRET|DO NOT PERSIST|snapshots|content/);
});
it('discards obfuscated metadata instead of trusting old names or types',()=>{
 const e=normalizeMany({t:'CHANNEL_UPDATE',s:1,d:{guild_id:guild,id:channel,type:0,flags:ChannelFlags.ChannelObfuscated,name:'hidden'}},0,'obfuscation',vault)[0]!;
 expect(e.channelObfuscated).toBe(true);expect(e.channelType).toBeUndefined();expect(JSON.stringify(e)).not.toContain('hidden');
});
