import type {FlowDefinition} from '../../packages/automation/src/types';

/** Test fixtures deliberately assume success at each named action. Production
 * and browser simulations must instead receive explicit user-selected outcomes. */
export function mockSuccessfulActionOutcomes(definition:FlowDefinition):Record<string,'SUCCEEDED'> {
  const outcomes=Object.create(null) as Record<string,'SUCCEEDED'>;
  const visit=(value:unknown):void=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(object.kind==='action'&&typeof object.id==='string')outcomes[object.id]='SUCCEEDED';
    Object.values(object).forEach(visit);
  };visit(definition);return outcomes;
}

/** Explicit happy-path fixture data, never a browser or production default. */
export function mockApprovedFormalWaits(definition:FlowDefinition):Record<string,'APPROVED'> {
  const approvals=Object.create(null) as Record<string,'APPROVED'>;
  const visit=(value:unknown):void=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(object.kind==='approval'&&typeof object.id==='string')approvals[object.id]='APPROVED';
    Object.values(object).forEach(visit);
  };visit(definition);return approvals;
}
