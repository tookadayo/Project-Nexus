import type {Accent} from './theme.js';

export type CoverageStatus='healthy'|'degraded'|'incomplete'|'unavailable';
export type StatusTone='healthy'|'collecting'|'warning'|'critical'|'information'|'neutral';

export function coverageLabel(status:CoverageStatus,ratio?:number){
 if(status==='healthy')return 'Healthy coverage';
 if(status==='degraded')return `Partial coverage${ratio===undefined?'':` · ${Math.round(ratio*100)}%`}`;
 if(status==='incomplete')return 'Collection incomplete';
 return 'Not available yet';
}

export function toneAccent(tone:StatusTone):Accent{
 return tone==='information'?'nexus':tone==='collecting'?'collecting':tone;
}

export const experimentEvidenceLabels:Record<string,string>={
 INSUFFICIENT_DATA:'Not enough data',DIRECTIONAL:'Directional',INCONCLUSIVE:'Inconclusive',SUPPORTED:'Supported by current evidence',GUARDRAIL_BREACH:'Stopped by guardrail'
};

export const interventionStateLabels:Record<string,string>={
 suggested:'Awaiting approval',approval:'Awaiting approval',queued:'Queued',running:'In progress',delivered:'Delivered',failed:'Failed',unknown:'Delivery uncertain',suppressed:'Suppressed by safety checks'
};
