import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AttentionQueue,
  attentionPageInput,
} from "../../../../../packages/operations/src/attention-queue";
import { assert } from "../../../../../packages/shared/src/index";
import { operationsContext } from "../../operations/context";
import { assertDisplayedGuild } from "../../auth/displayed-guild";
import { failureResponse } from "../../auth/failure-response";
import { sameOrigin } from "../../auth/origin";
export const runtime = "nodejs";
async function context(request: NextRequest) {
  const c = await operationsContext();
  assertDisplayedGuild(request.headers.get("X-Nexus-Guild"), c.scope.guildId);
  const readable = (channelId: string) =>
    c.services.discord.canReadAttentionChannel(
      c.scope.guildId,
      channelId,
      c.userId,
      c.snapshot.member,
    );
  return {
    c,
    readable,
    queue: new AttentionQueue(c.services.db, process.env.COMPONENT_KEY ?? ""),
  };
}
function failure(
  error: unknown,
  effect: "NOT_STARTED" | "UNKNOWN" = "NOT_STARTED",
) {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "INVALID_ATTENTION_REQUEST" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return failureResponse(error, effect);
}
export async function GET(request: NextRequest) {
  try {
    const { c, readable, queue } = await context(request);
    const input = attentionPageInput.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const page = await queue.page(
      c.scope,
      c.actor,
      input,
      new Date(),
      readable,
    );
    return NextResponse.json(page, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  let started = false;
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const { c, readable, queue } = await context(request);
    const text = await request.text();
    assert(text.length <= 4096, "REQUEST_TOO_LARGE", 413);
    started = true;
    const result = await queue.action(
      c.scope,
      c.actor,
      JSON.parse(text),
      readable,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error, started ? "UNKNOWN" : "NOT_STARTED");
  }
}
