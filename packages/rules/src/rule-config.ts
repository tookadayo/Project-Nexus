import { canonicalDecimal, canonicalCount, hashRuleValue } from './facts';
import type { RuleId,RuleCooldown } from './facts';
import { registeredRule,REGISTERED_SOURCE_TYPES } from './rule-catalog';

export interface RuleBudget { maxRules: number; maxFacts: number; maxTargets: number; maxDurationMs: number; maxSteps: number }
export interface PerRuleConfig {
  enabled: boolean; minimumN: string; threshold: string; minimumCoverage: string;
  freshnessSeconds: number; windowDays: number; cooldown: RuleCooldown;
  decline?: string; minimumEvents?: string; unknownRateLimit?: string;
  generationGraceSeconds?: number; waitGraceSeconds?: number; heartbeatGraceSeconds?: number;
  minimumConsecutivePeriods?: number; minimumDomains?: number;
  communityWindowPolicy?: 'SAME_WINDOW' | 'DECLARED_RULE_WINDOWS_FIXTURE';
}
export interface RuleEngineConfig {
  configVersion: string; profile: 'OPERATIONAL' | 'FIXTURE'; approval: 'DISABLED' | 'APPROVED';
  retentionApproved: boolean; budget: RuleBudget | null;
  approvedSourceTypes: readonly string[]; rules: Readonly<Partial<Record<RuleId, PerRuleConfig>>>;
}
export function disabledRuleConfig(configVersion = 'unapproved'): RuleEngineConfig {
  return Object.freeze({ configVersion, profile: 'OPERATIONAL', approval: 'DISABLED', retentionApproved: false, budget: null, approvedSourceTypes: Object.freeze([]), rules: Object.freeze({}) });
}
function boundedInteger(value: number, minimum: number, maximum: number): void { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error('RULE_CONFIG_RANGE'); }
/** Ranges constrain an explicitly supplied version; they do not provide operational defaults. */
export function validateRuleConfig(config: RuleEngineConfig): void {
  if(!['configVersion','profile','approval','retentionApproved','budget','approvedSourceTypes','rules'].every((key)=>Object.hasOwn(config,key)))throw new Error('RULE_CONFIG_SCHEMA');
  if (Object.keys(config).some((key) => !['configVersion', 'profile', 'approval', 'retentionApproved', 'budget', 'approvedSourceTypes', 'rules'].includes(key)) || !['OPERATIONAL', 'FIXTURE'].includes(config.profile) || !['DISABLED', 'APPROVED'].includes(config.approval)) throw new Error('RULE_CONFIG_SCHEMA');
  if (typeof config.retentionApproved !== 'boolean' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(config.configVersion) || !Array.isArray(config.approvedSourceTypes) || new Set(config.approvedSourceTypes).size !== config.approvedSourceTypes.length || config.approvedSourceTypes.some((source) => !/^[A-Za-z0-9_.:-]{1,128}$/.test(source)) || !config.rules || typeof config.rules !== 'object') throw new Error('RULE_CONFIG_SCHEMA');
  if(config.approvedSourceTypes.some((source)=>!REGISTERED_SOURCE_TYPES.includes(source))||(config.budget!==null&&(typeof config.budget!=='object'||Array.isArray(config.budget))))throw new Error('RULE_CONFIG_SCHEMA');
  if (config.approval === 'APPROVED' && (!config.budget || (config.profile === 'OPERATIONAL' && !config.retentionApproved))) throw new Error('RULE_CONFIG_UNAPPROVED');
  if (config.budget) {
    if (Object.keys(config.budget).some((key) => !['maxRules', 'maxFacts', 'maxTargets', 'maxDurationMs', 'maxSteps'].includes(key))) throw new Error('RULE_CONFIG_SCHEMA');
    boundedInteger(config.budget.maxRules, 1, 200); boundedInteger(config.budget.maxFacts, 50, 2000); boundedInteger(config.budget.maxTargets, 10, 500); boundedInteger(config.budget.maxDurationMs, 1000, 30000); boundedInteger(config.budget.maxSteps, 1000, 100000);
  }
  for (const [id, value] of Object.entries(config.rules)) {
    if (!registeredRule(id) || !value || Object.keys(value).some((key) => !['enabled', 'minimumN', 'threshold', 'minimumCoverage', 'freshnessSeconds', 'windowDays', 'cooldown', 'decline', 'minimumEvents', 'unknownRateLimit', 'generationGraceSeconds', 'waitGraceSeconds', 'heartbeatGraceSeconds', 'minimumConsecutivePeriods', 'minimumDomains', 'communityWindowPolicy'].includes(key))) throw new Error('RULE_CONFIG_SCHEMA');
    if (typeof value.enabled !== 'boolean') throw new Error('RULE_CONFIG_SCHEMA');
    if(!['enabled','minimumN','threshold','minimumCoverage','freshnessSeconds','windowDays','cooldown'].every((key)=>Object.hasOwn(value,key)))throw new Error('RULE_CONFIG_SCHEMA');
    if(typeof value.threshold!=='string'||typeof value.minimumCoverage!=='string')throw new Error('RULE_CONFIG_SCHEMA');
    canonicalCount(value.minimumN); if (BigInt(value.minimumN) < 1n) throw new Error('RULE_CONFIG_RANGE');
    for (const decimal of [value.threshold, value.minimumCoverage, value.decline, value.unknownRateLimit]) if (decimal !== undefined) { const canonical = canonicalDecimal(decimal); if (!/^(?:0(?:\.\d+)?|1)$/.test(canonical)) throw new Error('RULE_CONFIG_RANGE'); }
    if (value.minimumEvents !== undefined) canonicalCount(value.minimumEvents);
    boundedInteger(value.freshnessSeconds, 1, 366 * 86400); boundedInteger(value.windowDays, 1, 366);
    if(!value.cooldown||!['CALENDAR_DAY','SECOND'].includes(value.cooldown.unit))throw new Error('RULE_CONFIG_SCHEMA');
    boundedInteger(value.cooldown.value,1,value.cooldown.unit==='SECOND'?366*86400:366);
    if(Object.keys(value.cooldown).some((key)=>!(value.cooldown.unit==='CALENDAR_DAY'?['unit','value','timeZone']:['unit','value']).includes(key)))throw new Error('RULE_CONFIG_SCHEMA');
    if(value.cooldown.unit==='CALENDAR_DAY'){if(typeof value.cooldown.timeZone!=='string')throw new Error('RULE_CONFIG_SCHEMA');try{new Intl.DateTimeFormat('en',{timeZone:value.cooldown.timeZone});}catch{throw new Error('RULE_CONFIG_TIME_ZONE');}}
    for (const seconds of [value.generationGraceSeconds, value.waitGraceSeconds, value.heartbeatGraceSeconds]) if (seconds !== undefined) boundedInteger(seconds, 0, 7 * 86400);
    if (value.minimumConsecutivePeriods !== undefined) boundedInteger(value.minimumConsecutivePeriods, 2, 3);
    if (value.minimumDomains !== undefined) boundedInteger(value.minimumDomains, 2, 8);
    if (value.communityWindowPolicy !== undefined && (id !== 'COMM-001' || !['SAME_WINDOW','DECLARED_RULE_WINDOWS_FIXTURE'].includes(value.communityWindowPolicy) || (config.profile === 'OPERATIONAL' && value.communityWindowPolicy !== 'SAME_WINDOW'))) throw new Error('RULE_CONFIG_WINDOW_POLICY');
    if(config.approval==='APPROVED'&&value.enabled){
      const required:Record<string,readonly string[]>={'ENG-001':['decline'],'EVENT-001':['decline','minimumEvents'],'REPORT-001':['decline','generationGraceSeconds'],'AUTO-001':['unknownRateLimit'],'AUTO-002':['waitGraceSeconds','heartbeatGraceSeconds'],'EXP-001':['minimumConsecutivePeriods'],'PLAY-001':['minimumConsecutivePeriods'],'COMM-001':['minimumDomains']};
      if((required[id]??[]).some((key)=>!Object.hasOwn(value,key)))throw new Error('RULE_CONFIG_SCHEMA');
    }
  }
}
export function ruleConfigHash(config: RuleEngineConfig): string { validateRuleConfig(config); return hashRuleValue(config); }
