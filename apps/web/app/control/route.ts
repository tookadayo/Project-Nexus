import {NextRequest,NextResponse} from 'next/server';
export async function POST(req:NextRequest){
 let sameOrigin=false;
 try{const origin=new URL(req.headers.get('origin')??'');sameOrigin=origin.host===req.headers.get('host')&&['http:','https:'].includes(origin.protocol)&&req.headers.get('sec-fetch-site')==='same-origin';}catch{/* Missing or invalid Origin is rejected. */}
 if(!sameOrigin)return NextResponse.json({error:'Origin rejected'},{status:403});
 const {NEXUS_API_URL,NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;
 if(!NEXUS_API_URL||!NEXUS_ORGANIZATION_ID||!NEXUS_GUILD_ID||!NEXUS_API_TOKEN)return NextResponse.json({error:'API unavailable'},{status:503});
 const body=await req.text();if(body.length>32768)return NextResponse.json({error:'Configuration too large'},{status:413});
 try{const response=await fetch(`${NEXUS_API_URL}/v2/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/configuration`,{method:'POST',headers:{Authorization:`Bearer ${NEXUS_API_TOKEN}`,'Content-Type':'application/json'},body,cache:'no-store',signal:AbortSignal.timeout(10000)});return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'API unavailable'},{status:503});}
}
