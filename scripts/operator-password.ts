import { loadEnvFile } from "node:process";
import { mkdir, writeFile, rename, lstat, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  passwordCredentials,
  OperatorAuth,
  readOperatorCredentials,
} from "../packages/security/src/operator-auth";
import { connect } from "../packages/db/src/index";
try {
  loadEnvFile();
} catch {
  /* Owner supplies local environment. */
}
const mode = process.argv[2];
if (!["--init", "--reset"].includes(mode ?? "") || process.argv.length !== 3)
  throw new Error(
    "Use operator:password --init or --reset in a local terminal. No password arguments.",
  );
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("A local interactive terminal is required.");
const path = resolve(
    process.env.NEXUS_OPERATOR_CREDENTIALS ??
      ".local/operator/credentials.json",
  ),
  directory = dirname(path);
await mkdir(directory, { recursive: true, mode: 0o700 });
const info = await lstat(directory);
if (!info.isDirectory() || info.isSymbolicLink())
  throw new Error("Unsafe credential directory");
if (process.platform === "win32")
  execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-File",
      resolve("scripts/operator-acl.ps1"),
      "-Path",
      directory,
    ],
    { stdio: "ignore" },
  );
else if (info.mode & 0o077)
  throw new Error("Credential directory must be private (mode 700).");
let exists = true;
try {
  await lstat(path);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
  else throw error;
}
if (mode === "--init" && exists)
  throw new Error("Credentials already exist. Use the local reset procedure.");
if (mode === "--reset") await readOperatorCredentials(path);
async function prompt(label: string) {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((done, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const c of chunk.toString("utf8")) {
        if (c === "\u0003") {
          finish();
          reject(new Error("Canceled"));
          return;
        }
        if (c === "\r" || c === "\n") {
          finish();
          done(value);
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " " && value.length < 1024) value += c;
      }
    };
    function finish() {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    process.stdin.on("data", onData);
  });
}
const password = await prompt(
    "New operator password (14+ characters, hidden): ",
  ),
  confirmation = await prompt("Repeat password (hidden): ");
if (password !== confirmation) throw new Error("Passwords do not match.");
const credentials = await passwordCredentials(password),
  temporary = path + "." + randomUUID() + ".tmp";
try {
  await writeFile(temporary, JSON.stringify(credentials) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  if (process.platform === "win32")
    execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        resolve("scripts/operator-acl.ps1"),
        "-Path",
        temporary,
      ],
      { stdio: "ignore" },
    );
  if (mode === "--init") {
    await writeFile(
      path,
      await import("node:fs/promises").then((fs) => fs.readFile(temporary)),
      { flag: "wx", mode: 0o600 },
    );
    await unlink(temporary);
    if (process.platform === "win32")
      execFileSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-File",
          resolve("scripts/operator-acl.ps1"),
          "-Path",
          path,
        ],
        { stdio: "ignore" },
      );
  } else await rename(temporary, path);
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
if (process.env.DATABASE_URL) {
  const db = connect(process.env.DATABASE_URL);
  try {
    await new OperatorAuth(db, () => readOperatorCredentials(path)).revokeAll();
  } catch {
    process.stderr.write(
      "Credential epoch changed; database audit/revocation maintenance is pending.\n",
    );
  } finally {
    await db.destroy();
  }
}
process.stdout.write(
  "Operator credentials saved locally. Old operator sessions cannot be reused.\n",
);
