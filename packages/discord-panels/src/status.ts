import type {Accent} from './theme.js';
import {t,type UiLocale} from './i18n/index.js';

export type CoverageStatus='healthy'|'degraded'|'incomplete'|'unavailable';
export type StatusTone='healthy'|'collecting'|'warning'|'critical'|'information'|'neutral';

export function coverageLabel(status:CoverageStatus,ratio?:number,locale:UiLocale='en'){
 if(status==='healthy')return t(locale,'coverage.healthy');
 if(status==='degraded')return ratio===undefined?t(locale,'coverage.partial',{percent:'—'}):t(locale,'coverage.partial',{percent:Math.round(ratio*100)});
 if(status==='incomplete')return t(locale,'coverage.incomplete');
 return t(locale,'coverage.unavailable');
}

export function toneAccent(tone:StatusTone):Accent{
 return tone==='information'?'nexus':tone==='collecting'?'collecting':tone;
}

const evidenceKeys:Record<string,Parameters<typeof t>[1]>={INSUFFICIENT_DATA:'evidence.insufficient',DIRECTIONAL:'evidence.directional',INCONCLUSIVE:'evidence.inconclusive',SUPPORTED:'evidence.supported',GUARDRAIL_BREACH:'evidence.guardrail'};
export function experimentEvidenceLabel(status:string,locale:UiLocale='en'){const key=evidenceKeys[status];return key?t(locale,key):status;}
const interventionKeys:Record<string,Parameters<typeof t>[1]>={suggested:'intervention.awaiting',approval:'intervention.awaiting',queued:'intervention.queued',running:'intervention.progress',delivered:'intervention.delivered',failed:'intervention.failed',unknown:'intervention.uncertain',suppressed:'intervention.suppressed'};
export function interventionStateLabel(status:string,locale:UiLocale='en'){const key=interventionKeys[status];return key?t(locale,key):status;}
const diagnosisKeys:Record<string,Parameters<typeof t>[1]>={ACTIVATION_DROP:'diagnosis.activationDrop',TTFV_SPIKE:'diagnosis.ttfvSpike',CONNECTION_DROP:'diagnosis.connectionDrop',REPLY_LATENCY_SPIKE:'diagnosis.replyLatencySpike',ONBOARDING_DROP:'diagnosis.onboardingDrop',HOME_ACTION_DROP:'diagnosis.homeActionDrop',RETENTION_DROP:'diagnosis.retentionDrop',DATA_COVERAGE_DROP:'diagnosis.coverageDrop',ACTION_FAILURE_SPIKE:'diagnosis.actionFailureSpike'};
export function diagnosisLabel(type:string,locale:UiLocale='en'){const key=diagnosisKeys[type];return key?t(locale,key):type;}
