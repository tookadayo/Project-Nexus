import { afterEach, describe, expect, it, vi } from "vitest";
import { startAlpha17OperatorMaintenance } from "../../apps/operator/src/alpha17-maintenance";
import type { Alpha17OperatorMaintenance } from "../../packages/security/src/alpha17-operator-config";
afterEach(() => vi.useRealTimers());
function fixture(schedule: { batchSize: number; intervalMs: number; leaseMs: number } | null = { batchSize: 10, intervalMs: 1000, leaseMs: 2000 }) {
  const maintenance = {
    schedule: vi.fn(async () => schedule),
    recordPass: vi.fn(), invalidate: vi.fn(),
  } satisfies Alpha17OperatorMaintenance;
  const operator = { purgeOperatorEphemeral: vi.fn(async () => ({ ready: true })) };
  return { operator, maintenance };
}
describe("alpha17 local Operator maintenance lifecycle", () => {
  it("leaves read-only configuration inactive without an adopted schedule", async () => {
    const f = fixture(null), lifecycle = await startAlpha17OperatorMaintenance(f.operator, f.maintenance);
    expect(f.operator.purgeOperatorEphemeral).not.toHaveBeenCalled();
    expect(f.maintenance.recordPass).not.toHaveBeenCalled();
    await lifecycle.stop();
  });
  it("runs startup before readiness, repeats once per interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const f = fixture(), lifecycle = await startAlpha17OperatorMaintenance(f.operator, f.maintenance);
    expect(f.operator.purgeOperatorEphemeral).toHaveBeenCalledWith(10);
    expect(f.maintenance.recordPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.operator.purgeOperatorEphemeral).toHaveBeenCalledTimes(2);
    await lifecycle.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.operator.purgeOperatorEphemeral).toHaveBeenCalledTimes(2);
    expect(f.maintenance.invalidate).toHaveBeenCalledTimes(2);
  });
  it("invalidates failures, does not overlap passes, and can retry the unchanged config", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.operator.purgeOperatorEphemeral.mockRejectedValueOnce(new Error("fixture-unavailable"));
    const lifecycle = await startAlpha17OperatorMaintenance(f.operator, f.maintenance);
    expect(f.maintenance.recordPass).not.toHaveBeenCalled();
    expect(f.maintenance.invalidate).toHaveBeenCalledTimes(2);
    let complete!: (value: { ready: boolean }) => void;
    f.operator.purgeOperatorEphemeral.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.operator.purgeOperatorEphemeral).toHaveBeenCalledTimes(2);
    complete({ ready: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.maintenance.recordPass).toHaveBeenLastCalledWith({ ready: false }, expect.any(Date));
    await lifecycle.stop();
  });
  it("does not refresh evidence from a pass finishing during shutdown", async () => {
    vi.useFakeTimers();
    const f = fixture(), lifecycle = await startAlpha17OperatorMaintenance(f.operator, f.maintenance);
    let complete!: (value: { ready: boolean }) => void;
    f.operator.purgeOperatorEphemeral.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await vi.advanceTimersByTimeAsync(1000);
    const stopped = lifecycle.stop();
    complete({ ready: true });
    await stopped;
    expect(f.maintenance.recordPass).toHaveBeenCalledTimes(1);
  });
  it("requires restart after a policy read failure and never silently adopts new policy", async () => {
    vi.useFakeTimers();
    const f = fixture(), lifecycle = await startAlpha17OperatorMaintenance(f.operator, f.maintenance);
    f.maintenance.schedule.mockRejectedValueOnce(new Error("OPERATOR_POLICY_CHANGED_RESTART_REQUIRED"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.operator.purgeOperatorEphemeral).toHaveBeenCalledTimes(1);
    expect(f.maintenance.invalidate).toHaveBeenCalledTimes(2);
    await lifecycle.stop();
  });
});
