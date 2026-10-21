import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";

/** A live Discord membership observation, never a client-provided claim. */
export type MaintenanceAuthorizationProof = {
  scope: Scope;
  actorHash: string;
  expiresAt: Date;
};
export function assertMaintenanceAuthorization(
  proof: MaintenanceAuthorizationProof | undefined,
  scope: Scope,
  actor: Actor,
  now = new Date(),
) {
  assert(
    proof && proof.scope.organizationId === scope.organizationId &&
      proof.scope.guildId === scope.guildId && proof.actorHash === actor.key &&
      Number.isFinite(proof.expiresAt.getTime()) && proof.expiresAt > now,
    "CURRENT_AUTHORIZATION_REQUIRED", 403,
  );
}
