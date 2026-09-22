import {en,type MessageKey} from './en.js';
import {ja} from './ja.js';

export type UiLanguage='auto'|'ja'|'en'|'bilingual';
export type UiLocale=Exclude<UiLanguage,'auto'>;
export type LocaleContext={interactionLocale?:string;guildLocale?:string;publicPanel?:boolean};

const bilingualKeys=new Set<MessageKey>([
 'common.settings','common.overview','common.lifecycle','common.privacy','common.setup','common.diagnose','common.interventions','common.experiments','common.activation','common.newMembers','common.firstReply','common.d7Retention','common.refresh',
 'coverage.healthy','coverage.partial','coverage.incomplete','coverage.unavailable','evidence.insufficient','evidence.directional','evidence.inconclusive','evidence.supported','evidence.guardrail','mode.auto','mode.native','mode.fallback','mode.hybrid',
 'root.title','overview.title','overview.collecting','overview.healthy','overview.progress','overview.attention','overview.dataHealth','overview.recommended','lifecycle.title','lifecycle.join','lifecycle.onboard','lifecycle.activate','lifecycle.connect','lifecycle.retain',
 'diagnostics.title','experiment.title','experiment.control','experiment.treatment','experiment.difference','experiment.maturity','experiment.guardrails','error.genericTitle','error.ref','error.openPanel','settings.title','settings.language','readiness.title','activation.title','privacy.title','interventions.title','billing.title','cohorts.title','reports.title','health.title'
]);

export function resolveLocale(mode:UiLanguage,context:LocaleContext={}):UiLocale{
 if(mode!=='auto')return mode;
 const preferred=context.publicPanel?(context.guildLocale??context.interactionLocale):(context.interactionLocale??context.guildLocale);
 return preferred?.toLowerCase().startsWith('ja')?'ja':'en';
}

export function t(locale:UiLocale,key:MessageKey,variables:Record<string,string|number>={}):string{
 const source=locale==='en'?en[key]:locale==='ja'?ja[key]:bilingualKeys.has(key)?`${ja[key]} / ${en[key]}`:ja[key];
 return source.replaceAll(/\{([a-zA-Z]+)\}/g,(_match,name:string)=>String(variables[name]??`{${name}}`));
}

export function discordLabel(locale:UiLocale,key:MessageKey,variables:Record<string,string|number>={},max=80){return t(locale,key,variables).slice(0,max);}
export {en,ja};
export type {MessageKey};
