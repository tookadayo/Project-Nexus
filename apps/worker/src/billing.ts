import { randomUUID } from "node:crypto";
import { sql, tenant, type Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { IdentityVault } from "../../../packages/identity/src/index";
import type { DiscordPort } from "../../../packages/discord/src/rest";
import {
  BillingService,
  billingScopeLock,
} from "../../../packages/settings/src/billing";
import {
  DiscordBillingProvider,
  discordBillingConfiguration,
  nativeBillingCapability,
} from "../../../packages/settings/src/billing-provider";
export class BillingWorker {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly discord: DiscordPort,
  ) {}
  async project() {
    for (let i = 0; i < 20; i++) {
      if (!(await new BillingService(this.db, this.vault).projectOne())) break;
    }
  }
  async tick(s: Scope) {
    const billing = new BillingService(this.db, this.vault);
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await billing.refreshState(s, tx);
    });
    const config = discordBillingConfiguration();
    if (nativeBillingCapability(config) !== "AVAILABLE") return;
    const lease = randomUUID();
    const claimed = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`INSERT INTO billing_reconcile_jobs(organization_id,guild_id,provider) VALUES(${s.organizationId}::uuid,${s.guildId},'DISCORD') ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      return (
        (
          await sql`UPDATE billing_reconcile_jobs SET lease_token=${lease}::uuid,lease_until=now()+interval '2 minutes' WHERE ${tenant(s)} AND provider='DISCORD' AND due_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING guild_id`.execute(
            tx,
          )
        ).rows.length > 0
      );
    });
    if (!claimed) return;
    let failed = false;
    try {
      await billing.reconcile(
        s,
        new DiscordBillingProvider(this.discord, config),
      );
    } catch {
      failed = true;
      await billing.markProviderUnavailable(s, "DISCORD");
    }
    await sql`UPDATE billing_reconcile_jobs SET due_at=now()+make_interval(secs=>${failed ? 300 : 3600}),lease_until=NULL,lease_token=NULL,failures=CASE WHEN ${failed} THEN failures+1 ELSE 0 END WHERE ${tenant(s)} AND provider='DISCORD' AND lease_token=${lease}::uuid`.execute(
      this.db,
    );
  }
}
