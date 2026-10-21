import type { Alpha16Operator } from "../../../packages/security/src/alpha16-operator";
import type { Alpha17OperatorMaintenance } from "../../../packages/security/src/alpha17-operator-config";

/** One bounded local TTL pass at a time. No deletion worker is enabled here.
 * DB timeout is enforced by purgeOperatorEphemeral itself. */
export async function startAlpha17OperatorMaintenance(
  operator: Pick<Alpha16Operator, "purgeOperatorEphemeral">,
  maintenance: Alpha17OperatorMaintenance,
): Promise<{ stop(): Promise<void> }> {
  let stopping = false, timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const pass = async () => {
    let schedule: Awaited<ReturnType<Alpha17OperatorMaintenance["schedule"]>>;
    try {
      schedule = await maintenance.schedule();
    } catch {
      maintenance.invalidate();
      return; // Changed/unsafe policy requires restart; never adopt new grants.
    }
    if (!schedule || stopping) { maintenance.invalidate(); return; }
    const startedAt = new Date();
    try {
      const result = await operator.purgeOperatorEphemeral(schedule.batchSize);
      if (!stopping) maintenance.recordPass(result, startedAt);
    } catch {
      maintenance.invalidate();
    }
    if (!stopping) {
      timer = setTimeout(() => { running = pass(); }, schedule.intervalMs);
      timer.unref();
    }
  };
  maintenance.invalidate(); // A prior process/pass is never reusable evidence.
  running = pass();
  await running;
  return {
    stop: async () => {
      stopping = true;
      maintenance.invalidate();
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
