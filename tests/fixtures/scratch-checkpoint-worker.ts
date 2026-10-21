// A real disposable process is killed at the persistence boundary. Its runtime
// catch/finally blocks do not run; this is distinct from an injected exception.
import { connect } from "../../packages/db/src/index";
import { AutomationRuntime } from "../../packages/automation/src/runtime";
import type { ResumeState } from "../../packages/automation/src/store";
import type { Scope } from "../../packages/shared/src/index";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";

const input = JSON.parse(process.env.NEXUS_CHECKPOINT_INPUT!) as {
  scope: Scope;
  runId: string;
  now: string;
  operation: "number" | "list" | "continue";
  stage: "before" | "after";
  admission: AutomationAdmissionLimits;
};
const db = connect(process.env.NEXUS_CHECKPOINT_DATABASE_URL!);
const runtime = new AutomationRuntime(db, {
  admission: input.admission,
  now: () => new Date(input.now),
  adapter: {
    authorize: async () => {},
    execute: async () => {
      throw Error("NO_EXTERNAL_OPERATIONS_EXPECTED");
    },
  },
});
const save = runtime.store.save.bind(runtime.store);
const matches = (state: ResumeState) => {
  const frame = state.frames.find(
    (entry) => entry.path === "body/2/body" && entry.loop?.iteration === 0,
  );
  return (
    frame?.index ===
    ({ number: 1, list: 2, continue: 3 } as const)[input.operation]
  );
};
let captured = false;
runtime.store.save = async (...args) => {
  if (!captured && matches(args[2])) {
    captured = true;
    const before = (await runtime.store.run(input.scope, input.runId))!.resume;
    const candidate = structuredClone(args[2]);
    if (input.stage === "after") await save(...args);
    process.send?.({ stage: input.stage, before, candidate });
    await new Promise<void>(() => {});
    return;
  }
  await save(...args);
};
try {
  const result = await runtime.tick(input.scope, input.runId);
  process.send?.({ unexpectedResult: result });
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : "UNKNOWN" });
} finally {
  await db.destroy();
  process.disconnect?.();
}
