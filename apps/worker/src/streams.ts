import {Redis} from 'ioredis';
import {eventSchema} from '../../../packages/events/src/index.js';
import type {LifecycleService} from '../../../packages/lifecycle/src/index.js';
import {STREAM} from '../../gateway/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
export async function scrubStream(redis:Redis,vault:IdentityVault,s:Scope,hash:string|null){
 let cursor='-';for(;;){const rows=await redis.xrange(STREAM,cursor,'+','COUNT',200);if(!rows.length)break;
  for(const [id,fields] of rows){let matches=false;try{const e=eventSchema.parse(JSON.parse(fields[fields.indexOf('event')+1]??''));matches=e.organizationId===s.organizationId&&e.guildId===s.guildId&&(hash===null||Boolean(e.encryptedUserId&&vault.hash(s,vault.open(s,e.encryptedUserId))===hash));}catch{/* Invalid envelopes are never projected. */}if(matches)await redis.xdel(STREAM,id);}
  cursor=`(${rows[rows.length-1]![0]}`;
 }
}
export class StreamConsumer {
 constructor(private readonly redis:Redis,private readonly service:LifecycleService,private readonly consumer:string,private readonly reclaimMs=60000,private readonly onReset:()=>Promise<void>=async()=>{}){}
 async init(){try{await this.redis.xgroup('CREATE',STREAM,'lifecycle','0','MKSTREAM');}catch(error){if(!(error instanceof Error)||!error.message.includes('BUSYGROUP'))throw error;}}
 async tick(){
  let entries:[string,string[]][];
  try{
   const claimed=await this.redis.xautoclaim(STREAM,'lifecycle',this.consumer,this.reclaimMs,'0-0','COUNT',20) as [string,[string,string[]][]];
   const batch=await this.redis.xreadgroup('GROUP','lifecycle',this.consumer,'COUNT',20,'STREAMS',STREAM,'>') as [string,[string,string[]][]][]|null;
   entries=[...claimed[1],...(batch?.[0]?.[1]??[])];
  }catch(error){if(error instanceof Error&&error.message.includes('NOGROUP')){await this.onReset();await this.init();return 0;}throw error;}
  for(const [id,fields] of entries){
   const raw=fields[fields.indexOf('event')+1];
   let parsed;try{parsed=eventSchema.safeParse(JSON.parse(raw??''));}catch{parsed=null;}
   if(!parsed?.success){await this.redis.xack(STREAM,'lifecycle',id);continue;}
   const envelope=parsed.data;
   try{await this.service.process(envelope);await this.service.deliveryHealth(envelope,false);await this.redis.xack(STREAM,'lifecycle',id);}
   catch{await this.service.deliveryHealth(envelope,true).catch(()=>{});/* Pending is reclaimed; incomplete ingestion downgrades coverage. */}
  }
  return entries.length;
 }
}
