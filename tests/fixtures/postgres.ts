import EmbeddedPostgres from "embedded-postgres";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
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
  return {
    databaseUrl: `postgresql://nexus_test:synthetic-db-password@127.0.0.1:${address.port}/postgres`,
    directory,
    stop: () => postgres.stop(),
  };
}
