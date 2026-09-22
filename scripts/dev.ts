import {loadEnvFile} from 'node:process';
import {hostname} from 'node:os';
import {Queue,Worker} from 'bullmq';
import {Redis} from 'ioredis';
import {trace} from '@opentelemetry/api';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {readConfig} from '../packages/config/src/index.js';
import {connect,migrate,sql} from '../packages/db/src/index.js';
import {IdentityVault} from '../packages/identity/src/index.js';
import {Components} from '../packages/security/src/index.js';
import {PrivacyService} from '../packages/security/src/privacy.js';
import {SettingsService} from '../packages/settings/src/index.js';
import {OnboardingService} from '../packages/onboarding/src/index.js';
import {LifecycleService} from '../packages/lifecycle/src/index.js';
import {AnalyticsService} from '../packages/analytics/src/index.js';
import {DiscordRest} from '../packages/discord/src/rest.js';
import {createInteractionServer} from '../apps/interaction/src/server.js';
import {createApi} from '../apps/api/src/server.js';
import {createGateway,STREAM} from '../apps/gateway/src/index.js';
import {StreamConsumer,scrubStream} from '../apps/worker/src/streams.js';
import {ActionWorker} from '../apps/worker/src/actions.js';
import {InteractionWorker} from '../apps/worker/src/interactions.js';
import {NativeMemberSnapshotWorker} from '../packages/lifecycle/src/native.js';
import {OptimizationWorker} from '../apps/worker/src/optimization.js';
import {CapabilityService} from '../packages/lifecycle/src/capabilities.js';
import {scopeSchema,type Scope} from '../packages/shared/src/index.js';
try{loadEnvFile();}catch{/* Config validation below reports missing fields. */}
const cfg=readConfig();const db=connect(cfg.DATABASE_URL);await migrate(db);
const redis=new Redis(cfg.REDIS_URL,{maxRetriesPerRequest:1,enableOfflineQueue:false,lazyConnect:true});redis.on('error',()=>process.stderr.write('Redis unavailable\n'));await redis.connect();
const vault=new IdentityVault(cfg.IDENTITY_KEY,cfg.LOOKUP_KEY);const tokens=new Components(cfg.COMPONENT_KEY);const discord=new DiscordRest(cfg.DISCORD_TOKEN,cfg.DISCORD_APPLICATION_ID);
const settings=new SettingsService(db);const onboarding=new OnboardingService(db,settings,vault);const privacy=new PrivacyService(db,vault,settings,(s,hash)=>scrubStream(redis,vault,s,hash));
const analytics=new AnalyticsService(db,settings);const lifecycle=new LifecycleService(db,vault,settings,discord);
const nativeSnapshots=new NativeMemberSnapshotWorker(db,vault,discord);
const optimization=new OptimizationWorker(db);
const actions=new ActionWorker(db,vault,discord,onboarding);const interactions=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,(s,user,actor,guild)=>privacy.delete(s,user,actor,guild));
const http=createInteractionServer({db,vault,publicKey:cfg.DISCORD_PUBLIC_KEY,applicationId:cfg.DISCORD_APPLICATION_ID,components:tokens});
const api=createApi(analytics,cfg.API_KEY,db);const gateway=createGateway(redis,vault,()=>process.stderr.write('Gateway metadata publication failed\n'),db);
const capabilities=new CapabilityService(db,discord,()=>{const ready=gateway.client.isReady()?true:null;return {members:ready,messages:ready,reactions:ready,voice:ready,scheduledEvents:ready};});
// Tenant registry discovery is scheduler-only; every domain operation receives the explicit scope.
async function scopes(){return (await sql<{organization_id:string,guild_id:string}>`SELECT organization_id,guild_id FROM guilds`.execute(db)).rows.map(row=>({organizationId:row.organization_id,guildId:row.guild_id}));}
const consumer=new StreamConsumer(redis,lifecycle,`${hostname()}-${process.pid}`,60000,async()=>{for(const s of await scopes())await lifecycle.streamReset(s);});await consumer.init();
const url=new URL(cfg.REDIS_URL);const connection={host:url.hostname,port:Number(url.port||6379),username:url.username||undefined,password:url.password||undefined,db:Number(url.pathname.slice(1)||0),...(url.protocol==='rediss:'?{tls:{}}:{})};
const queue=new Queue<Scope>('nexus-work',{connection});
const sdk=process.env.OTEL_EXPORTER_OTLP_ENDPOINT?new NodeSDK({serviceName:'nexus'}):null;sdk?.start();
const tracer=trace.getTracer('nexus');
const worker=new Worker<Scope>('nexus-work',async job=>{
 const s=scopeSchema.parse(job.data);await tracer.startActiveSpan('guild.work',async span=>{try{
  for(let i=0;i<20&&await interactions.tick(s);i++){/* bounded drain */}
  for(let i=0;i<30&&await actions.tick(s);i++){/* bounded drain */}
  for(let i=0;i<5&&await nativeSnapshots.tick(s);i++){/* bounded REST snapshots */}
  await optimization.tick(s);
 }finally{span.end();}});
},{connection,concurrency:4});worker.on('error',()=>process.stderr.write('Background worker unavailable\n'));
let stopped=false;let lastMaintenance=0;let lastAggregate=0;let lastCapabilities=0;
const loop=async()=>{while(!stopped){try{
 await consumer.tick();
 await gateway.publisher.recover();
 if(Date.now()-lastMaintenance>10000){
  if(Date.now()-lastCapabilities>1800000){for(const s of await scopes()){const configuration=await settings.get(s);if(configuration.enabled&&configuration.flags.native_capability_v2)await capabilities.refresh(s,configuration.onboardingMode).catch(()=>process.stderr.write('Capability refresh unavailable\n'));}lastCapabilities=Date.now();}
  if(Date.now()-lastAggregate>3600000){for(const s of await scopes())await analytics.materialize(s);lastAggregate=Date.now();}
  for(const s of await scopes()){await queue.add('guild',s,{jobId:s.guildId,removeOnComplete:true,removeOnFail:true,attempts:3,backoff:{type:'exponential',delay:1000}});await privacy.purge(s);}
  await redis.xtrim(STREAM,'MINID',`${Date.now()-86400000}-0`);lastMaintenance=Date.now();
 }
 }catch{process.stderr.write('Worker recovery pending\n');}
 await new Promise(resolve=>setTimeout(resolve,250));
 }};
await Promise.all([http.listen({host:'127.0.0.1',port:cfg.INTERACTION_PORT}),api.listen({host:'127.0.0.1',port:cfg.API_PORT}),gateway.client.login(cfg.DISCORD_TOKEN)]);
process.stdout.write(`Interaction HTTP :${cfg.INTERACTION_PORT}; API :${cfg.API_PORT}\n`);const running=loop();
async function stop(){if(stopped)return;stopped=true;await running;await gateway.stop();await worker.close();await queue.close();await http.close();await api.close();await redis.quit();await db.destroy();await sdk?.shutdown();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
