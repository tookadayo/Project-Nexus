import { randomUUID } from "node:crypto";
import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import { errorReference, logFailure } from "../../../shared/src/diagnostics";
import type { IdentityVault } from "../../../identity/src/index";
import { EntitlementService } from "./entitlements";
import { billingViewModel } from "./view";
import {
  planRegistry,
  planRank,
  type Plan,
  type EntitlementFeature,
} from "../plan-registry";
import { planChangePreview, type BillingProviderKind } from "./domain";
import {
  normalizedBillingEventSchema,
  type BillingProvider,
  type NormalizedBillingEvent,
  type ProviderSignal,
} from "./providers/types";
type StoredEvent = Omit<
  NormalizedBillingEvent,
  "eventId" | "subscriptionRef"
> & {
  eventDigest: string;
  referenceDigest: string;
  referenceCiphertext: string;
};
export async function billingAudit(
  tx: Tx,
  scope: Scope | null,
  actor: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  // Callers pass allowlisted categories/counts/internal UUIDs, never payment identifiers or codes.
  await sql`INSERT INTO billing_audit_log(id,organization_id,guild_id,actor_hash,action,metadata) VALUES(${randomUUID()}::uuid,${scope?.organizationId ?? null}::uuid,${scope?.guildId ?? null},${actor},${action},${json(metadata)})`.execute(
    tx,
  );
}
export async function billingScopeLock(tx: Tx, scope: Scope) {
  await privacyReadLock(tx, scope);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing:" + scope.organizationId + ":" + scope.guildId},0))`.execute(
    tx,
  );
  assert(
    !(
      await sql`SELECT id FROM deletion_requests WHERE ${tenant(scope)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
        tx,
      )
    ).rows.length,
    "PRIVACY_DELETED",
    403,
  );
}
export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async receive(
    provider: BillingProvider,
    body: Buffer,
    headers: Record<string, string>,
  ) {
    assert(body.length <= 65536, "BILLING_EVENT_TOO_LARGE", 413);
    // Only the provider adapter's verified parser may cross the HTTP inbox boundary.
    if (provider.ordering === "RECONCILE_LATEST") {
      const signals = await provider.verifyWebhook(body, headers);
      for (const signal of signals) {
        assert(signal.provider === provider.kind, "BILLING_PROVIDER_MISMATCH");
        await this.storeSignal(signal);
      }
      return { accepted: signals.length };
    }
    const events = await provider.parseEvent(body, headers);
    for (const event of events) {
      assert(event.provider === provider.kind, "BILLING_PROVIDER_MISMATCH");
      await this.storeVerified(event);
    }
    return { accepted: events.length };
  }
  async storeVerified(input: NormalizedBillingEvent) {
    assert(
      input.provider !== "STRIPE" && input.provider !== "EXTERNAL_LEGACY",
      "BILLING_SNAPSHOT_RECONCILIATION_REQUIRED",
      403,
    );
    return this.persistSnapshot(input);
  }
  private async persistSnapshot(
    input: NormalizedBillingEvent,
    transaction?: Tx,
  ) {
    const event = normalizedBillingEventSchema.parse(input);
    assert(event.authoritative, "BILLING_EVENT_UNVERIFIED", 403);
    assert(
      new Date(event.occurredAt).getTime() <= Date.now() + 300000,
      "BILLING_EVENT_CLOCK_INVALID",
    );
    const { eventId, subscriptionRef, ...safe } = event;
    const stored: StoredEvent = {
      ...safe,
      eventDigest: this.vault.digest(
        "billing-event:" + event.provider,
        eventId,
      ),
      referenceDigest: this.vault.digest(
        "billing-reference:" + event.provider,
        subscriptionRef,
      ),
      referenceCiphertext: this.vault.seal(event.scope, subscriptionRef),
    };
    const persist = async (tx: Tx) => {
      await billingScopeLock(tx, event.scope);
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO billing_provider_events(id,provider,event_digest,organization_id,guild_id,normalized,verified_at) VALUES(${randomUUID()}::uuid,${event.provider},${stored.eventDigest},${event.scope.organizationId}::uuid,${event.scope.guildId},${json(stored)},now()) ON CONFLICT(provider,event_digest) DO NOTHING RETURNING id`.execute(
          tx,
        )
      ).rows[0];
      return { duplicate: !row, id: row?.id ?? null };
    };
    return transaction
      ? persist(transaction)
      : this.db.transaction().execute(persist);
  }
  async storeSignal(signal: ProviderSignal) {
    assert(signal.provider === "STRIPE", "BILLING_PROVIDER_MISMATCH");
    assert(
      signal.eventId.length > 0 &&
        signal.eventId.length <= 200 &&
        signal.subscriptionRef.length > 0 &&
        signal.subscriptionRef.length <= 200,
      "BILLING_SIGNAL_INVALID",
    );
    return this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, signal.scope);
      const digest = this.vault.digest("billing-signal:STRIPE", signal.eventId);
      const result =
        await sql`INSERT INTO billing_provider_signals(id,provider,event_digest,organization_id,guild_id,reference_ciphertext) VALUES(${randomUUID()}::uuid,'STRIPE',${digest},${signal.scope.organizationId}::uuid,${signal.scope.guildId},${this.vault.seal(signal.scope, signal.subscriptionRef)}) ON CONFLICT(provider,event_digest) DO NOTHING RETURNING id`.execute(
          tx,
        );
      return { duplicate: result.rows.length === 0 };
    });
  }
  async reconcileLatest(
    s: Scope,
    provider: BillingProvider,
    subscriptionRef?: string,
  ) {
    assert(
      provider.kind === "STRIPE" && provider.ordering === "RECONCILE_LATEST",
      "BILLING_ORDERING_INVALID",
    );
    const token = randomUUID();
    const claim = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`INSERT INTO billing_snapshot_sequences(organization_id,provider) VALUES(${s.organizationId}::uuid,'STRIPE') ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      return (
        await sql<{
          revision: string;
        }>`UPDATE billing_snapshot_sequences SET revision=revision+1,lease_token=${token}::uuid,lease_until=now()+interval '2 minutes' WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND (lease_until IS NULL OR lease_until<now()) RETURNING revision`.execute(
          tx,
        )
      ).rows[0];
    });
    if (!claim) return false;
    try {
      // Network retrieval takes place outside all PostgreSQL transactions.
      const snapshots = await provider.reconcile(s, { subscriptionRef });
      assert(
        !subscriptionRef || snapshots.length > 0,
        "BILLING_RECONCILIATION_EMPTY",
      );
      return await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        const valid =
          await sql`SELECT revision FROM billing_snapshot_sequences WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND lease_token=${token}::uuid AND lease_until>now() FOR UPDATE`.execute(
            tx,
          );
        assert(valid.rows.length, "BILLING_RECONCILIATION_LEASE_EXPIRED", 409);
        for (const snapshot of snapshots) {
          assert(
            snapshot.provider === "STRIPE" &&
              snapshot.scope.organizationId === s.organizationId &&
              snapshot.scope.guildId === s.guildId &&
              (!subscriptionRef ||
                snapshot.subscriptionRef === subscriptionRef),
            "BILLING_PROVIDER_MISMATCH",
          );
          await this.persistSnapshot(
            {
              ...snapshot,
              eventId: "snapshot:" + token + ":" + snapshot.subscriptionRef,
              ordering: "RECONCILE_LATEST",
              version: Number(claim.revision),
              occurredAt: new Date().toISOString(),
            },
            tx,
          );
        }
        return true;
      });
    } finally {
      await sql`UPDATE billing_snapshot_sequences SET lease_token=NULL,lease_until=NULL WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    }
  }
  async processSignal(provider: BillingProvider) {
    const token = randomUUID();
    const row = (
      await sql<{
        id: string;
        organization_id: string;
        guild_id: string;
        reference_ciphertext: string;
      }>`UPDATE billing_provider_signals SET lease_token=${token}::uuid,lease_until=now()+interval '3 minutes' WHERE id=(SELECT id FROM billing_provider_signals WHERE provider=${provider.kind} AND projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.execute(
        this.db,
      )
    ).rows[0];
    if (!row) return false;
    const scope = {
      organizationId: row.organization_id,
      guildId: row.guild_id,
    };
    try {
      const completed = await this.reconcileLatest(
        scope,
        provider,
        this.vault.open(scope, row.reference_ciphertext),
      );
      assert(completed, "BILLING_RECONCILIATION_BUSY", 409);
      await sql`UPDATE billing_provider_signals SET projected_at=now(),error_category=NULL,lease_token=NULL,lease_until=NULL WHERE id=${row.id}::uuid AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    } catch {
      await sql`UPDATE billing_provider_signals SET attempts=attempts+1,error_category='BILLING_RECONCILIATION_FAILED',available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7))::integer)),dead_lettered_at=CASE WHEN attempts>=7 THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL WHERE id=${row.id}::uuid AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    }
    return true;
  }
  async projectOne() {
    const candidate = (
      await sql<{
        id: string;
        normalized: StoredEvent;
      }>`SELECT id,normalized FROM billing_provider_events WHERE projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() ORDER BY received_at,id LIMIT 1`.execute(
        this.db,
      )
    ).rows[0];
    if (!candidate) return false;
    try {
      return await this.db.transaction().execute(async (tx) => {
        // Privacy deletion takes the exclusive fence before touching inbox rows.
        // Match that order so a projector cannot deadlock with deletion.
        await billingScopeLock(tx, candidate.normalized.scope);
        const row = (
          await sql<{
            id: string;
            normalized: StoredEvent;
          }>`SELECT id,normalized FROM billing_provider_events WHERE id=${candidate.id}::uuid AND projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() FOR UPDATE SKIP LOCKED`.execute(
            tx,
          )
        ).rows[0];
        if (!row) return false;
        const event = row.normalized,
          s = event.scope;
        // Account lock serializes assignments across guilds/instances.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing-account:" + s.organizationId},0))`.execute(
          tx,
        );
        await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid) ON CONFLICT(organization_id) DO NOTHING`.execute(
          tx,
        );
        const account = (
          await sql<{
            id: string;
            provider_grace_hours: number;
            trial_allowed: boolean;
          }>`SELECT id,provider_grace_hours,trial_allowed FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid AND deleted_at IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(account, "BILLING_ACCOUNT_UNAVAILABLE");
        const before = await new EntitlementService(tx).effective(s);
        const existing = (
          await sql<{
            id: string;
            organization_id: string;
            plan_key: Plan;
            status: string;
            current_period_end: Date | null;
            scheduled_plan: Plan | null;
            scheduled_at: Date | null;
            provider_event_at: Date;
            provider_event_version: string;
            provider_event_key: string;
          }>`SELECT * FROM billing_subscriptions WHERE provider=${event.provider} AND reference_digest=${event.referenceDigest} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(
          !existing || existing.organization_id === s.organizationId,
          "BILLING_SCOPE_CONFLICT",
          409,
        );
        const older =
          existing &&
          (event.version < Number(existing.provider_event_version) ||
            (event.version === Number(existing.provider_event_version) &&
              new Date(event.occurredAt) <= existing.provider_event_at));
        const sameOrder =
          existing &&
          event.version === Number(existing.provider_event_version) &&
          new Date(event.occurredAt).getTime() ===
            existing.provider_event_at.getTime();
        const contradictory =
          sameOrder &&
          existing.provider_event_key !== event.eventDigest &&
          (existing.plan_key !== event.plan ||
            existing.status !== event.status ||
            (existing.current_period_end?.toISOString() !== event.periodEnd &&
              !(
                existing.current_period_end === null && event.periodEnd === null
              )) ||
            existing.scheduled_plan !== event.scheduledPlan ||
            (existing.scheduled_at?.toISOString() !== event.scheduledAt &&
              !(existing.scheduled_at === null && event.scheduledAt === null)));
        if (contradictory) {
          const confirmed =
            ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(
              event.status,
            ) &&
            (event.status !== "TRIALING" || account.trial_allowed);
          const goodUntil = confirmed
            ? new Date(
                Math.max(
                  new Date(event.occurredAt).getTime(),
                  event.periodEnd ? new Date(event.periodEnd).getTime() : 0,
                ) +
                  account.provider_grace_hours * 3600000,
              )
            : null;
          await sql`UPDATE billing_subscriptions SET status='CONFLICT',last_good_plan=CASE WHEN ${confirmed} AND (last_good_plan IS NULL OR array_position(ARRAY['FREE','STARTER','GROWTH','SCALE','ENTERPRISE'],last_good_plan)<array_position(ARRAY['FREE','STARTER','GROWTH','SCALE','ENTERPRISE'],${event.plan}::text)) THEN ${event.plan} ELSE last_good_plan END,last_good_until=GREATEST(last_good_until,${goodUntil}::timestamptz),confirmed_at=COALESCE(confirmed_at,${confirmed ? event.occurredAt : null}::timestamptz),provider_event_key=LEAST(provider_event_key,${event.eventDigest}) WHERE id=${existing.id}::uuid`.execute(
            tx,
          );
          await billingAudit(tx, s, null, "billing.provider_order_conflict", {
            provider: event.provider,
          });
        } else if (!older) {
          const confirmed =
            ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(
              event.status,
            ) &&
            (event.status !== "TRIALING" || account.trial_allowed);
          const goodUntil = confirmed
            ? new Date(
                Math.max(
                  new Date(event.occurredAt).getTime(),
                  event.periodEnd ? new Date(event.periodEnd).getTime() : 0,
                ) +
                  account.provider_grace_hours * 3600000,
              )
            : null;
          const id = existing?.id ?? randomUUID();
          await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,status,current_period_end,scheduled_plan,scheduled_at,confirmed_at,last_good_plan,last_good_until,provider_event_at,provider_event_version,provider_event_key)
    VALUES(${id}::uuid,${account.id}::uuid,${s.organizationId}::uuid,${event.provider},${event.referenceDigest},${event.referenceCiphertext},${event.plan},${event.status},${event.periodEnd}::timestamptz,${event.scheduledPlan},${event.scheduledAt}::timestamptz,${confirmed || (event.provider === "STRIPE" && event.status === "CANCELED" && event.periodEnd && new Date(event.periodEnd) > new Date()) ? event.occurredAt : null}::timestamptz,${confirmed ? event.plan : null},${goodUntil},${event.occurredAt}::timestamptz,${event.version},${event.eventDigest})
    ON CONFLICT(provider,reference_digest) DO UPDATE SET plan_key=CASE WHEN ${confirmed || event.status === "CANCELED"} THEN EXCLUDED.plan_key ELSE billing_subscriptions.plan_key END,status=EXCLUDED.status,current_period_end=EXCLUDED.current_period_end,scheduled_plan=EXCLUDED.scheduled_plan,scheduled_at=EXCLUDED.scheduled_at,confirmed_at=COALESCE(EXCLUDED.confirmed_at,billing_subscriptions.confirmed_at),last_good_plan=COALESCE(EXCLUDED.last_good_plan,billing_subscriptions.last_good_plan),last_good_until=COALESCE(EXCLUDED.last_good_until,billing_subscriptions.last_good_until),provider_event_at=EXCLUDED.provider_event_at,provider_event_version=EXCLUDED.provider_event_version,provider_event_key=EXCLUDED.provider_event_key`.execute(
            tx,
          );
          await sql`INSERT INTO billing_subscription_assignments(organization_id,guild_id,subscription_id) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
          const action = !existing
            ? "subscription.created"
            : event.scheduledPlan
              ? "downgrade.scheduled"
              : event.status === "CANCELED" ||
                  event.status === "CANCEL_AT_PERIOD_END"
                ? "subscription.cancel"
                : confirmed &&
                    planRank(event.plan) > planRank(existing.plan_key)
                  ? "subscription.upgrade"
                  : "payment.state_changed";
          await billingAudit(tx, s, null, action, {
            provider: event.provider,
            plan: event.plan,
            status: event.status,
          });
        }
        await this.refreshState(s, tx, before.plan);
        await sql`UPDATE billing_provider_events SET projected_at=now(),error_category=NULL WHERE id=${row.id}::uuid`.execute(
          tx,
        );
        await billingAudit(tx, s, null, "provider.sync", {
          provider: event.provider,
          ignoredOlder: Boolean(older),
        });
        return true;
      });
    } catch {
      // Persist retry scheduling outside the rolled-back projection transaction.
      // Poison events must not monopolize the queue after a worker restart.
      const reference = errorReference();
      await sql`UPDATE billing_provider_events SET attempts=attempts+1,dead_lettered_at=CASE WHEN attempts>=7 THEN now() ELSE NULL END,available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7))::integer)),error_category=${"BILLING_PROJECTION_FAILED:" + reference} WHERE id=${candidate.id}::uuid AND projected_at IS NULL`.execute(
        this.db,
      );
      logFailure({
        reference,
        action: "billing.project",
        stage: "provider_projection",
        error: new Error("BILLING_PROJECTION_FAILED"),
      });
      return true;
    }
  }
  async refreshState(
    s: Scope,
    tx: Tx = this.db,
    previousPlan?: Plan,
    now = new Date(),
  ) {
    const state = await new EntitlementService(tx).effective(s, now);
    const saved = (
      await sql<{
        effective_plan: Plan;
        conflict: boolean;
      }>`SELECT effective_plan,conflict FROM billing_guild_state WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0];
    const old = previousPlan ?? saved?.effective_plan ?? state.plan,
      downgrade = planRank(old) > planRank(state.plan);
    const recovery =
      (
        await sql<{
          downgrade_recovery_days: number;
        }>`SELECT downgrade_recovery_days FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid`.execute(
          tx,
        )
      ).rows[0]?.downgrade_recovery_days ?? 30;
    await sql`INSERT INTO billing_guild_state(organization_id,guild_id,effective_plan,conflict,recovery_until,recovery_history_days) VALUES(${s.organizationId}::uuid,${s.guildId},${state.plan},${state.conflict},${downgrade ? new Date(now.getTime() + recovery * 86400000) : null},${downgrade ? planRegistry[old].limits.historyDays : null}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET effective_plan=EXCLUDED.effective_plan,conflict=EXCLUDED.conflict,recovery_until=CASE WHEN ${downgrade} THEN EXCLUDED.recovery_until ELSE billing_guild_state.recovery_until END,recovery_history_days=CASE WHEN ${downgrade} THEN EXCLUDED.recovery_history_days ELSE billing_guild_state.recovery_history_days END,updated_at=${now}`.execute(
      tx,
    );
    if (state.conflict && !saved?.conflict)
      await billingAudit(tx, s, null, "billing.conflict", {
        providers: state.subscriptions.map((row) => row.provider),
      });
    const config = (
      await sql<{
        settings: { helperEnabled?: boolean; weeklySummaryEnabled?: boolean };
      }>`SELECT settings FROM guild_settings WHERE ${tenant(s)}`.execute(tx)
    ).rows[0]?.settings;
    const rules: (readonly [string, EntitlementFeature, boolean])[] = [
      ["helper", "attention_automation", config?.helperEnabled ?? false],
      [
        "weekly-digest",
        "scheduled_digest",
        config?.weeklySummaryEnabled ?? false,
      ],
    ];
    for (const [key, feature, configured] of rules) {
      if (configured)
        await sql`INSERT INTO billing_rule_states(organization_id,guild_id,rule_key,feature,state) VALUES(${s.organizationId}::uuid,${s.guildId},${key},${feature},${state.features.includes(feature) ? "ACTIVE" : "PAUSED_PLAN_LIMIT"}) ON CONFLICT(organization_id,guild_id,rule_key) DO UPDATE SET state=EXCLUDED.state,updated_at=${now}`.execute(
          tx,
        );
      else
        await sql`DELETE FROM billing_rule_states WHERE ${tenant(s)} AND rule_key=${key}`.execute(
          tx,
        );
    }
    await sql`DELETE FROM billing_rule_states WHERE ${tenant(s)} AND rule_key NOT IN ('helper','weekly-digest') AND rule_key NOT IN (SELECT revision_id::text FROM guild_config_heads WHERE ${tenant(s)} AND domain='intervention')`.execute(
      tx,
    );
    await sql`INSERT INTO billing_rule_states(organization_id,guild_id,rule_key,feature,state) SELECT r.organization_id,r.guild_id,r.id::text,'attention_automation',${state.features.includes("attention_automation") ? "ACTIVE" : "PAUSED_PLAN_LIMIT"} FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND h.domain='intervention' AND r.definition->>'safetyMode'='auto' ON CONFLICT(organization_id,guild_id,rule_key) DO UPDATE SET state=EXCLUDED.state,updated_at=${now}`.execute(
      tx,
    );
    return state;
  }
  async preview(s: Scope, target: Plan, provider: BillingProviderKind) {
    const state = await new EntitlementService(this.db).effective(s),
      automationRules = (
        await sql<{
          rule_key: string;
          feature: "attention_automation" | "scheduled_digest";
        }>`SELECT rule_key,feature FROM billing_rule_states WHERE ${tenant(s)} AND feature IN ('attention_automation','scheduled_digest') AND state='ACTIVE'`.execute(
          this.db,
        )
      ).rows.map((row) => ({ id: row.rule_key, feature: row.feature }));
    const assignedGuilds =
      (
        await sql<{
          count: number;
        }>`SELECT count(DISTINCT guild_id)::integer AS count FROM billing_subscription_assignments WHERE organization_id=${s.organizationId}::uuid`.execute(
          this.db,
        )
      ).rows[0]?.count ?? 1;
    const recoveryDays =
      (
        await sql<{
          downgrade_recovery_days: number;
        }>`SELECT downgrade_recovery_days FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid`.execute(
          this.db,
        )
      ).rows[0]?.downgrade_recovery_days ?? 30;
    return planChangePreview(state, target, provider, {
      periodEnd: state.subscriptions.find((row) => row.provider === provider)
        ?.periodEnd,
      automationRules,
      assignedGuilds: Math.max(1, assignedGuilds),
      recoveryDays,
    });
  }
  async status(s: Scope) {
    const state = await new EntitlementService(this.db).effective(s);
    const recovery = (
      await sql<{
        recovery_until: Date | null;
      }>`SELECT recovery_until FROM billing_guild_state WHERE ${tenant(s)}`.execute(
        this.db,
      )
    ).rows[0];
    const pausedRules = (
      await sql<{
        rule_key: string;
        state: string;
      }>`SELECT rule_key,state FROM billing_rule_states WHERE ${tenant(s)} AND state='PAUSED_PLAN_LIMIT'`.execute(
        this.db,
      )
    ).rows;
    return {
      ...state,
      usage: await new EntitlementService(this.db).usage(s),
      recoveryUntil: recovery?.recovery_until?.toISOString() ?? null,
      pausedRules,
    };
  }
  async view(s: Scope) {
    return billingViewModel(await this.status(s));
  }
  async reconcile(s: Scope, provider: BillingProvider) {
    if (provider.kind === "STRIPE") return this.reconcileLatest(s, provider);
    const events = await provider.reconcile(s);
    for (const event of events) await this.storeVerified(event);
    // Empty authoritative Discord census ends only previously normalized Discord entitlements.
    if (provider.kind === "DISCORD") {
      const existing = (
        await sql<{
          reference_ciphertext: string;
          plan_key: Plan;
        }>`SELECT b.reference_ciphertext,b.plan_key FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider='DISCORD' AND b.status<>'CANCELED'`.execute(
          this.db,
        )
      ).rows;
      for (const row of existing) {
        const ref = this.vault.open(s, row.reference_ciphertext);
        if (!events.some((event) => event.subscriptionRef === ref)) {
          const now = new Date();
          await this.storeVerified({
            eventId: `absent:${ref}:${now.toISOString()}`,
            subscriptionRef: ref,
            provider: "DISCORD",
            scope: s,
            plan: row.plan_key,
            status: "CANCELED",
            occurredAt: now.toISOString(),
            version: now.getTime(),
            periodEnd: now.toISOString(),
            scheduledPlan: null,
            scheduledAt: null,
            authoritative: true,
          });
        }
      }
    }
  }
  async markProviderUnavailable(s: Scope, provider: BillingProviderKind) {
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`UPDATE billing_subscriptions b SET status='UNKNOWN' FROM billing_subscription_assignments a WHERE a.subscription_id=b.id AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider=${provider} AND b.status IN ('ACTIVE','TRIALING','PAST_DUE','GRACE')`.execute(
        tx,
      );
      await billingAudit(tx, s, null, "provider.unavailable", { provider });
      await this.refreshState(s, tx);
    });
  }
}
