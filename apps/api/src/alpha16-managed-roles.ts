import type { FastifyInstance } from "fastify";
import type { PublicApiContext, PublicApiRequest } from "../../../packages/security/src/public-api";
import type { AutomationService } from "../../../packages/automation/src/service";
import { ManagedRolePolicies, managedRolePolicyId } from "../../../packages/automation/src/managed-roles";
import type {ManagedRoleAdmissionAdapter} from '../../../packages/automation/src/managed-role-admission';

/** Reuses the existing signed public-session hop and current native member
 * proof. No body/header may supply an actor, guild authority or role policy. */
export function registerManagedRolePolicies(app: FastifyInstance, service: AutomationService,
  auth: (req: PublicApiRequest, permission: "CONFIGURE") => Promise<PublicApiContext>,admission?:ManagedRoleAdmissionAdapter) {
  const base = "/v3/organizations/:organizationId/guilds/:guildId/automation/managed-role-policies";
  const context = async (req: PublicApiRequest) => {
    const c = await auth(req, "CONFIGURE");
    return { ...c, policies: new ManagedRolePolicies(service, { scope: c.scope, actorHash: c.actor.key, expiresAt: new Date(c.snapshot.checkedAt + 10000) },admission) };
  };
  const id = (params: unknown) => managedRolePolicyId.parse((params as { policyId?: unknown }).policyId);
  app.get(base, async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.list(c.scope, c.actor); });
  app.get(base + "/history", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.history(c.scope, c.actor); });
  app.get(base + "/:policyId", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.detail(c.scope, c.actor, id(req.params)); });
  app.put(base + "/:policyId", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.save(c.scope, c.actor, id(req.params), req.body); });
  app.delete(base + "/:policyId", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.remove(c.scope, c.actor, id(req.params), req.body); });
  app.post(base + "/:policyId/check", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.check(c.scope, c.actor, id(req.params), req.body); });
  app.post(base + "/:policyId/enable", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.enable(c.scope, c.actor, id(req.params), req.body); });
  app.post(base + "/:policyId/prepare-enable", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.prepareEnable(c.scope,c.actor,id(req.params),req.body); });
  app.post(base + "/:policyId/prepare-run", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.prepareRun(c.scope, c.actor, id(req.params), req.body); });
  app.post(base + "/:policyId/runs", async (req, reply) => { reply.header("Cache-Control", "no-store"); const c = await context(req); return c.policies.run(c.scope, c.actor, id(req.params), req.body); });
}
