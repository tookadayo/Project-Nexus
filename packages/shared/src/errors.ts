import { z } from "zod";
import { isDomainError } from "./index";
import { isDiscordFailure } from "../../discord/src/rest";
import { errorReference, logFailure } from "./diagnostics";
import type { ErrorCategory, FailureEffect, UserFailure } from "./error-types";
const codes: Record<string, ErrorCategory> = {
  BETA_UNAVAILABLE:'BETA_ACCESS',
  BETA_USAGE_LIMIT:'BETA_USAGE',
  ADMIN_REQUIRED: "PERMISSION",
  NEXUS_ROLE_REQUIRED: "PERMISSION",
  ANALYSIS_USAGE_UNAVAILABLE: "ANALYSIS_USAGE",
  ANALYSIS_PREVIEW_CHANGED: "REVISION_CONFLICT",
  ANALYSIS_NO_DATA: "VALIDATION",
  ANALYSIS_UNAVAILABLE: "VALIDATION",
  ANALYSIS_NOT_FOUND: "ANALYSIS_RESULT",
  ANALYSIS_DATA_REMOVED: "ANALYSIS_RESULT",
  ANALYSIS_RESULT_UNAVAILABLE: "ANALYSIS_RESULT",
  ANALYSIS_TARGET_UNAVAILABLE: "PERMISSION",
  FORBIDDEN: "PERMISSION",
  ORIGIN_REJECTED: "PERMISSION",
  COMPONENT_OWNER: "PERMISSION",
  SESSION_OWNER: "PERMISSION",
  ROLE_NOT_MANAGEABLE: "PERMISSION",
  MANAGE_ROLES_MISSING: "PERMISSION",
  PRIVILEGED_ROLE_MAPPING_FORBIDDEN: "PERMISSION",
  AUTHORIZATION_EXPIRED: "PERMISSION",
  CHANNEL_PERMISSION_MISSING: "CHANNEL_PERMISSION",
  INVALID_START_CHANNEL: "VALIDATION",
  CHANNEL_NOT_FOUND: "VALIDATION",
  HELPER_CHANNEL_REQUIRED: "VALIDATION",
  EVENT_NOT_AVAILABLE: "VALIDATION",
  INVALID_CONFIGURATION: "VALIDATION",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  COMPONENT_EXPIRED: "COMPONENT_EXPIRED",
  INVALID_COMPONENT: "COMPONENT_EXPIRED",
  PANEL_NOT_CONFIGURED: "COMPONENT_EXPIRED",
  STALE_FLOW_NODE: "COMPONENT_EXPIRED",
  SESSION_SUPERSEDED: "COMPONENT_EXPIRED",
  ENTITLEMENT_REQUIRED: "ENTITLEMENT",
  PLAN_REQUIRED: "ENTITLEMENT",
  BILLING_LIMIT_REACHED: "ENTITLEMENT",
  FEATURE_PLANNED: "ENTITLEMENT",
  BILLING_PROVIDER_NOT_CONFIGURED: "ENTITLEMENT",
  BILLING_AUTHORIZATION_REQUIRED: "PERMISSION",
  NEXUS_INTERNAL_ADMIN_REQUIRED: "PERMISSION",
  ORGANIZATION_BILLING_MANAGER_REQUIRED: "PERMISSION",
  PROMOTION_UNAVAILABLE: "VALIDATION",
  WEB_CONNECTION_UNAVAILABLE: "WEB_CONNECTION",
  CONNECTION_REJECTED: "WEB_CONNECTION",
  VERIFICATION_PRIVATE_REQUIRED: "WEB_CONNECTION",
  VERIFICATION_DELIVERY_FAILED: "WEB_CONNECTION",
  SESSION_EXPIRED: "AUTH_SESSION",
  VERIFICATION_INVALID: "VERIFICATION",
  VERIFICATION_RATE_LIMIT: "VERIFICATION",
  DISCORD_GUILDS_UNAVAILABLE: "DISCORD_UNAVAILABLE",
  DISCORD_UNAVAILABLE: "DISCORD_UNAVAILABLE",
  MORE_ACTIVITY_NEEDED: "VALIDATION",
};
export function errorCategory(error: unknown): ErrorCategory {
  if (isDiscordFailure(error))
    return error.kind === "timeout"
      ? "DISCORD_TIMEOUT"
      : error.status === 429
        ? "DISCORD_RATE_LIMIT"
        : error.status === 403
          ? "PERMISSION"
          : "DISCORD_UNAVAILABLE";
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return "VALIDATION";
  if (isDomainError(error)) {
    if (codes[error.code]) return codes[error.code]!;
    if (
      /^(?:(?:INVALID_|DUPLICATE_|SETUP_).+|UNKNOWN_SIGNAL|CONFIRMATION_REQUIRED|PREVIEW_REQUIRED|.*_NOT_CONFIGURED|.*_REQUIRED|.*_NOT_ACTIVE|.*_NOT_FOUND|.*_NOT_RUNNING|.*_DISABLED)$/.test(
        error.code,
      )
    )
      return "VALIDATION";
    return "INTERNAL";
  }
  if (error instanceof Error && codes[error.message])
    return codes[error.message]!;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[0-9]{2}[0-9A-Z]{3}$/.test(String(error.code))
  )
    return "DATABASE_FAILURE";
  return "INTERNAL";
}
export function userFailure(
  error: unknown,
  effect: FailureEffect = "UNKNOWN",
  context: {
    action: string;
    command?: string;
    stage: string;
    secrets?: string[];
  } = { action: "request", stage: "request" },
): UserFailure {
  const category = errorCategory(error),
    reference =
      isDiscordFailure(error) ||
      [
        "INTERNAL",
        "DATABASE_FAILURE",
        "DISCORD_TIMEOUT",
        "DISCORD_RATE_LIMIT",
        "DISCORD_UNAVAILABLE",
        "WEB_CONNECTION",
      ].includes(category)
        ? errorReference()
        : undefined;
  if (reference) logFailure({ ...context, error, reference });
  return { category, effect, ...(reference ? { reference } : {}) };
}
