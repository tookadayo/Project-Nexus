import { assertDisplayedGuild } from "../../auth/displayed-guild";
import { DomainError } from "../../../../../packages/shared/src/index";
import { failureResponse } from "../../auth/failure-response";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dashboardContext } from "../../auth/session";

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies(),
      context = await dashboardContext(
        jar.get("nexus_session")?.value,
        jar.get("nexus_guild")?.value,
      );
    if (!context)
      return failureResponse(
        new DomainError("ADMIN_REQUIRED", 403),
        "NOT_STARTED",
      );
    assertDisplayedGuild(req.headers.get("X-Nexus-Guild"), context.guildId);
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
  } catch (error) {
    return failureResponse(error, "NOT_STARTED");
  }
}
