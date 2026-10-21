import { describe, it, expect } from "vitest";
import {
  compileFlowDefinition,
  validateFlowDefinition,
} from "../../packages/automation/src/definition";
import { evaluateValue } from "../../packages/automation/src/expression";
import {
  buildDiscordMessage,
  validateMessageSpec,
  assertValueCanPublish,
} from "../../packages/automation/src/message";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";
import {
  writableVariables,
  cloneStatement,
} from "../../apps/web/app/automation/model";
import type {
  FlowDefinition,
  Statement,
  ValueType,
  JsonValue,
  ValueInput,
} from "../../packages/automation/src/types";
const guildId = "321111111111111111",
  channelId = "621111111111111111";
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const flow = (body: Statement[] = []): FlowDefinition => ({
  schemaVersion: 1,
  id: "bridge",
  guildId,
  name: "Bridge test",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  targets: { channelIds: [channelId], roleIds: [], parentCategoryIds: [] },
  body,
});
describe("alpha15 editor typed bridges", () => {
  it("composes variable-bound message parts using the evaluator and carries publication restrictions", () => {
    const rich: ValueInput = {
      kind: "expression",
      type: "RichTextSpec",
      expression: {
        operator: "rich.wrap",
        args: [
          {
            kind: "expression",
            type: "RichTextSpec",
            expression: {
              operator: "rich.text",
              args: [
                { kind: "variable", type: "PlainText", variableId: "input" },
              ],
            },
          },
        ],
        options: { format: "bold" },
      },
    };
    const embed: ValueInput = {
      kind: "expression",
      type: "EmbedSpec",
      expression: {
        operator: "embed.build",
        args: [
          literal("PlainText", "*Title*"),
          { kind: "variable", type: "PlainText", variableId: "input" },
        ],
      },
    };
    const message: ValueInput = {
      kind: "expression",
      type: "LegacyMessageSpec",
      expression: {
        operator: "message.legacy",
        args: [
          rich,
          {
            kind: "expression",
            type: { kind: "List", element: "EmbedSpec" },
            expression: { operator: "list.build", args: [embed] },
          },
        ],
      },
    };
    const result = evaluateValue(message, {
      guildId,
      variables: {
        input: {
          type: "PlainText",
          value: "*private*",
          provenance: [
            { source: "service", guildId, allowedChannelIds: [channelId] },
          ],
        },
      },
    });
    const payload = buildDiscordMessage(validateMessageSpec(result.value));
    expect(payload.content).toBe("**\\*private\\***");
    expect(payload.embeds).toEqual([
      { title: "\\*Title\\*", description: "\\*private\\*" },
    ]);
    expect(
      result.provenance.some((source) =>
        source.allowedChannelIds?.includes(channelId),
      ),
    ).toBe(true);
    expect(() =>
      assertValueCanPublish(result, { id: "621111111111111112", guildId }),
    ).toThrow();
    expect(() =>
      assertValueCanPublish(result, { id: channelId, guildId }),
    ).not.toThrow();
    expect(() =>
      evaluateValue(
        {
          ...rich,
          expression: {
            ...rich.expression,
            options: { format: "html" as "bold" },
          },
        },
        {
          guildId,
          variables: {
            input: { type: "PlainText", value: "ok", provenance: [] },
          },
        },
      ),
    ).toThrow();
    expect(() =>
      evaluateValue(
        {
          kind: "expression",
          type: "LegacyMessageSpec",
          expression: {
            operator: "message.legacy",
            args: [
              {
                kind: "expression",
                type: "RichTextSpec",
                expression: { operator: "rich.join", args: [] },
              },
              literal({ kind: "List", element: "EmbedSpec" }, []),
            ],
          },
        },
        { guildId, variables: {} },
      ),
    ).toThrow();
  });
  it("validates explicit structured Legacy parts and rejects mixed message modes and V2 values", () => {
    const message = {
      kind: "legacy",
      richText: [{ kind: "bold", children: [{ kind: "text", text: "a*b" }] }],
      embeds: [{ title: "Status", fields: [{ name: "Ready", value: "Yes" }] }],
    } as const;
    const definition = flow([
      {
        id: "send",
        kind: "action",
        operation: "discord.sendMessage",
        inputs: {
          channel: literal("ChannelRef", { id: channelId, guildId }),
          messageSpec: literal(
            "LegacyMessageSpec",
            message as unknown as JsonValue,
          ),
        },
      },
    ]);
    expect(validateFlowDefinition(definition).complete).toBe(true);
    const payload = buildDiscordMessage(validateMessageSpec(message));
    expect(
      buildDiscordMessage({ kind: "legacy", content: "**literal**" }).content,
    ).toBe("\\*\\*literal\\*\\*");
    expect(payload.content).toBe("**a\\*b**");
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    });
    const send = definition.body[0] as Extract<Statement, { kind: "action" }>;
    send.inputs.content = literal("PlainText", "extra");
    expect(
      validateFlowDefinition(definition).issues.some(
        (issue) => issue.code === "MESSAGE_MODE",
      ),
    ).toBe(true);
    expect(() =>
      evaluateValue(
        literal("LegacyMessageSpec", {
          kind: "v2",
          components: [{ type: 10, content: "x" }],
        }),
        { guildId, variables: {} },
      ),
    ).toThrow();
    expect(() =>
      validateMessageSpec({ ...message, content: "mixed" }),
    ).toThrow();
    expect(() =>
      validateMessageSpec({ kind: "legacy", embeds: [{}] }),
    ).toThrow();
  });
  it("permits narrow intake ticket references while leaving other Discord references strict", () => {
    const ticket = "intake:12345678-1234-1234-1234-123456789abc";
    expect(
      evaluateValue(literal("TicketRef", { id: ticket, guildId }), {
        guildId,
        variables: {},
      }).value,
    ).toEqual({ id: ticket, guildId });
    expect(() =>
      evaluateValue(literal("MemberRef", { id: ticket, guildId }), {
        guildId,
        variables: {},
      }),
    ).toThrow();
  });
  it("keeps service-only ticket mock outputs separate from literal evidence in production", () => {
    const record: ValueType = {
      kind: "Record",
      schemaId: "nexus.ticket.status.v1",
    };
    const definition = flow([
      {
        id: "read",
        kind: "action",
        operation: "nexus.readTicket",
        inputs: {
          ticket: literal("TicketRef", {
            id: "intake:12345678-1234-1234-1234-123456789abc",
            guildId,
          }),
        },
        output: { id: "status", name: "Ticket state", type: record },
      },
    ]);
    const plan = compileFlowDefinition(definition);
    expect(
      simulateAutomationPlan(plan, {
        outcomes: { read: "SUCCEEDED" },
        outputs: {
          read: { type: record, value: { state: "SNOOZED", version: 3 } },
        },
      }).status,
    ).toBe("COMPLETED");
    expect(
      simulateAutomationPlan(plan, {
        outcomes: { read: "SUCCEEDED" },
        outputs: {
          read: {
            type: record,
            value: { state: "SNOOZED", version: 3, body: "not allowed" },
          },
        },
      }).status,
    ).toBe("FAILED");
    expect(
      simulateAutomationPlan(plan, {
        outcomes: { read: "SUCCEEDED" },
        outputs: { read: { type: "PlainText", value: "fake" } },
      }).status,
    ).toBe("FAILED");
    expect(() =>
      evaluateValue(literal(record, { state: "OPEN", version: 1 }), {
        guildId,
        variables: {},
      }),
    ).toThrow();
  });
  it("joins only typed explicit branch results into writable parent locals and duplicates references consistently", () => {
    const parallel: Extract<Statement, { kind: "parallel" }> = {
      id: "join",
      kind: "parallel",
      branches: [
        {
          id: "branch-a",
          name: "A",
          body: [
            {
              id: "local",
              kind: "declare",
              variable: { id: "branch-local", name: "Local", type: "Number" },
              value: literal("Number", 4),
            },
          ],
          outputs: {
            result: {
              kind: "variable",
              type: "Number",
              variableId: "branch-local",
            },
          },
        },
        { id: "branch-b", name: "B", body: [] },
      ],
      outputs: { parent: { branchId: "branch-a", outputId: "result" } },
    };
    const definition = flow([
      {
        id: "parent-declare",
        kind: "declare",
        variable: { id: "parent", name: "Parent", type: "Number" },
        value: literal("Number", 0),
      },
      parallel,
    ]);
    expect(validateFlowDefinition(definition).complete).toBe(true);
    expect(
      writableVariables(definition, "join").map((value) => value.id),
    ).toEqual(["parent"]);
    expect(writableVariables(definition, "local")).toEqual([]);
    const clone = cloneStatement(parallel) as typeof parallel;
    expect(clone.branches[0]!.id).not.toBe("branch-a");
    expect(clone.outputs!.parent!.branchId).toBe(clone.branches[0]!.id);
    expect(clone.outputs!.parent!.outputId).toBe("result");
    parallel.outputs!.parent = { branchId: "branch-b", outputId: "missing" };
    expect(
      validateFlowDefinition(definition).issues.some(
        (issue) => issue.code === "PARALLEL_OUTPUT_SOURCE",
      ),
    ).toBe(true);
  });
});
