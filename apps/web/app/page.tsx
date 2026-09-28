import Console,{type ProductData} from './console';
import type {ActionsPresentation,DiscordOptions,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResultsPresentation} from '../../../packages/presentation/src/types';
import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {dashboardContext,openSession,authMode} from './auth/session';
import type {CommunityService} from '../../../packages/presentation/src/community';
import {releaseInfo} from '../../../packages/shared/src/runtime-info';
import {createHmac} from 'node:crypto';
export const dynamic='force-dynamic';
export default async function Page(){
 const started=Date.now();
 const cookieStore=await cookies();
 let context;try{context=await dashboardContext(cookieStore.get('nexus_session')?.value,cookieStore.get('nexus_guild')?.value);}catch{context=null;}
 if(!context){const sessionCookie=cookieStore.get('nexus_session')?.value;if(authMode()==='oauth'&&!sessionCookie)redirect('/auth/login');if(authMode()==='oauth'&&!openSession(sessionCookie))redirect('/auth/expired');redirect('/servers');}
 const data:ProductData={home:null,journey:null,community:null,opportunities:null,actions:null,results:null,weeklyStatus:null,audit:[],options:{channels:[],roles:[],events:[],available:false},admin:null,guilds:context.guilds,selectedGuildId:context.guildId};
 {
  const headers={Authorization:`Bearer ${context.token}`},base=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}`;
  const read=async<T,>(path:string):Promise<T|null>=>{try{const response=await fetch(path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});return response.ok?await response.json() as T:null;}catch{return null;}};
  const [home,journey,community,opportunities,actions,results,weeklyStatus,audit,options,admin]=await Promise.all([read<HomePresentation>(base+'/home'),read<JourneyPresentation>(base+'/journey?range=30'),read<Awaited<ReturnType<CommunityService['overview']>>>(base+'/community?range=30'),read<OpportunitiesPresentation>(base+'/opportunities'),read<ActionsPresentation>(base+'/actions'),read<ResultsPresentation>(base+'/results'),read<ProductData['weeklyStatus']>(base+'/weekly-summary/status'),read<ProductData['audit']>(base+'/audit'),read<DiscordOptions>(base+'/options'),read<ProductData['admin']>(`${context.base}/v2/organizations/${context.organizationId}/guilds/${context.guildId}/dashboard`)]);
  Object.assign(data,{home,journey,community,opportunities,actions,results,weeklyStatus,audit:audit??[],options:options??data.options,admin});
 }
 const health=await fetch(`${context.base}/health`,{cache:'no-store',signal:AbortSignal.timeout(3000)}).then(response=>response.ok?response.json():null).catch(()=>null) as {discordConnected?:boolean;interaction?:{lastResult?:string;transport?:string};commands?:{registered?:boolean}}|null;
 const diagnosticKey=process.env.LOOKUP_KEY??process.env.NEXUS_SESSION_SECRET;
 data.runtime={...releaseInfo(),guildHash:diagnosticKey?createHmac('sha256',diagnosticKey).update(context.guildId).digest('hex').slice(0,12):'unknown',gatewayConnected:health?.discordConnected??false,commandsRegistered:health?.commands?.registered??false,interactionTransport:health?.interaction?.transport??'unknown',lastInteractionResult:health?.interaction?.lastResult??'unknown'};
 const eventUrl=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}/product-event`,eventHeaders={Authorization:`Bearer ${context.token}`,'Content-Type':'application/json'};
 await Promise.allSettled(['panel_opened','page_render_latency'].map(event=>fetch(eventUrl,{method:'POST',headers:eventHeaders,body:JSON.stringify({event,...(event==='page_render_latency'?{durationMs:Date.now()-started}:{})}),cache:'no-store',signal:AbortSignal.timeout(3000)})));
 const saved=cookieStore.get('nexus_locale')?.value,preferred=String(data.admin?.settings.uiLanguage??''),accept=(await headers()).get('accept-language')??'';
 const initialLocale=saved==='ja'||saved==='en'?saved:preferred==='ja'||preferred==='en'?preferred:accept.toLowerCase().startsWith('ja')?'ja':'en';
 return <Console data={data} initialLocale={initialLocale}/>;
}
