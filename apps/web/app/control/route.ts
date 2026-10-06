import { NextRequest, NextResponse } from "next/server";
import { dashboardContext, openSession, authMode } from "../auth/session";
import { failureResponse } from "../auth/failure-response";
import { DomainError } from "../../../../packages/shared/src/index";
import { sameOrigin } from "../auth/origin";
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return failureResponse(
      new DomainError("ORIGIN_REJECTED", 403),
      "NOT_STARTED",
    );
  if (
    !openSession(req.cookies.get("nexus_session")?.value) &&
    authMode() !== "development"
  )
    return failureResponse(
      new DomainError("SESSION_EXPIRED", 401),
      "NOT_STARTED",
    );
  let context;
  try {
    context = await dashboardContext(
      req.cookies.get("nexus_session")?.value,
      req.cookies.get("nexus_guild")?.value,
    );
  } catch (error) {
    return failureResponse(error, "NOT_STARTED");
  }
  if (!context)
    return failureResponse(
      new DomainError("ADMIN_REQUIRED", 403),
      "NOT_STARTED",
    );
  if (!context.operationsCanConfigure)
    return failureResponse(
      new DomainError("NEXUS_ROLE_REQUIRED", 403),
      "NOT_STARTED",
    );
  const body = await req.text();
  if (body.length > 32768)
    return failureResponse(
      new DomainError("INVALID_CONFIGURATION", 413),
      "NOT_STARTED",
    );
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>,
      action = String(parsed.action ?? ""),
      base = `${context.base}/v3/organizations/${context.organizationId}/guilds/${context.guildId}`;
    let url = `${context.base}/v2/organizations/${context.organizationId}/guilds/${context.guildId}/configuration`,
      payload = body;
    if (action === "activation_preset") {
      url = base + "/setup/activation";
      payload = JSON.stringify({ preset: parsed.preset });
    }
    if (action === "notification_channel") {
      url = base + "/settings/notification";
      payload = JSON.stringify({
        channelId: parsed.channelId,
        revision: parsed.revision,
      });
    }
    if (action === "retention_days") {
      url = base + "/settings/retention";
      payload = JSON.stringify({
        days: parsed.days,
        revision: parsed.revision,
      });
    }
    if (action === "weekly_summary") {
      url = base + "/settings/weekly-summary";
      payload = JSON.stringify({
        enabled: parsed.enabled,
        channelId: parsed.channelId,
        day: parsed.day,
        hour: parsed.hour,
        timezone: parsed.timezone,
        revision: parsed.revision,
      });
    }
    if (action === "helper") {
      url = base + "/settings/helper";
      payload = JSON.stringify({
        enabled: parsed.enabled,
        channelId: parsed.channelId,
        roleId: parsed.roleId,
        responseMinutes: parsed.responseMinutes,
        cooldownMinutes: parsed.cooldownMinutes,
        revision: parsed.revision,
      });
    }
    if (action === "goals") {
      url = base + "/settings/goals";
      payload = JSON.stringify({
        preset: parsed.preset,
        goals: parsed.goals,
        channels: parsed.channels,
        revision: parsed.revision,
      });
    }
    if (action === "community_model") {
      url = base + "/settings/community-model";
      payload = JSON.stringify({
        profile: parsed.profile,
        revision: parsed.revision,
      });
    }
    if (action === "capability_refresh") {
      url = base + "/community-model/refresh";
      payload = "{}";
    }
    if (action === "analysis_scope") {
      url = base + "/settings/analysis-scope";
      payload = JSON.stringify({
        mode: parsed.mode,
        channelIds: parsed.channelIds,
        staffRoleIds: parsed.staffRoleIds,
        revision: parsed.revision,
      });
    }
    if (action === "feedback_dismiss") {
      url = base + "/opportunities/dismiss";
      payload = JSON.stringify({
        suggestionType: parsed.suggestionType,
        reason: parsed.reason ?? null,
      });
    }
    if (action === "attention_action") {
      url = base + "/attention/action";
      payload = JSON.stringify({
        channelId: parsed.channelId,
        messageId: parsed.messageId,
        status: parsed.status,
        minutes: parsed.minutes,
        untilToday: parsed.untilToday,
      });
    }
    if (action === "action_template") {
      url = base + "/actions/draft";
      const { action: _action, ...input } = parsed;
      void _action;
      payload = JSON.stringify(input);
    }
    if (action === "action_preflight" || action === "action_test") {
      url =
        base +
        (action === "action_test" ? "/actions/test" : "/actions/preflight");
      const { action: _action, ...input } = parsed;
      void _action;
      payload = JSON.stringify(input);
    }
    if (action === "onboarding_recommended") {
      url = base + "/setup/onboarding/recommended";
      payload = "{}";
    }
    if (action === "experiment_draft") {
      url = base + "/results/draft";
      payload = JSON.stringify({
        actionId: parsed.actionId,
        primaryMetric: parsed.primaryMetric,
      });
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.token}`,
        "Content-Type": "application/json",
      },
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failureResponse(error);
  }
}
