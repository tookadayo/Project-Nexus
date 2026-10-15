import { z } from "zod";
import { parseInstant } from "./datetime";
import type { EvaluatedValue, TargetRef } from "./types";

export class AutomationMessageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutomationMessageError";
  }
}
export type RichTextNode =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | {
      kind: "bold" | "italic" | "underline" | "strike" | "spoiler" | "quote";
      children: RichTextNode[];
    }
  | { kind: "heading"; level: 1 | 2 | 3; children: RichTextNode[] }
  | {
      kind: "code";
      text: string;
      multiline?: boolean;
      language?: "text" | "json" | "javascript" | "typescript" | "python";
    }
  | { kind: "link"; text: string; url: string }
  | {
      kind: "timestamp";
      instant: string;
      format: "t" | "T" | "d" | "D" | "f" | "F" | "R";
    }
  | { kind: "list"; ordered: boolean; items: RichTextNode[][] };
export interface EmbedSpec {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  author?: { name: string };
}
export interface MentionPolicy {
  userIds?: string[];
  roleIds?: string[];
  everyone?: boolean;
  replyAuthor?: boolean;
}
export interface MentionAuthorization {
  userIds: readonly string[];
  roleIds: readonly string[];
  everyone?: boolean;
  replyAuthor?: boolean;
}
export interface AllowedMentions {
  parse: "everyone"[];
  users: string[];
  roles: string[];
  replied_user: boolean;
}
export interface LegacyMessageSpec {
  kind: "legacy";
  content?: string;
  /** Structured formatting is explicit; ordinary text is escaped by renderRichText. */
  richText?: RichTextNode[];
  embeds?: EmbedSpec[];
  mentions?: MentionPolicy;
}
export interface V2TextDisplay {
  type: 10;
  content: string;
}
export interface V2Separator {
  type: 14;
  divider?: boolean;
  spacing?: 1 | 2;
}
export interface V2Container {
  type: 17;
  components: (V2TextDisplay | V2Separator)[];
  accent_color?: number;
  spoiler?: boolean;
}
export interface V2MessageSpec {
  kind: "v2";
  components: (V2TextDisplay | V2Separator | V2Container)[];
  mentions?: MentionPolicy;
}
export type MessageSpec = LegacyMessageSpec | V2MessageSpec;
const snowflake = z.string().regex(/^\d{5,30}$/);
const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Choose a valid HTTPS link.");
const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("text"), text: z.string().max(2000) }).strict(),
    z.object({ kind: z.literal("break") }).strict(),
    z
      .object({
        kind: z.enum([
          "bold",
          "italic",
          "underline",
          "strike",
          "spoiler",
          "quote",
        ]),
        children: z.array(richTextNodeSchema).max(256),
      })
      .strict(),
    z
      .object({
        kind: z.literal("heading"),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        children: z.array(richTextNodeSchema).max(256),
      })
      .strict(),
    z
      .object({
        kind: z.literal("code"),
        text: z.string().max(2000),
        multiline: z.boolean().optional(),
        language: z
          .enum(["text", "json", "javascript", "typescript", "python"])
          .optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("link"),
        text: z.string().max(2000),
        url: httpsUrl,
      })
      .strict(),
    z
      .object({
        kind: z.literal("timestamp"),
        instant: z.string(),
        format: z.enum(["t", "T", "d", "D", "f", "F", "R"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("list"),
        ordered: z.boolean(),
        items: z.array(z.array(richTextNodeSchema).max(256)).max(100),
      })
      .strict(),
  ]),
);
const mentionSchema = z
  .object({
    userIds: z.array(snowflake).max(100).optional(),
    roleIds: z.array(snowflake).max(100).optional(),
    everyone: z.boolean().optional(),
    replyAuthor: z.boolean().optional(),
  })
  .strict();
const embedSchema = z
  .object({
    title: z.string().max(256).optional(),
    description: z.string().max(4096).optional(),
    url: httpsUrl.optional(),
    color: z.number().int().min(0).max(0xffffff).optional(),
    timestamp: z.string().optional(),
    fields: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            value: z.string().min(1).max(1024),
            inline: z.boolean().optional(),
          })
          .strict(),
      )
      .max(25)
      .optional(),
    footer: z
      .object({ text: z.string().max(2048) })
      .strict()
      .optional(),
    author: z
      .object({ name: z.string().max(256) })
      .strict()
      .optional(),
  })
  .strict();
const textDisplay = z
    .object({ type: z.literal(10), content: z.string().min(1).max(4000) })
    .strict(),
  separator = z
    .object({
      type: z.literal(14),
      divider: z.boolean().optional(),
      spacing: z.union([z.literal(1), z.literal(2)]).optional(),
    })
    .strict();
