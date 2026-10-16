import {NextRequest, NextResponse} from "next/server";
import {setupContext} from "../../../auth/session";
import {sameOrigin} from "../../../auth/origin";
import {failureResponse} from "../../../auth/failure-response";
import {DomainError} from "../../../../../../packages/shared/src/index";
import {createPublicApiProof} from "../../../../../../packages/security/src/public-api";
import {webOrigin} from "../../../../../../packages/config/src/web-origin";

export const dynamic = "force-dynamic";
type Context = {params: Promise<{operation: string[]}>};

async function proxy(request: NextRequest, context: Context) {
  try {
    const {operation} = await context.params;
    const route = operation.join("/");
    const reading = ["GET", "HEAD"].includes(request.method);
    const allowed = reading
      ? ["status", "candidates"].includes(route) || /^requests\/[0-9a-f-]{36}$/i.test(route)
      : ["requests", "verify", "draft", "apply", "complete"].includes(route);
    if (!allowed) return new NextResponse(null, {status: 404});
    if (!reading && !sameOrigin(request)) throw new DomainError("CROSS_ORIGIN", 403);
    const guild = request.nextUrl.searchParams.get("guild");
    if (!guild || !/^\d{17,20}$/.test(guild) || request.headers.get("X-Nexus-Guild") !== guild) throw new DomainError("SERVER_SELECTION_CHANGED", 409);
    const identity = await setupContext(request.cookies.get("nexus_session")?.value, guild);
    if (!identity || identity.guildId !== guild) throw new DomainError("SESSION_REQUIRED", 401);
    const path = `/v3/organizations/${identity.organizationId}/guilds/${identity.guildId}/web-setup/${route}`;
    const origin = reading ? undefined : webOrigin(request);
    // No actor, session secret, API key or authority flag comes from the browser.
    const body = reading ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > 256 * 1024) throw new DomainError("INVALID_INPUT", 400);
    const proof = createPublicApiProof({scope: {organizationId: identity.organizationId, guildId: identity.guildId}, userId: identity.userId,
      sessionReference: identity.sessionReference, method: request.method, path, body, ...(origin ? {origin} : {})});
    const response = await fetch(identity.base + path, {
      method: request.method, headers: {Authorization: `Bearer ${identity.token}`, "x-nexus-user-proof": proof,
        ...(reading ? {} : {"Content-Type": "application/json", Origin: origin!})},
      body, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    return new NextResponse(await response.text(), {status: response.status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});
  } catch (error) {
    return failureResponse(error, request.method === "GET" ? "NOT_STARTED" : "UNKNOWN");
  }
}

export const GET = proxy;
export const POST = proxy;
