import type { Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { IdentityVault } from "../../../packages/identity/src/index";
import { featureDecision } from "../../../packages/settings/src/billing/domain";
import { enforceOperationsPlan } from "../../../packages/operations/src/plan-policy";
import { WebhookWorker } from "../../../packages/operations/src/webhooks";
import { InterventionReview } from "../../../packages/operations/src/intervention-review";
import { PlaybookWorker } from "./playbooks";
import { ReportWorker } from "./reports";
export class CommunityOperationsWorker {
  private readonly lastTick = new Map<string, number>();
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async tick(s: Scope, now = new Date()) {
    const key = s.organizationId + ":" + s.guildId;
    if ((this.lastTick.get(key) ?? 0) > now.getTime() - 30000) return false;
    this.lastTick.set(key, now.getTime());
    while (this.lastTick.size > 10000)
      this.lastTick.delete(this.lastTick.keys().next().value!);
    const state = await enforceOperationsPlan(this.db, s);
    if (state.privacyDeleted) return false;
    if (featureDecision(state, "playbooks").allowed) {
      const worker = new PlaybookWorker(this.db);
      for (let i = 0; i < 5 && (await worker.tick(s, now)); i++) {
        /* Bounded per-guild work. */
      }
    }
    if (featureDecision(state, "scheduled_reports").allowed) {
      const worker = new ReportWorker(this.db);
      for (let i = 0; i < 2 && (await worker.tick(s, now)); i++) {
        /* Bounded rendering. */
      }
    }
    if (featureDecision(state, "improvement_tracking").allowed)
      await new InterventionReview(this.db).tick(s, now);
    if (featureDecision(state, "webhooks").allowed) {
      const worker = new WebhookWorker(this.db, this.vault);
      await worker.observeCoverage(s);
      for (let i = 0; i < 5 && (await worker.tick(s, now)); i++) {
        /* Bounded network delivery. */
      }
    }
    return true;
  }
}
