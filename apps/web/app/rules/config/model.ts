import type {RuleEngineConfig,PerRuleConfig,RuleBudget} from "../../../../../packages/rules/src/rule-config";
import type {RuleId} from "../../../../../packages/rules/src/facts";
export interface RuleConfigEntry {configVersion: number; status: string; engineVersion: string; definition: RuleEngineConfig; contentHash: string; createdAt: string; expiresAt: string;
  sourceConfigVersion: number | null; operatingProfileRevision: string | null; operatingProfileExpiresAt: string | null;}
export interface RuleConfigHistory {items: RuleConfigEntry[]; currentVersion: number; status: string; reasonCode: string | null;
  mutationReadiness: {activation: {enabled: boolean; reasonCode: string | null}; retirement: {enabled: boolean; reasonCode: string | null}};}
export type ConfigChoice = {operation: "CONFIG_ACTIVATE" | "CONFIG_RETIRE"; configVersion: number; contentHash: string};
/** The browser binds only the exact displayed native version/hash. It cannot
 * provide an operating profile, approve retention or select arbitrary targets. */
export function configMutation(choice: ConfigChoice, baseConfigVersion: number) {
  if (!Number.isSafeInteger(baseConfigVersion) || baseConfigVersion < 0 || !Number.isSafeInteger(choice.configVersion) || choice.configVersion < 1 || !/^[a-f0-9]{64}$/.test(choice.contentHash)) return null;
  const payload = choice.operation === "CONFIG_ACTIVATE" ? {baseConfigVersion, draftConfigVersion: choice.configVersion, draftContentHash: choice.contentHash} : {baseConfigVersion, activeConfigVersion: choice.configVersion, activeContentHash: choice.contentHash};
  return {operation: choice.operation, expectedVersion: baseConfigVersion, payload};
}
export const ruleIds=["ONB-001","HELP-001","RET-001","ENG-001","EVENT-001","REPORT-001","AUTO-001","AUTO-002","PERM-001","EXP-001","PLAY-001","DATA-001","COMM-001"] as const satisfies readonly RuleId[];
export const budgetFields=["maxRules","maxFacts","maxTargets","maxDurationMs","maxSteps"] as const;
export const budgetRanges:Record<typeof budgetFields[number],readonly[number,number]>={maxRules:[1,200],maxFacts:[50,2000],maxTargets:[10,500],maxDurationMs:[1000,30000],maxSteps:[1000,100000]};
export const commonFields=["minimumN","threshold","minimumCoverage","freshnessSeconds","windowDays"] as const;
export const optionalFields=["decline","minimumEvents","unknownRateLimit","generationGraceSeconds","waitGraceSeconds","heartbeatGraceSeconds","minimumConsecutivePeriods","minimumDomains"] as const;
export type NumericField=typeof commonFields[number]|typeof optionalFields[number];
export const optionalForRule:Partial<Record<RuleId,readonly (typeof optionalFields[number])[]>>={"ENG-001":["decline"],"EVENT-001":["decline","minimumEvents"],"REPORT-001":["decline","generationGraceSeconds"],"AUTO-001":["unknownRateLimit"],"AUTO-002":["waitGraceSeconds","heartbeatGraceSeconds"],"EXP-001":["minimumConsecutivePeriods"],"PLAY-001":["minimumConsecutivePeriods"],"COMM-001":["minimumDomains"]};
export type RuleDraftForm={configured:boolean;enabled:boolean;values:Record<NumericField,string>;cooldownUnit:""|"CALENDAR_DAY"|"SECOND";cooldownValue:string;timeZone:string;communityWindowPolicy:""|"SAME_WINDOW"|"UNSUPPORTED"};
export type ConfigDraftForm={budgetMode:""|"NONE"|"BOUNDED";budget:Record<typeof budgetFields[number],string>;sourceTypes:string[];rules:Record<RuleId,RuleDraftForm>};
function emptyRule():RuleDraftForm{return {configured:false,enabled:false,values:Object.fromEntries([...commonFields,...optionalFields].map(field=>[field,""])) as Record<NumericField,string>,cooldownUnit:"",cooldownValue:"",timeZone:"",communityWindowPolicy:""};}
/** Placeholders never become execution values. New choices/amounts are empty. */
export function emptyConfigDraft():ConfigDraftForm{return {budgetMode:"",budget:Object.fromEntries(budgetFields.map(field=>[field,""])) as ConfigDraftForm["budget"],sourceTypes:[],rules:Object.fromEntries(ruleIds.map(id=>[id,emptyRule()])) as ConfigDraftForm["rules"]};}
export function editConfigDraft(definition:RuleEngineConfig):ConfigDraftForm{
 const form=emptyConfigDraft();form.budgetMode=definition.budget?"BOUNDED":"NONE";form.sourceTypes=[...definition.approvedSourceTypes];
 if(definition.budget)for(const field of budgetFields)form.budget[field]=String(definition.budget[field]);
 for(const id of ruleIds){const value=definition.rules[id];if(!value)continue;const row=form.rules[id];row.configured=true;row.enabled=value.enabled;
  for(const field of [...commonFields,...optionalFields])if(value[field]!==undefined)row.values[field]=String(value[field]);
  row.cooldownUnit=value.cooldown.unit;row.cooldownValue=String(value.cooldown.value);row.timeZone=value.cooldown.unit==="CALENDAR_DAY"?value.cooldown.timeZone:"";
  row.communityWindowPolicy=value.communityWindowPolicy===undefined?"":value.communityWindowPolicy==="SAME_WINDOW"?"SAME_WINDOW":"UNSUPPORTED";
 }
 return form;
}
export function fieldRange(field:NumericField):readonly[number,number]{
 if(["threshold","minimumCoverage","decline","unknownRateLimit"].includes(field))return [0,1];
 if(field==="freshnessSeconds")return [1,366*86400];if(field==="windowDays")return [1,366];
 if(field==="minimumConsecutivePeriods")return [2,3];if(field==="minimumDomains")return [2,8];
 if(["generationGraceSeconds","waitGraceSeconds","heartbeatGraceSeconds"].includes(field))return [0,7*86400];
 return [field==="minimumEvents"?0:1,Number.MAX_SAFE_INTEGER];
}
const integer=(raw:string,min:number,max:number)=>/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>=min&&Number(raw)<=max?Number(raw):null;
function count(raw:string,min:number):string|null{if(!/^\d+$/.test(raw)||raw.length>80)return null;const value=BigInt(raw);return value>=BigInt(min)&&value<=9223372036854775807n?value.toString():null;}
function ratio(raw:string):string|null{
 if(!/^\d+(?:\.\d+)?$/.test(raw)||raw.length>80)return null;
 const [wholeRaw,fractionRaw=""]=raw.split("."),whole=wholeRaw!.replace(/^0+(?=\d)/,""),fraction=fractionRaw.replace(/0+$/,"");
 if(whole.length>20||fraction.length>18||whole.length+fraction.length>38||BigInt(whole)>1n||whole==="1"&&fraction!=="")return null;
 return whole+(fraction?"."+fraction:"");
}
export type DraftBuild={ok:true;envelope:{operation:"CONFIG_REVISE";expectedVersion:number;payload:{baseConfigVersion:number;definition:RuleEngineConfig}}}|{ok:false;field:string;code:string};
/** Builds only an inactive OPERATIONAL draft. Source choices here are allowed
 * config types; current source authority/retention remains a server proof. */
