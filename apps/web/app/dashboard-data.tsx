import Console,{type ProductData} from './console';
import type {ActionsPresentation,DiscordOptions,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResultsPresentation} from '../../../packages/presentation/src/types';
import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {dashboardContext,openSession,authMode} from './auth/session';
import type {CommunityService} from '../../../packages/presentation/src/community';
import {releaseInfo} from '../../../packages/shared/src/runtime-info';
import {createHmac} from 'node:crypto';
import {userFailure} from '../../../packages/shared/src/errors';
import {FailureNotice} from './failure-ui';
import {siteLocale} from './public-ui';
export const dynamic='force-dynamic';
export default async function Page({guildId,view}:{guildId?:string;view?:string}={}){
 const started=Date.now();
 const cookieStore=await cookies();
 const selectedCookie=cookieStore.get('nexus_guild')?.value;
 if(guildId&&!/^\d{17,20}$/.test(guildId))redirect('/servers');
 const sessionCookie=cookieStore.get('nexus_session')?.value;
 if(guildId&&authMode()==='oauth'&&!openSession(sessionCookie))redirect(`/auth/login?next=/dashboard/${guildId}`);
 if(guildId&&selectedCookie!==guildId)redirect(`/auth/select?guild=${guildId}`);
 let context;try{context=await dashboardContext(sessionCookie,guildId??selectedCookie);}catch(error){return <main className="servers-content"><FailureNotice locale={await siteLocale()} failure={userFailure(error,'NOT_STARTED',{action:'dashboard',stage:'authorization'})}/></main>;}
 if(guildId&&context?.guildId!==guildId)redirect('/servers');
 if(!context){if(authMode()==='oauth'&&!sessionCookie)redirect('/auth/login');if(authMode()==='oauth'&&!openSession(sessionCookie))redirect('/auth/expired');redirect('/servers');}
 const data:ProductData={failures:{},home:null,journey:null,community:null,opportunities:null,actions:null,results:null,weeklyStatus:null,audit:[],options:{channels:[],roles:[],events:[],available:false},admin:null,guilds:context.guilds,selectedGuildId:context.guildId,developmentAuth:authMode()==='development'};
 {
  const headers={Authorization:`Bearer ${context.token}`},base=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}`;
  const read=async<T,>(path:string):Promise<T|null>=>{const section=new URL(path).pathname.split('/').at(-1)!;try{const response=await fetch(path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});const body=await response.json();if(response.ok)return body as T;data.failures![section]=body.failure??userFailure(new Error('API_READ_FAILED'),'NOT_STARTED',{action:section,stage:'read'});return null;}catch(error){data.failures![section]=userFailure(error,'NOT_STARTED',{action:section,stage:'read'});return null;}};
  const [home,journey,community,opportunities,actions,results,weeklyStatus,audit,options,admin,integration]=await Promise.all([read<HomePresentation>(base+'/home'),read<JourneyPresentation>(base+'/journey?range=30'),read<Awaited<ReturnType<CommunityService['overview']>>>(base+'/community?range=30&limit=50'),read<OpportunitiesPresentation>(base+'/opportunities'),read<ActionsPresentation>(base+'/actions'),read<ResultsPresentation>(base+'/results'),read<ProductData['weeklyStatus']>(base+'/weekly-summary/status'),read<ProductData['audit']>(base+'/audit'),read<DiscordOptions>(base+'/options'),read<ProductData['admin']>(`${context.base}/v2/organizations/${context.organizationId}/guilds/${context.guildId}/dashboard`),read<ProductData['integration']>(base+'/integration-health')]);
  Object.assign(data,{integration,home,journey,community,opportunities,actions,results,weeklyStatus,audit:audit??[],options:options??data.options,admin});
 }
 const health=await fetch(`${context.base}/health`,{cache:'no-store',signal:AbortSignal.timeout(3000)}).then(response=>response.ok?response.json():null).catch(()=>null) as {discordConnected?:boolean;interaction?:{lastResult?:string;transport?:string};commands?:{registered?:boolean}}|null;
 const diagnosticKey=process.env.LOOKUP_KEY??process.env.NEXUS_SESSION_SECRET;
 data.runtime={...releaseInfo(),guildHash:diagnosticKey?createHmac('sha256',diagnosticKey).update(context.guildId).digest('hex').slice(0,12):'unknown',gatewayConnected:health?.discordConnected??false,commandsRegistered:health?.commands?.registered??false,interactionTransport:health?.interaction?.transport??'unknown',lastInteractionResult:health?.interaction?.lastResult??'unknown'};
 const eventUrl=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}/product-event`,eventHeaders={Authorization:`Bearer ${context.token}`,'Content-Type':'application/json'};
 await Promise.allSettled(['web_dashboard_opened','page_render_latency'].map(event=>fetch(eventUrl,{method:'POST',headers:eventHeaders,body:JSON.stringify({event,...(event==='page_render_latency'?{durationMs:Date.now()-started}:{})}),cache:'no-store',signal:AbortSignal.timeout(3000)})));
 const saved=cookieStore.get('nexus_locale')?.value,preferred=String(data.admin?.settings.uiLanguage??''),accept=(await headers()).get('accept-language')??'';
 const initialLocale=saved==='ja'||saved==='en'?saved:preferred==='ja'||preferred==='en'?preferred:accept.toLowerCase().startsWith('ja')?'ja':'en';
 return <Console data={data} initialLocale={initialLocale} initialView={typeof view==='string'&&/^\d{1,2}$/.test(view)&&Number(view)<=14?Number(view):0}/>;
}
