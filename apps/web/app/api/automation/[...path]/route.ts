import { NextRequest, NextResponse } from "next/server";
import { dashboardContext } from "../../../auth/session";
import { publicApiHeaders } from "../../../auth/api-proof";
import { assertDisplayedGuild } from "../../../auth/displayed-guild";
import { sameOrigin } from "../../../auth/origin";
import { failureResponse } from "../../../auth/failure-response";
import { DomainError } from "../../../../../../packages/shared/src/index";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, route: RouteContext) {
  try {
    const { path } = await route.params;
    if (!path.length || path.length > 5 || path.some(part => !/^[a-zA-Z0-9_-]{1,100}$/.test(part)))
      throw new DomainError("INVALID_CONFIGURATION", 400);
    const mutation = req.method !== "GET";
    if (mutation && !sameOrigin(req)) throw new DomainError("ORIGIN_REJECTED", 403);
    const session = req.cookies.get("nexus_session")?.value;
    const current = await dashboardContext(session, req.cookies.get("nexus_guild")?.value);
    if (!current) throw new DomainError("SESSION_REQUIRED", 401);
    assertDisplayedGuild(req.headers.get("X-Nexus-Guild"), current.guildId);
    if (mutation && !current.operationsCanConfigure) throw new DomainError("NEXUS_ROLE_REQUIRED", 403);
    const url = `${current.base}/v3/organizations/${current.organizationId}/guilds/${current.guildId}/automation/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
    const body = mutation ? await req.text() : undefined;
    if (body && new TextEncoder().encode(body).byteLength > 600 * 1024)
      throw new DomainError("INVALID_CONFIGURATION", 413);
    const response = await fetch(url, {
      method: req.method,
      headers: { ...publicApiHeaders(current, session, req.method, url), "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    // A lost mutation response is unknown. The UI must look up its request ID.
    return failureResponse(error, req.method === "GET" ? "NOT_STARTED" : "UNKNOWN");
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