export function configDraftMutation(form:ConfigDraftForm,baseVersion:number,allowedSources:readonly string[]):DraftBuild{
 const invalid=(field:string,code="RULE_CONFIG_FIELD_INVALID"):DraftBuild=>({ok:false,field,code});
 if(!Number.isSafeInteger(baseVersion)||baseVersion<0||baseVersion>=2147483647)return invalid("currentVersion");
 if(!["NONE","BOUNDED"].includes(form.budgetMode))return invalid("budgetMode");let budget:RuleBudget|null=null;
 if(form.budgetMode==="BOUNDED"){
  budget={} as RuleBudget;for(const field of budgetFields){const range=budgetRanges[field],value=integer(form.budget[field],...range);if(value===null)return invalid(`budget.${field}`);budget[field]=value;}
 }
 if(new Set(form.sourceTypes).size!==form.sourceTypes.length||form.sourceTypes.some(source=>!allowedSources.includes(source)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(source)))return invalid("sourceTypes","RULE_CONFIG_SOURCE_INVALID");
 const rules:Partial<Record<RuleId,PerRuleConfig>>={};
 for(const id of ruleIds){const row=form.rules[id];if(!row.configured)continue;const values:Partial<Record<NumericField,string|number>>={};
  for(const field of [...commonFields,...optionalFields]){
   const raw=row.values[field],required=(commonFields as readonly string[]).includes(field);if(!required&&raw==="")continue;
   const range=fieldRange(field),value=["minimumN","minimumEvents"].includes(field)?count(raw,range[0]):["threshold","minimumCoverage","decline","unknownRateLimit"].includes(field)?ratio(raw):integer(raw,...range);
   if(value===null)return invalid(`${id}.${field}`);values[field]=value;
  }
  if(!["SECOND","CALENDAR_DAY"].includes(row.cooldownUnit))return invalid(`${id}.cooldown.unit`);
  const cooldownValue=integer(row.cooldownValue,1,row.cooldownUnit==="SECOND"?366*86400:366);if(cooldownValue===null)return invalid(`${id}.cooldown.value`);
  if(row.cooldownUnit==="CALENDAR_DAY"){try{if(!row.timeZone)throw new Error();new Intl.DateTimeFormat("en",{timeZone:row.timeZone});}catch{return invalid(`${id}.cooldown.timeZone`);}}
  if(row.communityWindowPolicy==="UNSUPPORTED")return invalid(`${id}.communityWindowPolicy`,"RULE_CONFIG_WINDOW_POLICY");
  const rule={enabled:row.enabled,...values,cooldown:row.cooldownUnit==="CALENDAR_DAY"?{unit:"CALENDAR_DAY" as const,value:cooldownValue,timeZone:row.timeZone}:{unit:"SECOND" as const,value:cooldownValue},...(id==="COMM-001"&&row.communityWindowPolicy?{communityWindowPolicy:row.communityWindowPolicy}:{})} as PerRuleConfig;
  rules[id]=rule;
 }
 const definition:RuleEngineConfig={configVersion:String(baseVersion+1),profile:"OPERATIONAL",approval:"DISABLED",retentionApproved:false,budget,approvedSourceTypes:[...form.sourceTypes].sort(),rules};
 return {ok:true,envelope:{operation:"CONFIG_REVISE",expectedVersion:baseVersion,payload:{baseConfigVersion:baseVersion,definition}}};
}
