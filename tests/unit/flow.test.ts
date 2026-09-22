import {expect,it} from 'vitest';
import fc from 'fast-check';
import {templateFlow,answerFlow,validateFlow,type FlowState} from '../../packages/onboarding/src/flow.js';
it('branches correctly and rejects cycles',()=>{
 const flow=templateFlow('Gaming');let state:FlowState={nodeId:flow.start,answers:{},complete:false};
 state=answerFlow(flow,state,'purpose','gaming');state=answerFlow(flow,state,'game','minecraft');state=answerFlow(flow,state,'edition','java');expect(state.complete).toBe(true);
 expect(()=>answerFlow(flow,state,'edition','java')).toThrow('STALE_FLOW_NODE');
 const invalid=structuredClone(flow);invalid.nodes[0]!.options[0]!.next='purpose';expect(()=>validateFlow(invalid)).toThrow('FLOW_CYCLE');
});
it('arbitrary choices never transition to an invalid node',()=>{
 fc.assert(fc.property(fc.array(fc.nat(),{maxLength:20}),choices=>{
  const flow=templateFlow('Gaming');let state:FlowState={nodeId:flow.start,answers:{},complete:false};
  for(const n of choices){if(state.complete)break;const node=flow.nodes.find(x=>x.id===state.nodeId)!;state=answerFlow(flow,state,node.id,node.options[n%node.options.length]!.id);expect(state.complete||flow.nodes.some(x=>x.id===state.nodeId)).toBe(true);}
 }));
});
