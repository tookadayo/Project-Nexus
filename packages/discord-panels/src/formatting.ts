export function formatPercentage(value:number|null,digits=0){
 return value===null?'Not available':new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
}

export function formatDuration(seconds:number|null){
 if(seconds===null)return 'Not available';
 const total=Math.max(0,Math.round(seconds)),days=Math.floor(total/86400),hours=Math.floor(total%86400/3600),minutes=Math.floor(total%3600/60),secs=total%60;
 if(days)return `${days}d${hours?` ${hours}h`:''}`;
 if(hours)return `${hours}h${minutes?` ${minutes}m`:''}`;
 if(minutes)return `${minutes}m${secs?` ${secs}s`:''}`;
 return `${secs}s`;
}

export function formatNumber(value:number|null){return value===null?'Not available':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);}
export function formatSignedPoints(value:number){const points=Math.round(value*100);return `${points>0?'+':points<0?'−':''}${Math.abs(points)} percentage points`;}
export function humanize(value:string){return value.toLowerCase().replaceAll('_',' ').replace(/(^|\s)\S/g,c=>c.toUpperCase());}
export function shortId(value:string){return value.slice(0,8);}
