import {randomBytes} from 'node:crypto';
import {DiscordFailure} from '../../discord/src/rest';

export function errorReference(){return `NXS-${randomBytes(6).toString('hex').toUpperCase()}`;}

export function redactSecrets(value:string,extra:string[]=[]){
 let safe=value.replace(/(Authorization\s*[:=]\s*)(?:Bot|Bearer)?\s*[^\s,;]+/gi,'$1[REDACTED]')
  .replace(/(Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi,'$1: [REDACTED]')
  .replace(/(https?:\/\/[^\s/]+\/api\/v\d+\/webhooks\/\d+\/)[^\s/?]+/gi,'$1[REDACTED]')
  .replace(/((?:token|secret|password|api[_-]?key|verification[_-]?code)\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]');
 safe=safe.replace(/\bNX(?:[-\s]?[23456789ABCDEFGHJKMNPQRSTUVWXYZ]){12}\b/gi,'[REDACTED]');
 const environment=Object.entries(process.env).filter(([name])=>/(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|REDIS_URL|IDENTITY_KEY|LOOKUP_KEY|COMPONENT_KEY|COOKIE)/i.test(name)).map(([,secret])=>secret);
 for(const secret of [...environment,...extra])if(secret&&secret.length>=4)safe=safe.replaceAll(secret,'[REDACTED]');
 return safe;
}

export function failureSummary(error:unknown){
 if(error instanceof DiscordFailure)return {class:error.kind==='http'?`DiscordHTTP${error.status}`:`Discord${error.kind}`,message:error.message,httpStatus:error.status||null,routeCategory:error.routeCategory,rateLimitScope:error.rateLimitScope,bucket:error.bucket,retryAfter:error.retryAfter,isGlobal:error.isGlobal};
 return {class:error instanceof Error?error.name:'UnknownError',message:error instanceof Error?error.message:'Unknown error'};
}

export function logFailure(context:{reference?:string;action:string;command?:string;stage:string;error:unknown;secrets?:string[]}){
 const {error,secrets=[],...fields}=context;
 const record={timestamp:new Date().toISOString(),...fields,...failureSummary(error),stack:error instanceof Error?error.stack:undefined};
 const safe=Object.fromEntries(Object.entries(record).map(([key,value])=>[key,typeof value==='string'?redactSecrets(value,secrets):value]));
 process.stderr.write(JSON.stringify(safe)+'\n');
}
