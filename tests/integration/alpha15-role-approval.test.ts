import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild, apiToken } from "../../packages/security/src/scoping";
import { PublicSessions } from "../../packages/security/src/public-sessions";
import { createPublicApiProof } from "../../packages/security/src/public-api";
import { IdentityVault } from "../../packages/identity/src/index";
import { isDomainError } from "../../packages/shared/src/index";
import {
  AutomationService,
  type AutomationServiceOptions,
} from "../../packages/automation/src/service";
import { fingerprint } from "../../packages/automation/src/store";
import type { FlowDefinition } from "../../packages/automation/src/types";
import type { AutomationRolePolicyInput } from "../../packages/discord/src/rest";
import { registerAlpha15Automation } from "../../apps/api/src/alpha15-automation";
import { FakeDiscord } from "../fixtures/discord";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database,
  infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  serial = 0;
const requester = "889111111111111111",
  approver = "889222222222222222",
  member = "889333333333333333",
  role = "889444444444444444",
  secret = "s".repeat(64),
  key = "synthetic-role-api",
  vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const limits = {
  activeFlows: 10,
  monthlyRuns: 100,
  guildConcurrent: 10,
  globalConcurrent: 100,
  guildPending: 20,
  globalPending: 200,
  measurementId: "synthetic-role-approval-test",
};
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  vi.stubEnv("NEXUS_SESSION_SECRET", secret);
  vi.stubEnv("NEXUS_WEB_URL", "https://nexus.example");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  // Exercise the current public-session schema, including v2 proof replay
  // state. A partial alpha15 schema fails before the live policy checks.
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});

async function fixture(
  policy?: AutomationServiceOptions["approvalPolicy"],
  operation: "discord.addRole" | "discord.removeRole" = "discord.addRole",
) {
  const s = scopeForGuild(String(889000000000000000n + BigInt(++serial)));
  await ensureGuild(db, s);
  const actor = (id: string) => ({
      key: vault.hash(s, id),
      encryptedUserId: vault.seal(s, id),
      permissions: "268435488",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: randomUUID(),
    }),
    owner = actor(requester),
    governor = actor(approver);
  const definition: FlowDefinition = {
    schemaVersion: 1,
    id: "approval-" + serial,
    guildId: s.guildId,
    name: "Synthetic formal approval",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    targets: { channelIds: [], roleIds: [role], parentCategoryIds: [] },
    body: [
      {
        kind: "action",
        id: "role",
        operation,
        approvalRequired: true,
        inputs: {
          member: {
            kind: "literal",
            type: "MemberRef",
            value: { id: member, guildId: s.guildId },
          },
          role: {
            kind: "literal",
            type: "RoleRef",
            value: { id: role, guildId: s.guildId },
          },
        },
      },
    ],
  };
  const service = new AutomationService(db, {
    admission: limits,
    authorize: async () => {},
    adoptedActions: new Set(["discord.addRole", "discord.removeRole"]),
    approvalPolicy: policy,
  });
  const saved = await service.save(s, owner, {
    definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const)
    await service.check(s, owner, definition.id, 1, kind, kind === "TEST" ? { outcomes: { role: "SUCCEEDED" } } : {});
  await service.enable(s, owner, definition.id, {
    revision: 1,
    semanticHash: saved.validation.semanticHash!,
    requestId: randomUUID(),
  });
  const started = await service.start(s, owner, definition.id, {
      requestId: randomUUID(),
    }),
    run = (await service.store.run(s, started.id))!;
  const inputs = {
    member: {
      type: "MemberRef" as const,
      value: { id: member, guildId: s.guildId },
      provenance: [],
    },
    role: {
      type: "RoleRef" as const,
      value: { id: role, guildId: s.guildId },
      provenance: [],
    },
  };
  const approval = await service.store.requireApproval(
    s,
    run,
    "fixed-role",
    operation,
    inputs,
  );
  await sql`UPDATE automation_runs SET status='WAITING_APPROVAL' WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(
    db,
  );
  return { s, owner, governor, definition, service, run, approval };
}

it.each(["discord.addRole", "discord.removeRole"] as const)(
  "exposes and persists a reviewed live policy for %s",
  async (operation) => {
    const hook = vi.fn<NonNullable<AutomationServiceOptions["approvalPolicy"]>>(
        async () => ({ fingerprint: "a".repeat(64), changedChannelCount: 2 }),
      ),
      f = await fixture(hook, operation);
    expect((await f.service.approvals(f.s, f.governor)).items).toMatchObject([
      {
        id: f.approval.id,
        policyFingerprint: "a".repeat(64),
        changedChannelCount: 2,
      },
    ]);
    const input = {
      decision: "APPROVE" as const,
      fingerprint: f.approval.fingerprint,
      policyFingerprint: "a".repeat(64),
      requestId: randomUUID(),
    };
    expect(
      await f.service.decideApproval(f.s, f.governor, f.approval.id, input),
    ).toEqual({ id: f.approval.id, state: "APPROVED" });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[1]![0]).not.toBe(db);
    expect(hook.mock.calls[1]![2].id).toBe(f.run.id);
    expect(hook.mock.calls[1]![4].key).toBe(f.governor.key);
    expect(
      (
        await sql`SELECT state,policy_fingerprint,approver_hash FROM automation_approvals WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows,
    ).toEqual([
      {
        state: "APPROVED",
        policy_fingerprint: "a".repeat(64),
        approver_hash: f.governor.key,
      },
    ]);
    expect((await f.service.store.run(f.s, f.run.id))?.status).toBe("QUEUED");
    expect(
      await f.service.decideApproval(f.s, f.governor, f.approval.id, input),
    ).toEqual({ id: f.approval.id, state: "APPROVED" });
    expect(hook).toHaveBeenCalledTimes(2);
  },
);

