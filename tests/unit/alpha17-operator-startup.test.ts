import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  connect: vi.fn(), destroy: vi.fn(async () => {}),
  listen: vi.fn(async () => {}), close: vi.fn(async () => {}),
  invalidate: vi.fn(), load: vi.fn(),
}));
vi.mock("node:process", () => ({ loadEnvFile: vi.fn() }));
vi.mock("../../packages/db/src/index", () => ({ connect: f.connect }));
vi.mock("../../packages/security/src/alpha17-operator-config", () => ({ loadAlpha17OperatorConfiguration: f.load }));
vi.mock("../../packages/security/src/operator-auth", () => ({
  OperatorAuth: class {}, readOperatorCredentials: vi.fn(),
}));
vi.mock("../../packages/security/src/beta-operator", () => ({ BetaOperator: class {} }));
vi.mock("../../packages/discord/src/rest", () => ({ DiscordRest: class {} }));
vi.mock("../../apps/operator/src/server", () => ({
  createOperatorServer: vi.fn(() => ({ listen: f.listen, close: f.close })),
}));
import { startOperator } from "../../scripts/operator";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function environment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXUS_ENV_FILE", resolve(tmpdir(), "synthetic-only.env"));
  vi.stubEnv("NEXUS_OPERATOR_POLICY_FILE", resolve(tmpdir(), "synthetic-policy.json"));
  vi.stubEnv("NEXUS_OPERATOR_CREDENTIALS", resolve(tmpdir(), "synthetic-credentials.json"));
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:55432/fixture");
  vi.stubEnv("NEXUS_OPERATOR_PORT", "3210");
  f.connect.mockReturnValue({ destroy: f.destroy });
  f.load.mockResolvedValue({ alpha16: {}, maintenance: { invalidate: f.invalidate } });
}
describe("alpha17 Operator startup lifecycle with synthetic providers", () => {
  it("does not start a database, server or policy loader on import", () => {
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.listen).not.toHaveBeenCalled();
  });
  it("closes the server (including onClose timer cleanup) before destroying DB after listen failure", async () => {
    environment();
    f.listen.mockRejectedValueOnce(new Error("synthetic-EADDRINUSE"));
    await expect(startOperator()).rejects.toThrow("synthetic-EADDRINUSE");
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(f.close.mock.invocationCallOrder[0]!).toBeLessThan(f.destroy.mock.invocationCallOrder[0]!);
    expect(f.invalidate).toHaveBeenCalledTimes(1);
  });
  it("uses one idempotent stop promise and preserves loopback-only binding", async () => {
    environment();
    const operator = await startOperator();
    expect(f.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    await Promise.all([operator.stop(), operator.stop()]);
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });
  it("uses the supervisor's validated environment snapshot without another file read", async () => {
    environment();
    const operator = await startOperator({ environmentAlreadyLoaded: true });
    expect(loadEnvFile).not.toHaveBeenCalled();
    await operator.stop();
  });
  it("rejects an env-file mode change instead of starting production through development restrictions", async () => {
    environment();
    vi.stubEnv("NODE_ENV", "");
    vi.mocked(loadEnvFile).mockImplementationOnce(() => { vi.stubEnv("NODE_ENV", "production"); });
    await expect(startOperator()).rejects.toThrow("OPERATOR_ENV_MODE_CHANGED_RESTART_REQUIRED");
    expect(f.load).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("rejects a direct production Operator with a public database host before DB connection", async () => {
    environment();
    vi.stubEnv("DATABASE_URL", "postgresql://db.example.invalid/fixture");
    await expect(startOperator()).rejects.toThrow("OPERATOR_DATABASE_LOOPBACK_REQUIRED");
    expect(f.connect).not.toHaveBeenCalled();
  });
});
