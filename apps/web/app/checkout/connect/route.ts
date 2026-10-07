import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { openSession, validateOAuthSession } from "../../auth/session";
import { serverServices } from "../../auth/server-access";
import { scopeForGuild } from "../../../../../packages/security/src/scoping";
import { assert } from "../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../../billing/request";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const input = z
      .object({
        guildId: z.string().regex(/^\d{17,20}$/),
        confirm: z.literal(true),
      })
      .strict()
      .parse(JSON.parse(await billingBody(request)));
    const session = openSession(request.cookies.get("nexus_session")?.value);
    assert(session, "SESSION_EXPIRED", 401);
    await validateOAuthSession(session);
    const result = await serverServices().verification.connectOwner(
      scopeForGuild(input.guildId),
      session.userId,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return billingFailure(error);
  }
}