it("fails closed without a policy connector while keeping rejection possible", async () => {
  const f = await fixture();
  expect((await f.service.approvals(f.s, f.governor)).items).toMatchObject([
    { policyUnavailableReason: "AUTOMATION_ROLE_POLICY_UNAVAILABLE" },
  ]);
  await expect(
    f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      policyFingerprint: "a".repeat(64),
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("AUTOMATION_ROLE_POLICY_UNAVAILABLE");
  expect(
    await f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "REJECT",
      fingerprint: f.approval.fingerprint,
      requestId: randomUUID(),
    }),
  ).toEqual({ id: f.approval.id, state: "REJECTED" });
  expect(
    (
      await sql`SELECT policy_fingerprint FROM automation_approvals WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ policy_fingerprint: null }]);
});

it("requires the policy echo and leaves a changed native meaning pending", async () => {
  const hook = vi.fn<NonNullable<AutomationServiceOptions["approvalPolicy"]>>(
      async () => ({ fingerprint: "a".repeat(64), changedChannelCount: 1 }),
    ),
    f = await fixture(hook);
  await f.service.approvals(f.s, f.governor);
  await expect(
    f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("AUTOMATION_APPROVAL_POLICY_REQUIRED");
  hook.mockResolvedValue({
    fingerprint: "b".repeat(64),
    changedChannelCount: 2,
  });
  await expect(
    f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      policyFingerprint: "a".repeat(64),
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("AUTOMATION_APPROVAL_POLICY_CHANGED");
  expect(
    (
      await sql`SELECT state,policy_fingerprint FROM automation_approvals WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ state: "PENDING", policy_fingerprint: null }]);
});

it("keeps independent approvals visible and never exposes a connector exception message", async () => {
  const f = await fixture(async (_tx, _s, _run, approval) => {
    if (approval.identity === "fixed-role")
      throw new Error("never expose this private transport value");
    return { fingerprint: "a".repeat(64), changedChannelCount: 0 };
  });
  await f.service.store.requireApproval(
    f.s,
    f.run,
    "other-role",
    "discord.removeRole",
    f.approval.inputs,
  );
  const result = await f.service.approvals(f.s, f.governor);
  expect(result.items).toHaveLength(2);
  expect(result.items.find((item) => item.id === f.approval.id)).toMatchObject({
    policyUnavailableReason: "AUTOMATION_ROLE_POLICY_UNAVAILABLE",
  });
  expect(result.items.find((item) => item.id !== f.approval.id)).toMatchObject({
    policyFingerprint: "a".repeat(64),
    changedChannelCount: 0,
  });
  expect(JSON.stringify(result)).not.toContain("private transport value");
});

