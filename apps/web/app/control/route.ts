import {NextRequest,NextResponse} from 'next/server';
import {dashboardContext} from '../auth/session';
export async function POST(req:NextRequest){
 let sameOrigin=false;
 try{const origin=new URL(req.headers.get('origin')??'');sameOrigin=origin.host===req.headers.get('host')&&['http:','https:'].includes(origin.protocol)&&req.headers.get('sec-fetch-site')==='same-origin';}catch{/* Missing or invalid Origin is rejected. */}
 if(!sameOrigin)return NextResponse.json({error:'Origin rejected'},{status:403});
 let context;try{context=await dashboardContext(req.cookies.get('nexus_session')?.value,req.cookies.get('nexus_guild')?.value);}catch{return NextResponse.json({error:'Authorization unavailable'},{status:503});}
 if(!context)return NextResponse.json({error:'Unauthorized guild access'},{status:403});
 const body=await req.text();if(body.length>32768)return NextResponse.json({error:'Configuration too large'},{status:413});
 try{const parsed=JSON.parse(body) as Record<string,unknown>,action=String(parsed.action??''),base=`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}`;let url=`${context.base}/v2/organizations/${context.organizationId}/guilds/${context.guildId}/configuration`,payload=body;
  if(action==='activation_preset'){url=base+'/setup/activation';payload=JSON.stringify({preset:parsed.preset});}
  if(action==='notification_channel'){url=base+'/settings/notification';payload=JSON.stringify({channelId:parsed.channelId,revision:parsed.revision});}
  if(action==='retention_days'){url=base+'/settings/retention';payload=JSON.stringify({days:parsed.days,revision:parsed.revision});}
  if(action==='weekly_summary'){url=base+'/settings/weekly-summary';payload=JSON.stringify({enabled:parsed.enabled,channelId:parsed.channelId,revision:parsed.revision});}
  if(action==='feedback_dismiss'){url=base+'/opportunities/dismiss';payload=JSON.stringify({suggestionType:parsed.suggestionType,reason:parsed.reason??null});}
  if(action==='action_template'){url=base+'/actions/draft';const {action:_action,...input}=parsed;void _action;payload=JSON.stringify(input);}
  if(action==='action_preflight'||action==='action_test'){url=base+(action==='action_test'?'/actions/test':'/actions/preflight');const {action:_action,...input}=parsed;void _action;payload=JSON.stringify(input);}
  if(action==='onboarding_recommended'){url=base+'/setup/onboarding/recommended';payload='{}';}
  if(action==='experiment_draft'){url=base+'/results/draft';payload=JSON.stringify({actionId:parsed.actionId,primaryMetric:parsed.primaryMetric});}
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${context.token}`,'Content-Type':'application/json'},body:payload,cache:'no-store',signal:AbortSignal.timeout(10000)});return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'API unavailable'},{status:503});}
}
