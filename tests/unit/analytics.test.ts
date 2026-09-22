import {expect,it} from 'vitest';
import fc from 'fast-check';
import {computeOverview,coverage,type MetricEvent} from '../../packages/analytics/src/index.js';
const day=86400000;
it('excludes TEST/PREVIEW and immature retention denominators',()=>{
 const episodes=[{id:'a',joinedAt:0,context:'PRODUCTION'},{id:'b',joinedAt:day*31,context:'PRODUCTION'},{id:'test',joinedAt:0,context:'TEST'}];
 const events=[{episodeId:'a',kind:'message.sent',at:day*30,context:'PRODUCTION',data:{}},{episodeId:'a',kind:'activation.completed',at:1000,context:'TEST',data:{}}];
 const result=computeOverview(episodes,events,0,day*32,day*32,1);
 expect(result.newMembers!.value).toBe(2);expect(result.d30ActiveRetention).toMatchObject({sampleSize:1,value:1});expect(result.activationRate!.value).toBe(0);
 expect(computeOverview(episodes,events,0,day*32,day*32,0).newMembers!.value).toBeNull();
});
it('union-merges coverage gaps and marks stale telemetry unavailable',()=>{
 expect(coverage(0,100,0,100,[{start:10,end:40},{start:20,end:50}],100)).toBe(0.6);
 expect(coverage(0,100,null,null,[],100)).toBe(0);
});
it('duplicate and reordered events yield identical metrics',()=>{
 fc.assert(fc.property(fc.array(fc.integer({min:1,max:10}),{minLength:1,maxLength:40}),values=>{
  const episodes=[{id:'a',joinedAt:0,context:'PRODUCTION'}];
  const events:MetricEvent[]=values.map(v=>({episodeId:'a',kind:v%2?'message.sent':'activation.completed',at:v*1000,context:'PRODUCTION',data:{}}));
  const expected=computeOverview(episodes,events,0,day*32,day*32,1);
  expect(computeOverview(episodes,[...events,...events].reverse(),0,day*32,day*32,1)).toEqual(expected);
 }));
});
