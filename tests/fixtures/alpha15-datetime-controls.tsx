import { useState } from "../../apps/web/node_modules/react";
import { createRoot } from "../../apps/web/node_modules/react-dom/client";
import {
  DateOnlyControl,
  LocalTimeControl,
  UserInstantControl,
} from "../../apps/web/app/automation/date-controls";
import { MessageBuilder } from "../../apps/web/app/automation/message-builder";
import {
  SimulationInputPanel,
  type SimulationInputs,
} from "../../apps/web/app/automation/simulation-inputs";
import { createDraft } from "../../apps/web/app/automation/model";
import type { ValueInput } from "../../packages/automation/src/types";

const locale =
  new URLSearchParams(location.search).get("locale") === "ja" ? "ja" : "en";
const initial = {
  date: "2024-02-29",
  minute: "18:30",
  second: "18:30:42",
  instant: "2026-10-16T18:30:42.123Z",
  ordinary: "2026-10-16T18:30:42.000Z",
};
const simulationDefinition = createDraft("321111111111111111", locale);
simulationDefinition.trigger = {
  kind: "manual",
  inputs: [{ id: "simulation-instant", name: "Mock instant", type: "Instant" }],
};
function Fixture() {
  const [values, setValues] = useState(initial),
    [valid, setValid] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<ValueInput>({
    kind: "literal",
    type: "LegacyMessageSpec",
    value: {
      kind: "legacy",
      embeds: [{ title: "Example", timestamp: initial.instant }],
      richText: [{ kind: "timestamp", instant: initial.instant, format: "f" }],
    },
  });
  const [messageError, setMessageError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationInputs>({
    clock: initial.instant,
    values: {},
    outputs: {},
    outcomes: {},
  });
  const [simulationValid, setSimulationValid] = useState(true);
  const validity = (key: string) => (value: boolean) =>
    setValid((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );
  return (
    <main>
      <section aria-label="Controls">
        <DateOnlyControl
          label="Date"
          locale={locale}
          value={values.date}
          onChange={(date) => setValues({ ...values, date })}
          todayDate="2026-10-16"
          onValidity={validity("date")}
        />
        <LocalTimeControl
          label="Minute"
          locale={locale}
          precision="minute"
          value={values.minute}
          onChange={(minute) => setValues({ ...values, minute })}
          onValidity={validity("minute")}
        />
        <LocalTimeControl
          label="Second"
          locale={locale}
          precision="second"
          value={values.second}
          onChange={(second) => setValues({ ...values, second })}
          onValidity={validity("second")}
        />
        <UserInstantControl
          label="Precise"
          locale={locale}
          value={values.instant}
          onChange={(instant) =>
            setValues({ ...values, instant: instant ?? "" })
          }
          onValidity={validity("instant")}
        />
        <UserInstantControl
          label="Ordinary"
          locale={locale}
          value={values.ordinary}
          onChange={(ordinary) =>
            setValues({ ...values, ordinary: ordinary ?? "" })
          }
          onValidity={validity("ordinary")}
        />
        <button
          type="button"
          disabled={Object.values(valid).some((value) => !value)}
          onClick={() =>
            localStorage.setItem(
              "datetime-controls-fixture",
              JSON.stringify(values),
            )
          }
        >
          Save controls
        </button>
        <button
          type="button"
          onClick={() => {
            const saved = localStorage.getItem("datetime-controls-fixture");
            if (saved) setValues(JSON.parse(saved));
          }}
        >
          Reload controls
        </button>
        <button type="button" onClick={() => setValues(initial)}>
          Undo controls
        </button>
        <output data-testid="controls-value">{JSON.stringify(values)}</output>
      </section>
      <section aria-label="Message">
        <MessageBuilder
          locale={locale}
          value={message}
          onChange={setMessage}
          onValidity={setMessageError}
        />
        <button disabled={!!messageError}>Save message</button>
        <output data-testid="message-value">{JSON.stringify(message)}</output>
      </section>
      <section aria-label="Simulation">
        <SimulationInputPanel
          definition={simulationDefinition}
          locale={locale}
          targets={{ available: true, channels: [], roles: [] }}
          value={simulation}
          onChange={setSimulation}
          disabled={false}
          onValidity={setSimulationValid}
        />
        <button disabled={!simulationValid}>Run simulation</button>
        <output data-testid="simulation-value">
          {JSON.stringify(simulation)}
        </output>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
