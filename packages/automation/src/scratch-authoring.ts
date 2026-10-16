import { z } from "zod";
import type {
  FlowDefinition,
  Statement,
  ValidationIssue,
  ValueInput,
} from "./types";

type Branch = Extract<Statement, { kind: "branch" }>;
export interface CommonUnknownDraft {
  id: string;
  clauses: { id: string; condition: ValueInput; then: Statement[] }[];
  otherwise: Statement[];
  template: Statement[];
}
export interface CommonUnknownCopy {
  clauseId: string;
  nodeIds: Record<string, string>;
  localIds: Record<string, string>;
  branchIds: Record<string, string>;
}
export interface CommonUnknownChain {
  id: string;
  entryId: string;
  clauseIds: string[];
  template: Statement[];
  copies: CommonUnknownCopy[];
}
export interface ScratchAuthoringMetadata {
  version: 1;
  chains: CommonUnknownChain[];
}
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  .refine(
    (value) => !["constructor", "prototype", "__proto__"].includes(value),
  );
const ids = z.record(id, id);
/** The executable copies pass the ordinary strict Statement schema. The
 * validator below additionally requires an exact hygienic template expansion. */
export const scratchAuthoringSchema = z
  .object({
    version: z.literal(1),
    chains: z.array(
      z
        .object({
          id,
          entryId: id,
          clauseIds: z.array(id).min(1),
          template: z.array(
            z.custom<Statement>(
              (item) =>
                !!item &&
                typeof item === "object" &&
                "kind" in item &&
                "id" in item,
            ),
          ),
          copies: z
            .array(
              z
                .object({
                  clauseId: id,
                  nodeIds: ids,
                  localIds: ids,
                  branchIds: ids,
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();

/** Traversal stays within syntax nodes. Literal records and target IDs are data. */
function visitSyntax(
  value: unknown,
  statement: (node: Record<string, unknown>) => void,
  expression?: (node: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitSyntax(item, statement, expression));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (
    object.kind === "literal" ||
    object.kind === "missing" ||
    object.kind === "variable"
  )
    return;
  if (object.kind === "expression") {
    const expr = object.expression as Record<string, unknown>;
    expression?.(expr);
    visitSyntax(expr.args, statement, expression);
    const options = expr.options as Record<string, unknown> | undefined;
    if (options?.body) visitSyntax(options.body, statement, expression);
    return;
  }
  if (typeof object.kind === "string" && typeof object.id === "string")
    statement(object);
  for (const child of Object.values(object))
    visitSyntax(child, statement, expression);
}
function identifiers(template: Statement[]) {
  const nodes = new Set<string>(),
    locals = new Set<string>(),
    branches = new Set<string>();
  const declaration = (value: unknown) => {
    if (value && typeof value === "object" && "id" in value && "type" in value)
      locals.add(String(value.id));
  };
  visitSyntax(
    template,
    (node) => {
      const key = String(node.id);
      if (nodes.has(key)) throw new Error("SCRATCH_TEMPLATE_DUPLICATE_ID");
      nodes.add(key);
      for (const key of [
        "variable",
        "itemVariable",
        "indexVariable",
        "index",
        "output",
        "reason",
        "outcome",
      ])
        declaration(node[key]);
      if (node.kind === "call")
        Object.values(node.outputs as object).forEach(declaration);
      if (node.kind === "repeat")
        for (const item of (node.results as
          { output: unknown }[] | undefined) ?? [])
          declaration(item.output);
      if (node.kind === "parallel")
        for (const branch of node.branches as { id: string }[]) {
          if (branches.has(branch.id))
            throw new Error("SCRATCH_TEMPLATE_DUPLICATE_BRANCH");
          branches.add(branch.id);
        }
    },
    (expr) => {
      const options = expr.options as { bindingId?: string } | undefined;
      if (options?.bindingId) locals.add(options.bindingId);
    },
  );
  return { nodes, locals, branches };
}
function mapped(mapping: Record<string, string>, key: string): string {
  return Object.hasOwn(mapping, key) ? mapping[key]! : key;
}
/** Reserve syntax identities and free references, never literal payload IDs or
 * display names. A generated binding must not make an unbound reference valid. */
function syntaxIds(value: unknown, skipEntryId?: string): Set<string> {
  const result = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    const object = item as Record<string, unknown>;
    if (object.kind === "literal" || object.kind === "missing") return;
    if (object.kind === "branch" && object.id === skipEntryId) return;
    for (const key of ["id", "variableId", "bindingId", "actionId"])
      if (typeof object[key] === "string") result.add(object[key] as string);
    if (object.kind === "parallel" && object.outputs)
      Object.keys(object.outputs as object).forEach((key) => result.add(key));
    Object.values(object).forEach(visit);
  };
  visit(value);
  return result;
}
function outsideIds(definition: FlowDefinition, entryId?: string): Set<string> {
  const syntax = { ...definition };
  delete syntax.scratchAuthoring;
  return syntaxIds(syntax, entryId);
}
function expand(template: Statement[], copy: CommonUnknownCopy): Statement[] {
  const result = structuredClone(template);
  const declaration = (item: unknown) => {
    if (item && typeof item === "object" && "id" in item && "type" in item)
      item.id = mapped(copy.localIds, String(item.id));
  };
  const value = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(value);
      return;
    }
    if (!input || typeof input !== "object") return;
    const object = input as Record<string, unknown>;
    if (object.kind === "literal" || object.kind === "missing") return;
    if (object.kind === "variable") {
      object.variableId = mapped(copy.localIds, String(object.variableId));
      return;
    }
    if (object.kind === "expression") {
      const expr = object.expression as {
        args: ValueInput[];
        options?: { bindingId?: string; body?: ValueInput };
      };
      expr.args.forEach(value);
      if (expr.options?.bindingId)
        expr.options.bindingId = mapped(copy.localIds, expr.options.bindingId);
      if (expr.options?.body) value(expr.options.body);
      return;
    }
    if (typeof object.kind === "string" && typeof object.id === "string") {
      object.id = mapped(copy.nodeIds, object.id);
      if (object.kind === "assign")
        object.variableId = mapped(copy.localIds, String(object.variableId));
      if (object.kind === "approval")
        object.actionId = mapped(copy.nodeIds, String(object.actionId));
      for (const key of [
        "variable",
        "itemVariable",
        "indexVariable",
        "index",
        "output",
        "reason",
        "outcome",
      ])
        declaration(object[key]);
      if (object.kind === "call")
        Object.values(object.outputs as object).forEach(declaration);
      if (object.kind === "repeat")
        for (const item of (object.results as
          { output: unknown }[] | undefined) ?? [])
          declaration(item.output);
      if (object.kind === "parallel") {
        for (const branch of object.branches as { id: string }[])
          branch.id = mapped(copy.branchIds, branch.id);
        if (object.outputs)
          object.outputs = Object.fromEntries(
            Object.entries(
              object.outputs as Record<
                string,
                { branchId: string; outputId: string }
              >,
            ).map(([key, binding]) => [
              mapped(copy.localIds, key),
              {
                ...binding,
                branchId: mapped(copy.branchIds, binding.branchId),
              },
            ]),
          );
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (
        [
          "variable",
          "itemVariable",
          "indexVariable",
          "index",
          "output",
          "reason",
          "outcome",
        ].includes(key)
      )
        continue;
      if (object.kind === "call" && key === "outputs") continue;
      if (object.kind === "parallel" && key === "outputs") continue;
      value(child);
    }
  };
  value(result);
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function compileCommonUnknownChain(
  draft: CommonUnknownDraft,
  options: {
    prior?: CommonUnknownChain;
    createId?: () => string;
    reservedIds?: Iterable<string>;
  } = {},
): { statement: Branch; metadata: CommonUnknownChain } {
  if (
    !id.safeParse(draft.id).success ||
    !draft.clauses.length ||
    new Set(draft.clauses.map((clause) => clause.id)).size !==
      draft.clauses.length ||
    draft.clauses.some((clause) => !id.safeParse(clause.id).success)
  )
    throw new Error("SCRATCH_CHAIN_ID");
  if (options.prior && options.prior.id !== draft.id)
    throw new Error("SCRATCH_CHAIN_IDENTITY");
  const source = identifiers(draft.template);
  const used = new Set([...(options.reservedIds ?? []), ...syntaxIds(draft)]);
  const createId =
    options.createId ?? (() => `su.${globalThis.crypto.randomUUID()}`);
  const allocate = (
    keys: Set<string>,
    prior: Record<string, string> | undefined,
  ) =>
    Object.fromEntries(
      [...keys].map((key) => {
        const result =
          prior && Object.hasOwn(prior, key) ? prior[key]! : createId();
        if (!id.safeParse(result).success || used.has(result))
          throw new Error("SCRATCH_COPY_ID_COLLISION");
        used.add(result);
        return [key, result];
      }),
    );
  const copies = draft.clauses.map((clause) => {
    const prior = options.prior?.copies.find(
      (copy) => copy.clauseId === clause.id,
    );
    return {
      clauseId: clause.id,
      nodeIds: allocate(source.nodes, prior?.nodeIds),
      localIds: allocate(source.locals, prior?.localIds),
      branchIds: allocate(source.branches, prior?.branchIds),
    };
  });
  let tail = structuredClone(draft.otherwise),
    statement: Branch | undefined;
  for (let index = draft.clauses.length - 1; index >= 0; index--) {
    const clause = draft.clauses[index]!;
    statement = {
      kind: "branch",
      id: clause.id,
      condition: structuredClone(clause.condition),
      then: structuredClone(clause.then),
      otherwise: tail,
      unknown: expand(draft.template, copies[index]!),
    };
    tail = [statement];
  }
  return {
    statement: statement!,
    metadata: {
      id: draft.id,
      entryId: draft.clauses[0]!.id,
      clauseIds: draft.clauses.map((clause) => clause.id),
      template: structuredClone(draft.template),
      copies,
    },
  };
}

export function validateScratchAuthoring(
  definition: FlowDefinition,
): ValidationIssue[] {
  if (!definition.scratchAuthoring) return [];
  const fail = (): ValidationIssue[] => [
    {
      code: "SCRATCH_AUTHORING",
      path: "scratchAuthoring",
      message:
        "The common unknown template, stable mappings and executable copies must be saved together.",
      severity: "error",
    },
  ];
  try {
    if (
      !scratchAuthoringSchema.safeParse(definition.scratchAuthoring).success ||
      definition.semanticProfile !== "scratch.v1"
    )
      return fail();
    const all = new Map<string, Statement>();
    visitSyntax(
      [
        definition.body,
        ...(definition.procedures ?? []).map((proc) => proc.body),
      ],
      (node) => all.set(String(node.id), node as unknown as Statement),
    );
    const chainIds = new Set<string>(),
      ownedClauses = new Set<string>(),
      copyIds = new Set<string>();
    for (const chain of definition.scratchAuthoring.chains) {
      if (
        chainIds.has(chain.id) ||
        chain.entryId !== chain.clauseIds[0] ||
        chain.copies.length !== chain.clauseIds.length ||
        new Set(chain.clauseIds).size !== chain.clauseIds.length
      )
        return fail();
      chainIds.add(chain.id);
      const source = identifiers(chain.template);
      const clauseSyntax: unknown[] = [];
      let sourceClause = all.get(chain.entryId);
      for (const [index, clauseId] of chain.clauseIds.entries()) {
        if (sourceClause?.kind !== "branch" || sourceClause.id !== clauseId)
          return fail();
        clauseSyntax.push({
          id: clauseId,
          condition: sourceClause.condition,
          then: sourceClause.then,
        });
        if (index + 1 < chain.clauseIds.length) {
          if (sourceClause.otherwise.length !== 1) return fail();
          sourceClause = sourceClause.otherwise[0];
        } else clauseSyntax.push(sourceClause.otherwise);
      }
      const reserved = new Set([
        ...outsideIds(definition, chain.entryId),
        ...syntaxIds(chain.template),
        ...syntaxIds(clauseSyntax),
        chain.id,
      ]);
      let current = all.get(chain.entryId);
      for (const [index, clauseId] of chain.clauseIds.entries()) {
        if (
          ownedClauses.has(clauseId) ||
          current?.kind !== "branch" ||
          current.id !== clauseId
        )
          return fail();
        ownedClauses.add(clauseId);
        const copy = chain.copies[index]!;
        if (copy.clauseId !== clauseId) return fail();
        for (const [keys, mapping] of [
          [source.nodes, copy.nodeIds],
          [source.locals, copy.localIds],
          [source.branches, copy.branchIds],
        ] as const) {
          if (stable([...keys].sort()) !== stable(Object.keys(mapping).sort()))
            return fail();
          for (const target of Object.values(mapping)) {
            if (copyIds.has(target) || reserved.has(target)) return fail();
            copyIds.add(target);
          }
        }
        if (stable(current.unknown) !== stable(expand(chain.template, copy)))
          return fail();
        if (index + 1 < chain.clauseIds.length) {
          if (current.otherwise.length !== 1) return fail();
          current = current.otherwise[0];
        }
      }
    }
    return [];
  } catch {
    return fail();
  }
}

/** Returns one complete draft snapshot. Save it through the existing atomic
 * revision transaction; never persist metadata and tree in separate requests. */
export function saveCommonUnknownDraft(
  definition: FlowDefinition,
  draft: CommonUnknownDraft,
  options: { createId?: () => string } = {},
): FlowDefinition {
  if (
    definition.semanticProfile !== "scratch.v1" ||
    validateScratchAuthoring(definition).length
  )
    throw new Error("SCRATCH_AUTHORING_INVALID");
  const next = structuredClone(definition),
    chains = next.scratchAuthoring?.chains ?? [];
  const prior = chains.find((chain) => chain.id === draft.id);
  const compiled = compileCommonUnknownChain(draft, {
    prior,
    createId: options.createId,
    reservedIds: outsideIds(next, prior?.entryId),
  });
  let replaced = false;
  const replace = (object: unknown): void => {
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index++) {
        const item = object[index] as unknown;
        if (
          item &&
          typeof item === "object" &&
          "id" in item &&
          item.id === (prior?.entryId ?? compiled.metadata.entryId)
        ) {
          if (!prior || replaced)
            throw new Error("SCRATCH_EXISTING_TREE_CONVERSION");
          object[index] = compiled.statement;
          replaced = true;
        } else replace(item);
      }
    } else if (object && typeof object === "object") {
      if (
        "kind" in object &&
        ["literal", "missing", "variable"].includes(String(object.kind))
      )
        return;
      Object.values(object).forEach(replace);
    }
  };
  replace(next.body);
  next.procedures?.forEach((proc) => replace(proc.body));
  if (prior && !replaced) throw new Error("SCRATCH_CHAIN_ENTRY_MISSING");
  if (!prior) next.body.push(compiled.statement);
  next.scratchAuthoring = {
    version: 1,
    chains: [
      ...chains.filter((chain) => chain.id !== draft.id),
      compiled.metadata,
    ],
  };
  if (validateScratchAuthoring(next).length)
    throw new Error("SCRATCH_AUTHORING_INVALID");
  return next;
}
