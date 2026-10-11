import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  hostedBetaEnabled,
  betaLimitsSchema,
} from "../../packages/config/src/hosted-beta";
import {
  operatorPolicy,
  passwordCredentials,
  readOperatorCredentials,
} from "../../packages/security/src/operator-auth";
import { publicSessionPolicy } from "../../packages/security/src/public-sessions";
it("fails closed for invalid configuration and prevents production from disabling invitation admission", () => {
  expect(hostedBetaEnabled({ NODE_ENV: "production" })).toBe(true);
  expect(() =>
    hostedBetaEnabled({ NODE_ENV: "production", NEXUS_HOSTED_BETA: "off" }),
  ).toThrow("HOSTED_BETA_REQUIRED");
  expect(() =>
    hostedBetaEnabled({ NODE_ENV: "test", NEXUS_HOSTED_BETA: "unknown" }),
  ).toThrow();
  expect(hostedBetaEnabled({ NODE_ENV: "test" })).toBe(false);
  expect(hostedBetaEnabled({ NODE_ENV: "test", NEXUS_HOSTED_BETA: "on" })).toBe(
    true,
  );
  for (const field of ["monthly", "daily", "guildPending", "globalPending"])
    for (const value of [0, -1, null, Number.POSITIVE_INFINITY])
      expect(betaLimitsSchema.safeParse({ [field]: value }).success).toBe(
        false,
      );
  expect(betaLimitsSchema.safeParse({ monthly: 21 }).success).toBe(false);
  expect(betaLimitsSchema.safeParse({ daily: 4 }).success).toBe(false);
  expect(betaLimitsSchema.safeParse({ guildPending: 3 }).success).toBe(false);
  expect(betaLimitsSchema.safeParse({ globalPending: 11 }).success).toBe(false);
  expect(() =>
    operatorPolicy({ NODE_ENV: "test", NEXUS_OPERATOR_IDLE_SECONDS: "901" }),
  ).toThrow();
  expect(() =>
    operatorPolicy({
      NODE_ENV: "test",
      NEXUS_OPERATOR_ABSOLUTE_SECONDS: "28801",
    }),
  ).toThrow();
  expect(() =>
    operatorPolicy({ NODE_ENV: "test", NEXUS_OPERATOR_MAX_FAILURES: "6" }),
  ).toThrow();
  expect(() =>
    operatorPolicy({
      NODE_ENV: "test",
      NEXUS_OPERATOR_FAILURE_WINDOW_SECONDS: "899",
    }),
  ).toThrow();
  expect(() =>
    publicSessionPolicy({
      NODE_ENV: "test",
      NEXUS_PUBLIC_IDLE_SECONDS: "43201",
    }),
  ).toThrow();
  expect(() =>
    publicSessionPolicy({
      NODE_ENV: "test",
      NEXUS_PUBLIC_ABSOLUTE_SECONDS: "604801",
    }),
  ).toThrow();
});
it("stores a salted operator hash and accepts only an owner-private regular credential file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nexus-synthetic-operator-")),
    path = join(directory, "credentials.json");
  try {
    const credentials = await passwordCredentials(
      "synthetic-file-password-test-only",
    );
    expect(JSON.stringify(credentials)).not.toContain(
      "synthetic-file-password",
    );
    await writeFile(path, JSON.stringify(credentials), { mode: 0o600 });
    if (process.platform === "win32")
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          fileURLToPath(
            new URL("../../scripts/operator-acl.ps1", import.meta.url),
          ),
          "-Path",
          path,
        ],
        { stdio: "ignore" },
      );
    expect(await readOperatorCredentials(path)).toEqual(credentials);
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      await expect(readOperatorCredentials(path)).rejects.toThrow(
        "OPERATOR_CREDENTIALS_UNSAFE",
      );
      await chmod(path, 0o600);
      const link = join(directory, "link.json");
      await symlink(path, link);
      await expect(readOperatorCredentials(link)).rejects.toThrow(
        "OPERATOR_CREDENTIALS_UNSAFE",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
