import pg from "pg";
import { expect, it, vi } from "vitest";
import { isolatedPostgres } from "../fixtures/postgres";

it("keeps the isolated database alive until its client connections close", async () => {
  const infra = await isolatedPostgres();
  const client = new pg.Client({
    connectionString: infra.databaseUrl,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
  });
  const errors: Error[] = [];
  client.on("error", (error) => errors.push(error));
  let stopping: Promise<void> | undefined;
  let closed = false;
  let stopped = false;
  try {
    await client.connect();
    stopping = infra.stop();
    void stopping.then(
      () => {
        stopped = true;
      },
      () => {
        stopped = true;
      },
    );
    // Observe the shutdown connection, so this assertion cannot run before
    // shutdown starts or merely depend on an arbitrary sleep.
    await vi.waitFor(
      async () => {
        const { rows } = await client.query<{ connections: number }>(
          "SELECT count(*)::integer AS connections FROM pg_stat_activity WHERE application_name = 'nexus-test-shutdown'",
        );
        expect(rows[0]?.connections).toBe(1);
      },
      { timeout: 2000, interval: 20 },
    );
    expect(stopped).toBe(false);
    expect((await client.query("SELECT 1 AS value")).rows).toEqual([
      { value: 1 },
    ]);
    await client.end();
    closed = true;
    await stopping;
    expect(stopped).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (!closed) await client.end();
    await (stopping ?? infra.stop());
  }
});