it("rejects malformed connector proofs and does not save a permissive receipt", async () => {
  const f = await fixture(async () => ({
    fingerprint: "not-a-digest",
    changedChannelCount: -1,
  }));
  await expect(
    f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      policyFingerprint: "a".repeat(64),
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("AUTOMATION_ROLE_POLICY_UNAVAILABLE");
  expect(
    (await f.service.store.approval(f.s, f.run.id, "fixed-role"))?.state,
  ).toBe("PENDING");
});

it("rechecks expiry after the remote policy read and rolls back the approval", async () => {
  const f = await fixture(async (tx, s, run) => {
    await sql`UPDATE automation_runs SET deadline_at=now()-interval '1 second',started_at=now()-interval '1 day' WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(
      tx,
    );
    return { fingerprint: "a".repeat(64), changedChannelCount: 0 };
  });
  await expect(
    f.service.decideApproval(f.s, f.governor, f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      policyFingerprint: "a".repeat(64),
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("AUTOMATION_STOPPED");
  expect(
    (await f.service.store.approval(f.s, f.run.id, "fixed-role"))?.state,
  ).toBe("PENDING");
});

async function apiFixture() {
  const f = await fixture(),
    discord = Object.assign(new FakeDiscord(), {
      automationRolePreflight: vi.fn(
        async (_input: AutomationRolePolicyInput) => ({
          fingerprint: "a".repeat(64),
          changedChannelCount: 1,
        }),
      ),
    });
  for (const id of [requester, approver])
    discord.members.set(id, {
      roles: [],
      permissions: "268435488",
      bot: false,
      joinedAt: "2026-01-01T00:00:00Z",
    });
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},now(),now(),${randomUUID()}::uuid)`.execute(
    db,
  );
  const session = await new PublicSessions(db, secret, async () => {
      throw new Error("unexpected refresh");
    }).create(approver, { accessToken: "synthetic" }, 3600),
    app = Fastify();
  app.setErrorHandler((error, _req, reply) =>
    reply
      .code(isDomainError(error) ? error.status : 400)
      .send({ error: isDomainError(error) ? error.code : "VALIDATION" }),
  );
  registerAlpha15Automation(app, db, key, discord, vault);
  const base = `/v3/organizations/${f.s.organizationId}/guilds/${f.s.guildId}/automation`;
  const call = (method: "GET" | "POST", suffix: string, body?: unknown) => {
    const path = base + suffix;
    return app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${apiToken(key, f.s)}`,
        "x-nexus-user-proof": createPublicApiProof({
          scope: f.s,
          userId: approver,
          sessionReference: session,
          method,
          path,
          body,
          ...(method === "POST" ? { origin: "https://nexus.example" } : {}),
        }),
        ...(method === "POST"
          ? {
              origin: "https://nexus.example",
              "content-type": "application/json",
            }
          : {}),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  };
  return { ...f, discord, app, call };
}

it("wires the API to live requester and approver checks and requires the exact preview echo", async () => {
  const f = await apiFixture();
  try {
    const result = await f.call("GET", "/approvals");
    expect(result.statusCode, result.body).toBe(200);
    const item = result.json().items[0] as {
      policyFingerprint: string;
      changedChannelCount: number;
    };
    expect(item.changedChannelCount).toBe(1);
    expect(item.policyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const input = {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      requestId: randomUUID(),
    };
    expect(
      (await f.call("POST", "/approvals/" + f.approval.id, input)).statusCode,
    ).toBe(409);
    expect(
      (
        await f.call("POST", "/approvals/" + f.approval.id, {
          ...input,
          policyFingerprint: item.policyFingerprint,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.discord.automationRolePreflight).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requesterId: requester,
        approverId: approver,
        roleId: role,
        memberId: member,
      }),
    );
    expect(
      (await f.service.store.approval(f.s, f.run.id, "fixed-role"))
        ?.policy_fingerprint,
    ).toBe(item.policyFingerprint);
    expect(fingerprint(f.approval.inputs)).toBe(f.approval.fingerprint);
  } finally {
    await f.app.close();
  }
});

it("refuses a current requester revocation without hiding the pending item", async () => {
  const f = await apiFixture();
  try {
    const first = await f.call("GET", "/approvals");
    expect(first.statusCode, first.body).toBe(200);
    const hash = first.json().items[0].policyFingerprint;
    f.discord.members.get(requester)!.permissions = "0";
    const unavailable = await f.call("GET", "/approvals");
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().items[0]).toMatchObject({
      policyUnavailableReason: "ADMIN_REQUIRED",
    });
    const decision = await f.call("POST", "/approvals/" + f.approval.id, {
      decision: "APPROVE",
      fingerprint: f.approval.fingerprint,
      policyFingerprint: hash,
      requestId: randomUUID(),
    });
    expect(decision.statusCode).toBe(403);
    expect(
      (await f.service.store.approval(f.s, f.run.id, "fixed-role"))?.state,
    ).toBe("PENDING");
  } finally {
    await f.app.close();
  }
});
