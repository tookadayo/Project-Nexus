import Console,{type ProductData} from './console';
import type {ActionsPresentation,DiscordOptions,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResultsPresentation} from '../../../packages/presentation/src/types';
import {cookies,headers} from 'next/headers';
export const dynamic='force-dynamic';
export default async function Page(){
 const {NEXUS_API_URL,NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;
 const data:ProductData={home:null,journey:null,opportunities:null,actions:null,results:null,options:{channels:[],roles:[],events:[],available:false},admin:null};
 if(NEXUS_API_URL&&NEXUS_ORGANIZATION_ID&&NEXUS_GUILD_ID&&NEXUS_API_TOKEN){
  const headers={Authorization:`Bearer ${NEXUS_API_TOKEN}`},base=`${NEXUS_API_URL}/v3/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}`;
  const read=async<T,>(path:string):Promise<T|null>=>{try{const response=await fetch(path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});return response.ok?await response.json() as T:null;}catch{return null;}};
  const [home,journey,opportunities,actions,results,options,admin]=await Promise.all([read<HomePresentation>(base+'/home'),read<JourneyPresentation>(base+'/journey?range=30'),read<OpportunitiesPresentation>(base+'/opportunities'),read<ActionsPresentation>(base+'/actions'),read<ResultsPresentation>(base+'/results'),read<DiscordOptions>(base+'/options'),read<ProductData['admin']>(`${NEXUS_API_URL}/v2/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/dashboard`)]);
  Object.assign(data,{home,journey,opportunities,actions,results,options:options??data.options,admin});
 }
 const saved=(await cookies()).get('nexus_locale')?.value,preferred=String(data.admin?.settings.uiLanguage??''),accept=(await headers()).get('accept-language')??'';
 const initialLocale=saved==='ja'||saved==='en'?saved:preferred==='ja'||preferred==='en'?preferred:accept.toLowerCase().startsWith('ja')?'ja':'en';
 return <Console data={data} initialLocale={initialLocale}/>;
}
