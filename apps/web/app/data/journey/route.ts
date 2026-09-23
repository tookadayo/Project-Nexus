import {NextRequest,NextResponse} from 'next/server';
export async function GET(req:NextRequest){
 const range=req.nextUrl.searchParams.get('range');if(!['7','30','90'].includes(range??''))return NextResponse.json({error:'Invalid range'},{status:400});
 const {NEXUS_API_URL,NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;if(!NEXUS_API_URL||!NEXUS_ORGANIZATION_ID||!NEXUS_GUILD_ID||!NEXUS_API_TOKEN)return NextResponse.json({error:'API unavailable'},{status:503});
 try{const response=await fetch(`${NEXUS_API_URL}/v3/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/journey?range=${range}`,{headers:{Authorization:`Bearer ${NEXUS_API_TOKEN}`},cache:'no-store',signal:AbortSignal.timeout(15000)});return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'API unavailable'},{status:503});}
}
