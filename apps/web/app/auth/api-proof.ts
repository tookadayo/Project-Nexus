import "server-only";
import { createPublicApiProof } from "../../../../packages/security/src/public-api";
import { webOrigin } from "../../../../packages/config/src/web-origin";
import { DomainError } from "../../../../packages/shared/src/index";

type ApiContext = { organizationId: string; guildId: string; token: string; userId: string };

/** Keep user identity on the server-to-server hop; never return these headers to a browser. */
export function publicApiHeaders(context: ApiContext, sessionReference: string | undefined, method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${context.token}` };
  if (context.userId === "development") return headers;
  if (!sessionReference) throw new DomainError("SESSION_EXPIRED", 401);
  const origin = webOrigin();
  headers["X-Nexus-User-Proof"] = createPublicApiProof({
    scope: { organizationId: context.organizationId, guildId: context.guildId },
    userId: context.userId,
    sessionReference,
    method,
    path: new URL(url).pathname + new URL(url).search,
    body,
    ...(["GET", "HEAD"].includes(method) ? {} : { origin }),
  });
  if (!["GET", "HEAD"].includes(method)) headers.Origin = origin;
  return headers;
}
