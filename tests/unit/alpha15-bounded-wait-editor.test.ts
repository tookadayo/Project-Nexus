import { describe, expect, it } from "vitest";
import {
  availableVariables,
  branches,
  cloneStatement,
  createDraft,
  createStatement,
  locate,
  moveStatement,
  PALETTE,
  writableVariables,
} from "../../apps/web/app/automation/model";
import type { Statement } from "../../packages/automation/src/types";

const create = (kind: "poll" | "awaitEvent") =>
  createStatement(
    PALETTE.find((card) => card.kind === kind)!,
    "en",
  );
const emptyStep = (id: string): Statement => ({ id, kind: "end" });

describe("alpha15 bounded wait editor scope", () => {
  it("starts every execution bound unset and keeps the two approved contracts distinct", () => {
    const poll = create("poll"),
      awaitEvent = create("awaitEvent");
    if (poll.kind !== "poll" || awaitEvent.kind !== "awaitEvent")
      throw Error("KIND");
    expect(
      [
        poll.ticket,
        poll.maxAttempts,
        poll.interval,
        poll.until,
        poll.condition,
      ].every((input) => input.kind === "missing"),
    ).toBe(true);
    expect(awaitEvent.event).toBe("ticketUpdated");
    expect(awaitEvent.states).toEqual([]);
    expect(awaitEvent.ticket).toEqual({ kind: "missing", type: "TicketRef" });
    expect(awaitEvent.until).toEqual({ kind: "missing", type: "Instant" });
    expect(branches(poll).map((item) => item.key)).toEqual([
      "matched",
      "exhausted",
      "timedOut",
    ]);
    expect(branches(awaitEvent).map((item) => item.key)).toEqual([
      "matched",
      "timedOut",
    ]);
  });

  it("offers a polling result only in matched and exhausted descendants and never as writable", () => {
    const poll = create("poll");
    if (poll.kind !== "poll") throw Error("KIND");
    poll.matched = [
      {
        id: "nested",
        kind: "branch",
        condition: { kind: "missing", type: "Boolean" },
        then: [emptyStep("matched")],
        otherwise: [],
        unknown: [],
      },
    ];
    poll.exhausted = [emptyStep("exhausted")];
    poll.timedOut = [emptyStep("timeout")];
    const flow = createDraft("321111111111111111", "en");
    flow.body = [poll, emptyStep("after")];
    const offered = (id: string) =>
      availableVariables(flow, id).map((item) => item.id);
    expect(offered("matched")).toContain(poll.output.id);
    expect(offered("exhausted")).toContain(poll.output.id);
    expect(offered("timeout")).not.toContain(poll.output.id);
    expect(offered("after")).not.toContain(poll.output.id);
    expect(offered(poll.id)).not.toContain(poll.output.id);
    expect(
      writableVariables(flow, "matched").map((item) => item.id),
    ).not.toContain(poll.output.id);
  });

  it("keeps an awaited result in its matched branch and preserves branches when moved to Not used", () => {
    const wait = create("awaitEvent");
    if (wait.kind !== "awaitEvent") throw Error("KIND");
    wait.matched = [emptyStep("match")];
    wait.timedOut = [emptyStep("timeout")];
    const flow = createDraft("321111111111111111", "en");
    flow.body = [wait, emptyStep("after")];
    expect(availableVariables(flow, "match").map((item) => item.id)).toContain(
      wait.output.id,
    );
    for (const id of ["timeout", "after"])
      expect(availableVariables(flow, id).map((item) => item.id)).not.toContain(
        wait.output.id,
      );
    const unused = moveStatement(flow, wait.id, "unused");
    expect(locate(unused, "match")?.parent?.id).toBe(wait.id);
    expect(locate(unused, "timeout")?.parent?.id).toBe(wait.id);
  });

  it("remaps duplicated result bindings and predicate references without changing external ticket references", () => {
    const poll = create("poll");
    if (poll.kind !== "poll") throw Error("KIND");
    poll.ticket = {
      kind: "variable",
      type: "TicketRef",
      variableId: "event.ticket",
    };
    poll.condition = {
      kind: "expression",
      type: "Boolean",
      expression: {
        operator: "compare.equal",
        args: [
          {
            kind: "variable",
            type: poll.output.type,
            variableId: poll.output.id,
          },
          {
            kind: "variable",
            type: poll.output.type,
            variableId: poll.output.id,
          },
        ],
      },
    };
    const cloned = cloneStatement(poll);
    if (cloned.kind !== "poll" || cloned.condition.kind !== "expression")
      throw Error("KIND");
    expect(cloned.output.id).not.toBe(poll.output.id);
    expect(cloned.ticket).toEqual(poll.ticket);
    expect(
      cloned.condition.expression.args.map(
        (arg) => arg.kind === "variable" && arg.variableId,
      ),
    ).toEqual([cloned.output.id, cloned.output.id]);
  });
});
