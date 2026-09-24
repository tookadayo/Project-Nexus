import { NextResponse } from "next/server";
import {cookies} from 'next/headers';
import {dashboardContext} from '../../auth/session';

export async function GET() {
  try {
    const jar=await cookies(),context=await dashboardContext(jar.get('nexus_session')?.value,jar.get('nexus_guild')?.value);
    if(!context)return NextResponse.json({error:'Unauthorized guild access'},{status:403});
    const response = await fetch(
      `${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}/results`,
      {
        headers: { Authorization: `Bearer ${context.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
}
