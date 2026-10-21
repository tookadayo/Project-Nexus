import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, unlink, rmdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scrypt } from "node:crypto";

// Deliberately test only the Node/verifier boundary. This never executes the
// blocked PowerShell script, changes an execution policy, or applies a real ACL.
const boundary = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: boundary.execFile }));
import {
  passwordCredentials,
  readOperatorCredentials,
} from "../../packages/security/src/operator-auth";

let directory: string, path: string;
const synthetic = {
  epoch: "00000000-0000-4000-8000-000000000001",
  salt: "11".repeat(16),
  hash: "22".repeat(32),
  csrfKey: "33".repeat(32),
};
beforeAll(async () => {
  await mkdir(resolve(".local"), { recursive: true });
  directory = await mkdtemp(resolve(".local/alpha15-synthetic-credentials-"));
  path = join(directory, "synthetic-placeholder.json");
  await writeFile(path, JSON.stringify(synthetic));
});
beforeEach(() => {
  boundary.execFile.mockReset();
});
afterAll(async () => {
  if (path) await unlink(path);
  if (directory) await rmdir(directory);
});

it("uses independent in-memory salts and verifies the existing scrypt parameters without storing a password", async () => {
  const password = "synthetic-memory-password-only",
    first = await passwordCredentials(password),
    second = await passwordCredentials(password);
  expect(first.salt).toMatch(/^[a-f0-9]{32}$/);
  expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.salt).not.toBe(second.salt);
  expect(first.hash).not.toBe(second.hash);
  expect(first.epoch).not.toBe(second.epoch);
  expect(first.csrfKey).not.toBe(second.csrfKey);
  expect(JSON.stringify(first)).not.toContain(password);
  const derive = (value: string) =>
    new Promise<Buffer>((accept, reject) =>
      scrypt(
        value,
        first.salt,
        32,
        { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, hash) => (error ? reject(error) : accept(hash)),
      ),
    );
  expect((await derive(password)).toString("hex")).toBe(first.hash);
  expect((await derive(password + "-incorrect")).toString("hex")).not.toBe(
    first.hash,
  );
  expect(boundary.execFile).not.toHaveBeenCalled();
}, 10000);

it("rejects invalid password lengths before deriving a credential", async () => {
  await expect(passwordCredentials("short")).rejects.toThrow();
  await expect(passwordCredentials("x".repeat(1025))).rejects.toThrow();
  expect(boundary.execFile).not.toHaveBeenCalled();
});

it("rejects an actual directory before invoking any ACL helper", async () => {
  await expect(readOperatorCredentials(directory)).rejects.toThrow(
    "OPERATOR_CREDENTIALS_UNSAFE",
  );
  expect(boundary.execFile).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== "win32")(
  "rejects an existing dependency junction without loading any helper",
  async () => {
    const junction = resolve("node_modules/vitest");
    expect((await lstat(junction)).isSymbolicLink()).toBe(true);
    await expect(readOperatorCredentials(junction)).rejects.toThrow(
      "OPERATOR_CREDENTIALS_UNSAFE",
    );
    expect(boundary.execFile).not.toHaveBeenCalled();
  },
);

it.skipIf(process.platform !== "win32").each(["denied", "timeout"])(
  "fails closed for a simulated %s verifier result",
  async (reason) => {
    boundary.execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _options: unknown,
        callback: unknown,
      ) => {
        (callback as (error: Error) => void)(new Error("Synthetic " + reason));
      },
    );
    await expect(readOperatorCredentials(path)).rejects.toThrow(
      "OPERATOR_CREDENTIALS_UNSAFE",
    );
    expect(boundary.execFile).toHaveBeenCalledTimes(1);
    expect(boundary.execFile.mock.calls[0]?.[0]).toBe("powershell.exe");
    expect(boundary.execFile.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["-Verify", "-Path", path]),
    );
    expect(boundary.execFile.mock.calls[0]?.[1]).not.toEqual(
      expect.arrayContaining(["-ExecutionPolicy", "Bypass"]),
    );
  },
);

it.skipIf(process.platform !== "win32")(
  "parses only strict synthetic credential data after a simulated successful verifier result",
  async () => {
    boundary.execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _options: unknown,
        callback: unknown,
      ) => {
        (callback as (error: null) => void)(null);
      },
    );
    expect(await readOperatorCredentials(path)).toEqual(synthetic);
    await writeFile(
      path,
      JSON.stringify({ ...synthetic, unexpected: "synthetic-only" }),
    );
    await expect(readOperatorCredentials(path)).rejects.toThrow();
    await writeFile(path, JSON.stringify({ ...synthetic, hash: "invalid" }));
    await expect(readOperatorCredentials(path)).rejects.toThrow();
    expect(boundary.execFile).toHaveBeenCalledTimes(3);
  },
);
