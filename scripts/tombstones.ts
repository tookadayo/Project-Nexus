import { loadEnvFile } from "node:process";
import { readFile, open, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { z } from "zod";
import { connect } from "../packages/db/src/index";
import { IdentityVault } from "../packages/identity/src/index";
import { SettingsService } from "../packages/settings/src/index";
import { PrivacyService } from "../packages/security/src/privacy";
import { scrubStream } from "../apps/worker/src/streams";
import {
  captureDeletionTombstones,
  sealDeletionTombstones,
  openDeletionTombstones,
  applyDeletionTombstones,
} from "../packages/security/src/tombstones";
try {
  loadEnvFile();
} catch {
  /* Required values are validated below; never printed. */
}
const [mode, filename, ...extra] = process.argv.slice(2);
if (!filename || extra.length || !["--export", "--apply"].includes(mode ?? ""))
  throw new Error(
    "Usage: pnpm operator:tombstones --export|--apply <encrypted-file>",
  );
const key = z
  .string()
  .regex(/^[a-f0-9]{64}$/i)
  .parse(process.env.NEXUS_TOMBSTONE_KEY);
const db = connect(z.string().min(1).parse(process.env.DATABASE_URL));
let redis: Redis | undefined;
try {
  const path = resolve(filename),
    existing = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (existing?.isSymbolicLink()) throw new Error("TOMBSTONE_FILE_UNSAFE");
  if (mode === "--export") {
    const snapshot = sealDeletionTombstones(
        await captureDeletionTombstones(db),
        key,
      ),
      file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(snapshot + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    if (process.platform === "win32")
      await new Promise<void>((resolve, reject) =>
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-File",
            fileURLToPath(new URL("./operator-acl.ps1", import.meta.url)),
            "-Path",
            path,
          ],
          { timeout: 10000 },
          (error) =>
            error ? reject(new Error("TOMBSTONE_FILE_UNSAFE")) : resolve(),
        ),
      );
    process.stdout.write(
      "Encrypted deletion tombstones exported. Protect this file and its separate key.\n",
    );
  } else {
    if (process.env.NEXUS_RESTORE_OFFLINE !== "1")
      throw new Error("RESTORE_MUST_REMAIN_OFFLINE");
    const vault = new IdentityVault(
      z.string().length(64).parse(process.env.IDENTITY_KEY),
      z.string().length(64).parse(process.env.LOOKUP_KEY),
    );
    redis = new Redis(z.string().min(1).parse(process.env.REDIS_URL), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redis.on("error", () => {});
    await redis.connect();
    const privacy = new PrivacyService(
      db,
      vault,
      new SettingsService(db),
      (s, hash) => scrubStream(redis!, vault, s, hash),
    );
    await applyDeletionTombstones(
      db,
      vault,
      privacy,
      openDeletionTombstones((await readFile(path, "utf8")).trim(), key),
    );
    process.stdout.write(
      "Deletion tombstones applied and restored sessions revoked. Keep recovery offline until remaining gates pass.\n",
    );
  }
} catch {
  process.stderr.write(
    "Tombstone operation failed. Keep restore offline and check the protected configuration and scoped deletion state.\n",
  );
  process.exitCode = 1;
} finally {
  if (redis) await redis.quit();
  await db.destroy();
}
