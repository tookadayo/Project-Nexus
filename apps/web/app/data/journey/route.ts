import {NextRequest,NextResponse} from 'next/server';
import {dashboardContext} from '../../auth/session';
export async function GET(req:NextRequest){
 const range=req.nextUrl.searchParams.get('range');if(!['7','30','90'].includes(range??''))return NextResponse.json({error:'Invalid range'},{status:400});
 try{const context=await dashboardContext(req.cookies.get('nexus_session')?.value,req.cookies.get('nexus_guild')?.value);if(!context)return NextResponse.json({error:'Unauthorized guild access'},{status:403});const response=await fetch(`${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}/journey?range=${range}`,{headers:{Authorization:`Bearer ${context.token}`},cache:'no-store',signal:AbortSignal.timeout(15000)});return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'API unavailable'},{status:503});}
}
