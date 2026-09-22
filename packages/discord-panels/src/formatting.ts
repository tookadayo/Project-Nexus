import {t,type UiLocale} from './i18n/index.js';
export function formatPercentage(value:number|null,digits=0,locale:UiLocale='en'){
 return value===null?t(locale,'common.notAvailableData'):new Intl.NumberFormat(locale==='en'?'en-US':'ja-JP',{style:'percent',maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
}

export function formatDuration(seconds:number|null,locale:UiLocale='en'){
 if(seconds===null)return t(locale,'common.notAvailableData');
 const total=Math.max(0,Math.round(seconds)),days=Math.floor(total/86400),hours=Math.floor(total%86400/3600),minutes=Math.floor(total%3600/60),secs=total%60;
 if(locale!=='en'){
  if(days)return `${days}日${hours?`${hours}時間`:''}`;
  if(hours)return `${hours}時間${minutes?`${minutes}分`:''}`;
  if(minutes)return `${minutes}分${secs?`${secs}秒`:''}`;
  return `${secs}秒`;
 }
 if(days)return `${days}d${hours?` ${hours}h`:''}`;
 if(hours)return `${hours}h${minutes?` ${minutes}m`:''}`;
 if(minutes)return `${minutes}m${secs?` ${secs}s`:''}`;
 return `${secs}s`;
}

export function formatNumber(value:number|null,locale:UiLocale='en'){return value===null?t(locale,'common.notAvailableData'):new Intl.NumberFormat(locale==='en'?'en-US':'ja-JP',{maximumFractionDigits:1}).format(value);}
export function formatSignedPoints(value:number,locale:UiLocale='en'){const points=Math.round(value*100);return locale==='en'?`${points>0?'+':points<0?'−':''}${Math.abs(points)} percentage points`:`${points>0?'+':points<0?'−':''}${Math.abs(points)}ポイント`;}
export function humanize(value:string){return value.toLowerCase().replaceAll('_',' ').replace(/(^|\s)\S/g,c=>c.toUpperCase());}
export function shortId(value:string){return value.slice(0,8);}
