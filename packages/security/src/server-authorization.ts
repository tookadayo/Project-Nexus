import type { DiscordPort, Member } from "../../discord/src/rest";
import { sql, type Tx } from "../../db/src/index";
import type { IdentityVault } from "../../identity/src/index";
import {
  SettingsService,
  type Actor,
  type SettingsView,
} from "../../settings/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { canOperatePanel } from "./index";

export type GuildAuthorizationSnapshot = {
  scope: Scope;
  userId: string;
  member: Member;
  settings: SettingsView;
  actor: Actor;
  checkedAt: number;
};
// A snapshot belongs to one request. It is never cached across requests.
export class ServerAuthorization {
  constructor(
    private readonly discord: DiscordPort,
    private readonly settings: SettingsService,
    private readonly vault: IdentityVault,
  ) {}
  async snapshot(
    s: Scope,
    userId: string,
    source: Actor["source"],
    requestId: string,
  ): Promise<GuildAuthorizationSnapshot> {
    assert(/^\d{17,20}$/.test(userId), "ADMIN_REQUIRED", 403);
    let checkedAt = 0;
    const [member, current] = await Promise.all([
      this.discord.member(s.guildId, userId).then((member) => {
        checkedAt = Date.now();
        return member;
      }),
      this.settings.get(s),
    ]);
    const actor: Actor = {
      key: this.vault.hash(s, userId),
      encryptedUserId: this.vault.seal(s, userId),
      permissions: member.permissions,
      roles: member.roles,
      source,
      requestId,
      organizationMemberDigest: (root) =>
        this.vault.digest("operations-staff", root + ":" + userId),
    };
    return { scope: s, userId, member, settings: current, actor, checkedAt };
  }
  require(snapshot: GuildAuthorizationSnapshot) {
    assert(
      Date.now() - snapshot.checkedAt >= 0 &&
        Date.now() - snapshot.checkedAt <= 10000,
      "AUTHORIZATION_EXPIRED",
      403,
    );
    assert(
      canOperatePanel(snapshot.member.permissions, snapshot.member.roles, [
        snapshot.settings.adminRoleId,
        ...snapshot.settings.managerRoleIds,
      ]),
      "ADMIN_REQUIRED",
      403,
    );
    return snapshot.actor;
  }
  requireOwner(snapshot: GuildAuthorizationSnapshot) {
    assert(
      Date.now() - snapshot.checkedAt >= 0 &&
        Date.now() - snapshot.checkedAt <= 10000,
      "AUTHORIZATION_EXPIRED",
      403,
    );
    assert(
      !snapshot.member.bot && snapshot.member.ownerId === snapshot.userId,
      "BILLING_OWNER_REQUIRED",
      403,
    );
    return snapshot.actor;
  }
  async revalidateOwner(
    s: Scope,
    userId: string,
    snapshot: GuildAuthorizationSnapshot,
    tx: Tx,
  ) {
    assert(
      snapshot.scope.organizationId === s.organizationId &&
        snapshot.scope.guildId === s.guildId &&
        snapshot.userId === userId,
      "BILLING_OWNER_REQUIRED",
      403,
    );
    // A fresh Bot API guild/member retrieval inside the mutation transaction also
    // proves installation and catches ownership transfers after OAuth selection.
    const current = await this.snapshot(
      s,
      userId,
      snapshot.actor.source,
      snapshot.actor.requestId,
    );
    this.requireOwner(current);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId + ":" + s.guildId},0))`.execute(
      tx,
    );
    assert(
      (await this.settings.get(s, tx)).revision === current.settings.revision,
      "REVISION_CONFLICT",
      409,
    );
    this.requireOwner(current);
    return current.actor;
  }
  async actor(
    s: Scope,
    userId: string,
    source: Actor["source"],
    requestId: string,
  ): Promise<Actor> {
    return this.require(await this.snapshot(s, userId, source, requestId));
  }
  async revalidate(
    s: Scope,
    userId: string,
    snapshot: GuildAuthorizationSnapshot,
    tx: Tx,
  ) {
    assert(
      snapshot.scope.organizationId === s.organizationId &&
        snapshot.scope.guildId === s.guildId &&
        snapshot.userId === userId,
      "ADMIN_REQUIRED",
      403,
    );
    this.require(snapshot);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId + ":" + s.guildId},0))`.execute(
      tx,
    );
    const current = await this.settings.get(s, tx);
    assert(
      current.revision === snapshot.settings.revision,
      "REVISION_CONFLICT",
      409,
    );
    assert(
      canOperatePanel(snapshot.member.permissions, snapshot.member.roles, [
        current.adminRoleId,
        ...current.managerRoleIds,
      ]),
      "ADMIN_REQUIRED",
      403,
    );
    this.require(snapshot);
    return snapshot.actor;
  }
}