const v2Container = z
  .object({
    type: z.literal(17),
    components: z
      .array(z.union([textDisplay, separator]))
      .min(1)
      .max(39),
    accent_color: z.number().int().min(0).max(0xffffff).optional(),
    spoiler: z.boolean().optional(),
  })
  .strict();
const messageSchema = z.union([
  z
    .object({
      kind: z.literal("legacy"),
      content: z.string().max(2000).optional(),
      richText: z.array(richTextNodeSchema).max(256).optional(),
      embeds: z.array(embedSchema).max(10).optional(),
      mentions: mentionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("v2"),
      components: z
        .array(z.union([textDisplay, separator, v2Container]))
        .min(1)
        .max(40),
      mentions: mentionSchema.optional(),
    })
    .strict(),
]);
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, "\\$&");
}
/** Plain text is escaped at its boundary, including text nested in explicit rich wrappers. */
export function renderRichText(
  nodes: RichTextNode[],
  maximumLength = 2000,
): string {
  let inspected = 0;
  const inspect = (value: unknown, depth = 0): boolean =>
    ++inspected > 1024 ||
    depth > 24 ||
    (value !== null &&
      typeof value === "object" &&
      Object.values(value).some((child) => inspect(child, depth + 1)));
  if (
    !Number.isSafeInteger(maximumLength) ||
    maximumLength < 1 ||
    maximumLength > 4000 ||
    inspect(nodes)
  )
    throw new AutomationMessageError(
      "RICH_BUDGET",
      "The rich text exceeds its structural budget.",
    );
  const parsed = z.array(richTextNodeSchema).max(256).safeParse(nodes);
  if (!parsed.success)
    throw new AutomationMessageError(
      "RICH_SCHEMA",
      "Choose registered rich-text parts with valid typed inputs.",
    );
  let visited = 0;
  const render = (children: RichTextNode[], depth: number): string => {
    if (depth > 8)
      throw new AutomationMessageError(
        "RICH_DEPTH",
        "The rich text is too deeply nested.",
      );
    const output = children
      .map((node) => {
        if (++visited > 256)
          throw new AutomationMessageError(
            "RICH_NODES",
            "The rich text has too many parts.",
          );
        switch (node.kind) {
          case "text":
            return escapeMarkdown(node.text);
          case "break":
            return "\n";
          case "code": {
            if (node.multiline) {
              const fence = "`".repeat(
                Math.max(
                  3,
                  ...[...node.text.matchAll(/`+/g)].map(
                    (match) => match[0].length + 1,
                  ),
                ),
              );
              return `${fence}${node.language ?? ""}\n${node.text}\n${fence}`;
            }
            if (node.text.includes("\n"))
              throw new AutomationMessageError(
                "INLINE_CODE",
                "Use a multiline code block for line breaks.",
              );
            const fence = "`".repeat(
              Math.max(
                1,
                ...[...node.text.matchAll(/`+/g)].map(
                  (match) => match[0].length + 1,
                ),
              ),
            );
            return `${fence}${node.text}${fence}`;
          }
          case "link":
            if (!httpsUrl.safeParse(node.url).success)
              throw new AutomationMessageError(
                "LINK",
                "Choose a valid HTTPS link.",
              );
            return `[${escapeMarkdown(node.text)}](${node.url.replaceAll("(", "%28").replaceAll(")", "%29")})`;
          case "timestamp":
            return `<t:${Math.floor(Date.parse(parseInstant(node.instant)) / 1000)}:${node.format}>`;
          case "list":
            return node.items
              .map(
                (item, i) =>
                  `${node.ordered ? `${i + 1}.` : "-"} ${render(item, depth + 1).replaceAll("\n", "\n  ")}`,
              )
              .join("\n");
          case "quote":
            return render(node.children, depth + 1)
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n");
          case "heading":
            return `${"#".repeat(node.level)} ${render(node.children, depth + 1)}`;
          default: {
            const wrappers = {
              bold: "**",
              italic: "*",
              underline: "__",
              strike: "~~",
              spoiler: "||",
            };
            const wrap = wrappers[node.kind];
            return `${wrap}${render(node.children, depth + 1)}${wrap}`;
          }
        }
      })
      .join("");
    if (output.length > maximumLength)
      throw new AutomationMessageError(
        "MESSAGE_LENGTH",
        "The expanded message is too long.",
      );
    return output;
  };
  return render(parsed.data, 0);
}
export function buildAllowedMentions(
  policy: MentionPolicy = {},
  authorization: MentionAuthorization = { userIds: [], roleIds: [] },
): AllowedMentions {
  if (!mentionSchema.safeParse(policy).success)
    throw new AutomationMessageError(
      "MENTIONS",
      "Choose valid explicit mention targets.",
    );
  const users = [...new Set(policy.userIds ?? [])],
    roles = [...new Set(policy.roleIds ?? [])];
  if (
    users.some((id) => !authorization.userIds.includes(id)) ||
    roles.some((id) => !authorization.roleIds.includes(id)) ||
    (policy.everyone && !authorization.everyone) ||
    (policy.replyAuthor && !authorization.replyAuthor)
  )
    throw new AutomationMessageError(
      "MENTION_AUTHORIZATION",
      "This notification target has not been explicitly authorized.",
    );
  return {
    parse: policy.everyone ? ["everyone"] : [],
    users,
    roles,
    replied_user: policy.replyAuthor === true,
  };
}
export function validateMessageSpec(input: unknown): MessageSpec {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success)
    throw new AutomationMessageError(
      "MESSAGE_SCHEMA",
      "The message has an invalid field, unsupported component, or exceeded limit.",
    );
  const spec = parsed.data;
  if (spec.kind === "legacy") {
    if (spec.content !== undefined && spec.richText !== undefined)
      throw new AutomationMessageError(
        "MESSAGE_MODE",
        "Choose plain content or structured rich text, never both.",
      );
    const content =
      spec.richText === undefined
        ? spec.content === undefined
          ? undefined
          : escapeMarkdown(spec.content)
        : renderRichText(spec.richText);
    if (content && content.length > 2000)
      throw new AutomationMessageError(
        "MESSAGE_LENGTH",
        "The compiled message exceeds 2,000 characters.",
      );
    if (!(content?.length || spec.embeds?.length))
      throw new AutomationMessageError(
        "MESSAGE_EMPTY",
        "Enter message text or an embed.",
      );
    const count = (spec.embeds ?? []).reduce(
      (total, embed) =>
        total +
        (embed.title?.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.author?.name.length ?? 0) +
        (embed.footer?.text.length ?? 0) +
        (embed.fields ?? []).reduce(
          (sum, field) => sum + field.name.length + field.value.length,
          0,
        ),
      0,
    );
    if (count > 6000)
      throw new AutomationMessageError(
        "EMBED_LENGTH",
        "The combined embed text exceeds 6,000 characters.",
      );
    for (const embed of spec.embeds ?? []) {
      if (!(
        embed.title?.length ||
        embed.description?.length ||
        embed.fields?.length ||
        embed.footer?.text.length ||
        embed.author?.name.length
      ))
        throw new AutomationMessageError(
          "EMBED_EMPTY",
          "Enter visible text in the embed.",
        );
      if (embed.timestamp) parseInstant(embed.timestamp);
    }
  } else {
    const components = spec.components.reduce(
      (count, component) =>
        count +
        1 +
        ("components" in component ? component.components.length : 0),
      0,
    );
    if (components > 40)
      throw new AutomationMessageError(
        "V2_COMPONENTS",
        "This message exceeds 40 components.",
      );
    const textLength = spec.components.reduce(
      (total, component) =>
        total +
        ("content" in component
          ? component.content.length
          : "components" in component
            ? component.components.reduce(
                (sum, child) =>
                  sum + ("content" in child ? child.content.length : 0),
                0,
              )
            : 0),
      0,
    );
    if (textLength > 4000)
      throw new AutomationMessageError(
        "V2_LENGTH",
        "The V2 text exceeds its conservative size limit.",
      );
  }
  return structuredClone(spec);
}
export function buildDiscordMessage(
  spec: MessageSpec,
  authorization?: MentionAuthorization,
): Record<string, unknown> {
  const validated = validateMessageSpec(spec),
    allowed_mentions = buildAllowedMentions(validated.mentions, authorization);
  return validated.kind === "legacy"
    ? {
        ...(validated.richText !== undefined || validated.content !== undefined
          ? {
              content:
                validated.richText !== undefined
                  ? renderRichText(validated.richText)
                  : escapeMarkdown(validated.content!),
            }
          : {}),
        ...(validated.embeds ? { embeds: validated.embeds } : {}),
        allowed_mentions,
      }
    : { flags: 1 << 15, components: validated.components, allowed_mentions };
}
/** The same strict embed contract is used by draft validation, simulation and transport. */
export function validateEmbedSpec(input: unknown): EmbedSpec {
  const parsed = validateMessageSpec({ kind: "legacy", embeds: [input] });
  if (parsed.kind !== "legacy")
    throw new AutomationMessageError("EMBED_SCHEMA", "Choose a Legacy embed.");
  return parsed.embeds![0]!;
}
/** Restrictions are inherited through every calculation, record and text conversion. */
export function assertValueCanPublish(
  value: EvaluatedValue,
  target: TargetRef,
): void {
  for (const source of value.provenance) {
    if (
      source.sensitive ||
      (source.guildId && source.guildId !== target.guildId) ||
      (source.allowedChannelIds &&
        !source.allowedChannelIds.includes(target.id))
    )
      throw new AutomationMessageError(
        "PUBLICATION_SCOPE",
        "This value cannot be published to the selected channel.",
      );
  }
}
