import { NextResponse } from "next/server";

export async function GET() {
  const {
    NEXUS_API_URL,
    NEXUS_ORGANIZATION_ID,
    NEXUS_GUILD_ID,
    NEXUS_API_TOKEN,
  } = process.env;
  if (
    !NEXUS_API_URL ||
    !NEXUS_ORGANIZATION_ID ||
    !NEXUS_GUILD_ID ||
    !NEXUS_API_TOKEN
  )
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  try {
    const response = await fetch(
      `${NEXUS_API_URL}/v3/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/actions`,
      {
        headers: { Authorization: `Bearer ${NEXUS_API_TOKEN}` },
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
