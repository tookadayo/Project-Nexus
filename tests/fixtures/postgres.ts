import EmbeddedPostgres from "embedded-postgres";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

async function waitForClients(databaseUrl: string) {
  const observer = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
    application_name: "nexus-test-shutdown",
  });
  try {
    await observer.connect();
    // pg-pool can resolve end() while its client sockets are still closing.
    // Wait for their server backends to exit before SIGINT stops this cluster.
    // A leaked connection remains a failure instead of being silently ignored.
    for (let attempt = 0; attempt < 250; attempt++) {
      const { rows } = await observer.query<{ connections: number }>(
        "SELECT count(*)::integer AS connections FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()",
      );
      if (rows[0]?.connections === 0) return;
      await delay(20);
    }
    throw new Error("TEST_DATABASE_CLIENTS_STILL_CONNECTED");
  } finally {
    await observer.end();
  }
}

// A new private cluster for each run. Never consumes DATABASE_URL or an
// existing local/production database; all credentials are synthetic.
export async function isolatedPostgres() {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/pg-alpha12-"));
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_PORT_UNAVAILABLE");
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: "nexus_test",
    password: "synthetic-db-password",
    port: address.port,
    postgresFlags: ["-h", "127.0.0.1"],
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  const databaseUrl = `postgresql://nexus_test:synthetic-db-password@127.0.0.1:${address.port}/postgres`;
  let stopping: Promise<void> | undefined;
  return {
    databaseUrl,
    directory,
    stop: () =>
      (stopping ??= (async () => {
        try {
          await waitForClients(databaseUrl);
        } finally {
          await postgres.stop();
        }
      })()),
  };
}
