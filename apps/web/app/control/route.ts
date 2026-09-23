import {NextRequest,NextResponse} from 'next/server';
export async function POST(req:NextRequest){
 let sameOrigin=false;
 try{const origin=new URL(req.headers.get('origin')??'');sameOrigin=origin.host===req.headers.get('host')&&['http:','https:'].includes(origin.protocol)&&req.headers.get('sec-fetch-site')==='same-origin';}catch{/* Missing or invalid Origin is rejected. */}
 if(!sameOrigin)return NextResponse.json({error:'Origin rejected'},{status:403});
 const {NEXUS_API_URL,NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;
 if(!NEXUS_API_URL||!NEXUS_ORGANIZATION_ID||!NEXUS_GUILD_ID||!NEXUS_API_TOKEN)return NextResponse.json({error:'API unavailable'},{status:503});
 const body=await req.text();if(body.length>32768)return NextResponse.json({error:'Configuration too large'},{status:413});
 try{const parsed=JSON.parse(body) as Record<string,unknown>,action=String(parsed.action??''),base=`${NEXUS_API_URL}/v3/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}`;let url=`${NEXUS_API_URL}/v2/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/configuration`,payload=body;
  if(action==='activation_preset'){url=base+'/setup/activation';payload=JSON.stringify({preset:parsed.preset});}
  if(action==='action_template'){url=base+'/actions/draft';const {action:_action,...input}=parsed;void _action;payload=JSON.stringify(input);}
  if(action==='onboarding_recommended'){url=base+'/setup/onboarding/recommended';payload='{}';}
  if(action==='experiment_draft'){url=base+'/results/draft';payload=JSON.stringify({actionId:parsed.actionId,primaryMetric:parsed.primaryMetric});}
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${NEXUS_API_TOKEN}`,'Content-Type':'application/json'},body:payload,cache:'no-store',signal:AbortSignal.timeout(10000)});return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'API unavailable'},{status:503});}
}
