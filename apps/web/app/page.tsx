import Console,{type ProductData} from './console';
import type {ActionsPresentation,DiscordOptions,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResultsPresentation} from '../../../packages/presentation/src/types';
import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {dashboardContext} from './auth/session';
export const dynamic='force-dynamic';
export default async function Page(){
 const cookieStore=await cookies();
 let context;try{context=await dashboardContext(cookieStore.get('nexus_session')?.value,cookieStore.get('nexus_guild')?.value);}catch{context=null;}
 if(!context){if(!cookieStore.get('nexus_session')?.value)redirect('/auth/login');return <main><h1>No administered Discord server is available</h1><p>Ask a server administrator for access, or sign in with another Discord account.</p><a href="/auth/logout">Sign in with another account</a></main>;}
 const data:ProductData={home:null,journey:null,opportunities:null,actions:null,results:null,options:{channels:[],roles:[],events:[],available:false},admin:null,guilds:context.guilds,selectedGuildId:context.guildId};
 {
  const headers={Authorization:`Bearer ${context.token}`},base=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}`;
  const read=async<T,>(path:string):Promise<T|null>=>{try{const response=await fetch(path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});return response.ok?await response.json() as T:null;}catch{return null;}};
  const [home,journey,opportunities,actions,results,options,admin]=await Promise.all([read<HomePresentation>(base+'/home'),read<JourneyPresentation>(base+'/journey?range=30'),read<OpportunitiesPresentation>(base+'/opportunities'),read<ActionsPresentation>(base+'/actions'),read<ResultsPresentation>(base+'/results'),read<DiscordOptions>(base+'/options'),read<ProductData['admin']>(`${context.base}/v2/organizations/${context.organizationId}/guilds/${context.guildId}/dashboard`)]);
  Object.assign(data,{home,journey,opportunities,actions,results,options:options??data.options,admin});
 }
 const saved=cookieStore.get('nexus_locale')?.value,preferred=String(data.admin?.settings.uiLanguage??''),accept=(await headers()).get('accept-language')??'';
 const initialLocale=saved==='ja'||saved==='en'?saved:preferred==='ja'||preferred==='en'?preferred:accept.toLowerCase().startsWith('ja')?'ja':'en';
 return <Console data={data} initialLocale={initialLocale}/>;
}
