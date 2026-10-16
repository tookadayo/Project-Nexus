import { describe, expect, it } from 'vitest';
import { canonicalDecimal, canonicalRuleJson, canonicalRuleTimestamp, hashRuleValue, sealRuleInput, timestampMicros, verifySealedRuleInput } from '../../packages/rules/src/facts';
import type { FactValue, RuleInput } from '../../packages/rules/src/facts';
import { disabledRuleConfig, validateRuleConfig } from '../../packages/rules/src/rule-config';
import { deduplicateCommunityIssues, evaluateRules } from '../../packages/rules/src/rule-engine';
import { BASE_RULE_IDS, RULE_CATALOG, validateRuleCatalog } from '../../packages/rules/src/rule-catalog';
import { adaptAuthorizedFact, projectFactValue, projectRuntimeAnomalies, projectRuntimeOutcomes, restoreFactValue } from '../../packages/rules/src/source-adapters';
import { COMMUNITY_FIXTURES, fixtureInput, fixtureRuleConfig, RULE_FIXTURES } from '../fixtures/alpha16-rules';

const fixtures=[...RULE_FIXTURES,...COMMUNITY_FIXTURES];
const copyInput=(input:RuleInput):RuleInput=>JSON.parse(JSON.stringify(input)) as RuleInput;
describe('alpha16 immutable facts and thirteen deterministic registered rules',()=>{
  it.each(fixtures)('$sourceFixtureId replays its sealed asOf/version/window/quality fixture',(fixture)=>{
    const output=evaluateRules(fixture.input,fixture.config,{nowMs:()=>0});
    expect(output.status).toBe('COMPLETED');expect(output.publishable).toBe(false);
    const result=output.results.find((entry)=>entry.ruleId===fixture.ruleId)!;
    expect(result.decision).toBe(fixture.expectedDecision);
    if(fixture.expectedReason)expect(result.reasonCodes).toContain(fixture.expectedReason);
    if(fixture.expectedPriority)expect(result.priority).toBe(fixture.expectedPriority);
    expect(result.action).toBe('REVIEW_ONLY');expect(result.inputHash).toBe(fixture.input.inputHash);
    expect(result.sufficient).toBe(result.decision==='NO_FIRE'&&!result.partialCoverage);
    expect(evaluateRules(fixture.input,fixture.config,{nowMs:()=>0})).toEqual(output);
  });
  it('retains each source fixture ID once and covers all thirteen rules',()=>{
    expect(new Set(fixtures.map((f)=>f.sourceFixtureId)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map((f)=>f.ruleId))).toEqual(new Set(RULE_CATALOG.map((r)=>r.ruleId)));
    for(const fixture of fixtures){expect(fixture.baseline).toBe('alpha16-contract-20261016');expect(fixture.input.versions.configVersion).toBe(fixture.config.configVersion);expect(fixture.input.evaluationAsOf).toMatch(/\.\d{6}Z$/);}
  });
  it('normalizes decimal signs/zeros without accepting exponent or excess precision',()=>{
    expect(canonicalDecimal('-000.000')).toBe('0');expect(canonicalDecimal('00012.34000')).toBe('12.34');
    for(const value of ['1e-3','NaN','Infinity','1.1234567890123456789','123456789012345678901'])expect(()=>canonicalDecimal(value)).toThrow();
    expect(canonicalRuleJson({'😀':1,'\uffff':2,a:3})).toBe('{"a":3,"￿":2,"😀":1}');
  });
  it('preserves all six UTC timestamp digits and rejects rounding/invalid dates',()=>{
    expect(canonicalRuleTimestamp('2026-10-15T12:00:00Z')).toBe('2026-10-15T12:00:00.000000Z');
    expect(timestampMicros('2026-10-15T12:00:00.123456Z')-timestampMicros('2026-10-15T12:00:00.123455Z')).toBe(1n);
    for(const value of ['2026-02-30T12:00:00Z','2026-10-15T12:00:00.1234567Z','2026-10-15T12:00:00+00:00'])expect(()=>canonicalRuleTimestamp(value)).toThrow();
  });
  it('seals set arrays independently of arrival order and rejects changed inputs on resume',()=>{
    const original=COMMUNITY_FIXTURES[0]!.input;
    const {inputHash:_inputHash,...body}=original;void _inputHash;
    const shuffled=copyInput(body);shuffled.facts=[...shuffled.facts].reverse();shuffled.sourceHealth=[...shuffled.sourceHealth].reverse();shuffled.targets=[...shuffled.targets].reverse();shuffled.requestedRuleIds=[...shuffled.requestedRuleIds].reverse();
    expect(sealRuleInput(shuffled).inputHash).toBe(original.inputHash);
    expect(()=>verifySealedRuleInput({...original,evaluationAsOf:'2026-10-16T12:00:00.000000Z'})).toThrow('RULE_INPUT_HASH_MISMATCH');
    expect(Object.isFrozen(original.facts[0]!.value)).toBe(true);
  });
  it('rejects unknown fields/metrics/dimensions/kinds before hashing',()=>{
    const input=fixtureInput('ONB-001');
    expect(()=>sealRuleInput({...input,rawBody:'forbidden'} as RuleInput)).toThrow();
    const unknown=copyInput(input);unknown.facts[0]!.metricId='arbitrary.metric';expect(()=>sealRuleInput(unknown)).toThrow('RULE_METRIC_CONTRACT_MISMATCH');
    const dimension=copyInput(input);dimension.facts[0]!.dimension={userId:'personal'};expect(()=>sealRuleInput(dimension)).toThrow('RULE_DIMENSION_UNREGISTERED');
    const value=copyInput(input);value.facts[0]!.value={kind:'ratio',numerator:'1',denominator:'100',message:'forbidden'} as FactValue;expect(()=>sealRuleInput(value)).toThrow();
  });
  it('does not conflate prior/current facts and does not let cohort IDs forbid comparable cohorts',()=>{
    const input=fixtureInput('ENG-001');const current=input.facts.find((f)=>f.periodRole==='CURRENT')!,prior=input.facts.find((f)=>f.periodRole==='PREVIOUS')!;
    current.value={kind:'ratio',numerator:'10',denominator:'100'};prior.value={kind:'ratio',numerator:'10',denominator:'100'};
    expect(current.comparison!.cohortId).not.toBe(prior.comparison!.cohortId);
    expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.decision).toBe('NO_FIRE');
    prior.comparison!.campaignClass='DIFFERENT';expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.reasonCodes).toContain('INCOMPATIBLE_COMPARISON');
  });
  it.each(['EXP-001','PLAY-001'] as const)('%s requires three equal contiguous periods covering its exact CURRENT window',(ruleId)=>{
    const original=fixtureInput(ruleId),config=fixtureRuleConfig(),history=original.facts.find(fact=>fact.metricId==='issue.recurrence_consecutive_periods')!;
    const value=history.value as Extract<FactValue,{kind:'issuePeriods'}>;
    expect(timestampMicros(history.windowEnd)-timestampMicros(history.windowStart)).toBe(3n*86400000000n);
    expect(value.periods.map(period=>timestampMicros(period.windowEnd)-timestampMicros(period.windowStart))).toEqual([86400000000n,86400000000n,86400000000n]);
    expect(evaluateRules(sealRuleInput(original),config).results.find(result=>result.ruleId===ruleId)?.decision).toBe('FIRE');
    for(const mutation of ['UNEQUAL','MICROSECOND_GAP','OUTER_SHIFT'] as const){
      const input=copyInput(original),fact=input.facts.find(entry=>entry.metricId==='issue.recurrence_consecutive_periods')!,nested=fact.value as Extract<FactValue,{kind:'issuePeriods'}>;
      if(mutation==='UNEQUAL'){const boundary=new Date(Date.parse(nested.periods[0]!.windowStart)+12*3600000).toISOString();fact.value={...nested,periods:nested.periods.map((period,index)=>index===0?{...period,windowEnd:boundary}:index===1?{...period,windowStart:boundary}:period)};}
      else if(mutation==='MICROSECOND_GAP')fact.value={...nested,periods:nested.periods.map((period,index)=>index===1?{...period,windowStart:period.windowStart.replace('.000000Z','.000001Z')}:period)};
      else {fact.windowStart=new Date(Date.parse(fact.windowStart)-3600000).toISOString();fact.windowEnd=new Date(Date.parse(fact.windowEnd)-3600000).toISOString();}
      expect(evaluateRules(sealRuleInput(input),config).results.find(result=>result.ruleId===ruleId)).toMatchObject({decision:'INELIGIBLE',reasonCodes:['WINDOW_MISMATCH']});
    }
  });
  it('compares exact pre-rounding ratios including a one-count difference above Number precision',()=>{
    const input=fixtureInput('ONB-001');input.facts[0]!.value={kind:'ratio',numerator:'5399999999999999999',denominator:'9000000000000000000'};
    expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.decision).toBe('FIRE');
    input.facts[0]!.value={kind:'ratio',numerator:'5400000000000000000',denominator:'9000000000000000000'};
    expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.decision).toBe('NO_FIRE');
  });
  it('keeps disabled operational configuration value-free and validates drafts strictly',()=>{
    expect(evaluateRules(sealRuleInput(fixtureInput('ONB-001')),disabledRuleConfig()).status).toBe('DISABLED');
    expect(disabledRuleConfig().budget).toBeNull();expect(disabledRuleConfig().rules).toEqual({});
    const config=fixtureRuleConfig();config.approval='DISABLED';config.rules={'ONB-001':{...config.rules['ONB-001']!,unknown:1} as NonNullable<typeof config.rules['ONB-001']>};expect(()=>validateRuleConfig(config)).toThrow('RULE_CONFIG_SCHEMA');
  });
  it('does not publish interrupted, cancelled, tombstoned, or exhausted evaluations',()=>{
    const input=COMMUNITY_FIXTURES[0]!.input,config=fixtureRuleConfig();
    for(const control of [{cancelled:()=>true},{tombstoned:()=>true},{nowMs:(()=>{let n=0;return ()=>n++*6000;})()}]){
      const result=evaluateRules(input,config,control);expect(result.status).toBe('INCOMPLETE');expect(result.publishable).toBe(false);
    }
    config.budget={...config.budget!,maxRules:1};expect(evaluateRules(input,config).reasonCodes).toContain('BUDGET_EXCEEDED');
  });
  it('does not infer unknown delivery as failure or let unrelated missing delivery hide overdue generation',()=>{
    const input=fixtureInput('REPORT-001');const generation=input.facts.find((f)=>f.metricId==='REPORT.GENERATION_DUE_STATE')!,delivery=input.facts.find((f)=>f.metricId==='REPORT.DELIVERY_RESULT_COUNTS'&&f.periodRole==='CURRENT')!;
    delivery.value={kind:'outcomes',succeeded:'10',failed:'0',unknown:'1',cancelled:'0',unfinished:'0',expired:'0'};
    expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.reasonCodes).toContain('DELIVERY_RESULT_UNKNOWN');
    generation.value={kind:'generation',dueAt:'2026-10-15T09:00:00Z',lastSuccessAt:null};delivery.quality='MISSING';delivery.value=null;
    expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.reasonCodes).toContain('GENERATION_OVERDUE');
  });
  it('rejects unregistered, cyclic, duplicate or missing catalog dependencies',()=>{
    expect(()=>validateRuleCatalog([...RULE_CATALOG,RULE_CATALOG[0]!])).toThrow('RULE_CATALOG_DUPLICATE');
    expect(()=>validateRuleCatalog([{...RULE_CATALOG[0]!,dependencies:['ONB-001']}])).toThrow('RULE_CATALOG_CYCLE');
    expect(()=>validateRuleCatalog([{...RULE_CATALOG[0]!,dependencies:['HELP-001']}])).toThrow('RULE_CATALOG_DEPENDENCY_MISSING');
  });
  it('keeps unknown and excluded legacy runtime outcomes separate, with one result per Run',()=>{
    const rows=[{runId:'run-1',revision:'1',status:'COMPLETED' as const},{runId:'run-2',revision:'1',status:'UNKNOWN' as const},{runId:'run-3',revision:'1',status:'CANCELLED' as const}];
    expect(projectRuntimeOutcomes(rows)).toEqual({kind:'outcomes',succeeded:'1',failed:'0',unknown:'1',cancelled:'1',unfinished:'0',expired:'0'});
    expect(()=>projectRuntimeOutcomes([...rows,rows[0]!])).toThrow('RULE_RUN_DUPLICATE');
    const fact=fixtureInput('AUTO-001').facts[0]!;
    expect(()=>adaptAuthorizedFact(fact,{sourceType:fact.sourceType,projectionVersion:'1',approved:false,authorizationReference:'fixture',metricIds:[fact.metricId]})).toThrow('RULE_SOURCE_ADAPTER_BLOCKED');
  });
  it('uses strict runtime boundaries, excludes future waits and counts anomaly unions once',()=>{
    const base={executionRef:'exec-1',state:'WAITING' as const,dueAt:'2026-10-15T11:45:00Z',deadlineAt:'2026-10-15T11:45:00Z',terminalAt:null,leaseExpiresAt:null,heartbeatAt:null};
    const equal=projectRuntimeAnomalies([base],'2026-10-15T12:00:00Z',900,300,'1');expect(equal.anomalous).toBe('0');
    const both=projectRuntimeAnomalies([{...base,dueAt:'2026-10-15T11:44:59Z',deadlineAt:'2026-10-15T11:44:59Z'}],'2026-10-15T12:00:00Z',900,300,'1');expect(both.anomalous).toBe('1');
    const future=projectRuntimeAnomalies([{...base,dueAt:'2026-10-15T12:00:01Z'}],'2026-10-15T12:00:00Z',900,300,'1');expect(future.eligible).toBe('0');
    const terminal=projectRuntimeAnomalies([{...base,state:'COMPLETED',terminalAt:'2026-10-15T11:59:00Z'}],'2026-10-15T12:00:00Z',900,300,'1');expect(terminal.eligible).toBe('1');expect(terminal.anomalous).toBe('0');
  });
  it('refuses anomaly aggregates computed for another asOf or grace configuration',()=>{
    const input=fixtureInput('AUTO-002');const v=input.facts[0]!.value as Extract<FactValue,{kind:'anomalies'}>;
    v.projectionAsOf='2026-10-15T11:59:59Z';expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.reasonCodes).toContain('ANOMALY_ASOF_MISMATCH');
    v.projectionAsOf=input.evaluationAsOf;v.waitGraceSeconds='60';expect(evaluateRules(sealRuleInput(input),fixtureRuleConfig()).results[0]!.reasonCodes).toContain('ANOMALY_CONFIG_MISMATCH');
  });
  it('deduplicates COMM evidence despite version changes, excludes dependent summaries, and caps partial priority',()=>{
    const f=COMMUNITY_FIXTURES.find((fixture)=>fixture.fixtureId==='COMM-001-F04')!;const output=evaluateRules(f.input,f.config);
    const base=output.results.filter((r)=>r.decision==='FIRE'&&BASE_RULE_IDS.includes(r.ruleId));
    expect(deduplicateCommunityIssues([...base,{...base[0]!,ruleVersion:'2'},...output.results.filter((r)=>r.ruleId==='COMM-001')])).toHaveLength(2);
    expect(base.map((r)=>r.domain)).toContain('CHANNEL_USAGE');
    const partial=COMMUNITY_FIXTURES.find((fixture)=>fixture.fixtureId==='COMM-001-F03')!;expect(evaluateRules(partial.input,partial.config).results.find((r)=>r.ruleId==='COMM-001')!.priority).toBe('P3');
    const full=COMMUNITY_FIXTURES.find((fixture)=>fixture.fixtureId==='COMM-001-F01')!,summary=evaluateRules(full.input,full.config).results.find((r)=>r.ruleId==='COMM-001')!.communitySummary!;
    expect(summary.requestedSlots).toHaveLength(9);expect(summary.eligibleSlots).toHaveLength(9);expect(summary.issueCount).toBe(4);expect(summary.domainCount).toBe(3);
  });
  it.each(fixtures.flatMap((f)=>f.input.facts).filter((f)=>f.value!==null))('round trips typed scalar components for $metricId/$periodRole',(fact)=>{
    const projected=projectFactValue(fact.value);expect(projected.every((part)=>part.value===null||typeof part.value==='string'||typeof part.value==='boolean')).toBe(true);
    expect(restoreFactValue(fact.value!.kind,[...projected].reverse())).toEqual(fact.value);
    expect(hashRuleValue(restoreFactValue(fact.value!.kind,projected))).toBe(hashRuleValue(fact.value));
  });
  it('rejects extra scalar component paths and keeps missing values null',()=>{
    expect(restoreFactValue(null,[])).toBeNull();expect(()=>restoreFactValue(null,[{componentKey:'body',valueKind:'ENUM',value:'forbidden'}])).toThrow();
    expect(()=>restoreFactValue('ratio',[{componentKey:'numerator',valueKind:'INTEGER',value:'1'},{componentKey:'denominator',valueKind:'INTEGER',value:'2'},{componentKey:'body',valueKind:'ENUM',value:'forbidden'}])).toThrow();
  });
});
