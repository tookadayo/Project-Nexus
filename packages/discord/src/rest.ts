import { canReadPostMetadata } from "./attention-visibility";
import {roleCoverage,assertRoleCoverage} from './role-coverage';
import {evaluateAutomationRolePolicy,type AutomationRolePolicyInput,type AutomationRolePolicy,type RolePolicyChannel} from './automation-role-policy';
export type {AutomationRolePolicyInput,AutomationRolePolicy} from './automation-role-policy';
import {validateCompiledLegacyMessage,type CompiledLegacyMessage} from './automation-message';
export type {CompiledLegacyMessage} from './automation-message';
import {
  readApplicationEmojiConfig,
  type ApplicationEmojiConfig,
} from "../../shared/src/application-emoji";
import { fallbackRejectedApplicationEmoji } from "./emoji-fallback";
import { traceStep } from "../../shared/src/observability";
import {
  PermissionFlagsBits,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { createHash } from "node:crypto";
import { assert, isDomainError } from "../../shared/src/index";
import { z } from "zod";
import type { APIEntitlement } from "discord-api-types/v10";
import {
  observableChannel,
  type DiscoverySource,
  type RawChannel,
} from "./discovery";
import type { CapabilityStatus } from "../../shared/src/community-model";
import {roleChannelMetadata,type RoleChannelMetadata} from "./role-access";
export type Member = {
  roles: string[];
  permissions: string;
  joinedAt: string;
  bot: boolean;
  flags?: string;
  pending?: boolean | null;
  guildName?: string;
  ownerId?: string;
};
export type DiscordAttachment = { filename: string; data: Buffer };
export type AutomationDiscordWrite =
  | {
      kind: "message";
      guildId: string;
      channelId: string;
      content?: string;
      messageSpec?: CompiledLegacyMessage;
      nonce: string;
    }
  | {kind:'editMessage';guildId:string;channelId:string;messageId:string;content?:string;messageSpec?:CompiledLegacyMessage}
  | {
      kind: "role";
      guildId: string;
      memberId: string;
      roleId: string;
      add: boolean;
    }
  | { kind: "channel"; guildId: string; parentId: string; name: string }
  | { kind: "thread"; guildId: string; channelId: string; name: string };
export const nativeOnboardingSchema = z.object({
  guild_id: z.string(),
  enabled: z.boolean(),
  mode: z.number().int(),
  default_channel_ids: z.array(z.string()),
  prompts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.number().int(),
      options: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          role_ids: z.array(z.string()),
          channel_ids: z.array(z.string()),
        }),
      ),
      single_select: z.boolean(),
      required: z.boolean(),
      in_onboarding: z.boolean(),
    }),
  ),
});
export type NativeOnboarding = z.infer<typeof nativeOnboardingSchema>;
export type GuildNativeState = {
  features: string[];
  onboarding: NativeOnboarding | null;
  bot: Member;
  roles: Role[];
  onboardingStatus: "available" | "unavailable";
};
export type Role = {
  id: string;
  position: number;
  managed: boolean;
  permissions: string;
  name?: string;
  tags?: Record<string,unknown>;
};
export type DiscordEntityOptions = {
  channels: { id: string; label: string }[];
  roles: { id: string; label: string }[];
  events: { id: string; label: string }[];
  surfaces?: { id: string; label: string; type: number }[];
  forumTags?: { channelId: string; id: string; label: string }[];
};
const discordFailureBrand = Symbol.for("nexus.discord-failure");
const discordWriteNotStartedBrand = Symbol.for(
  "nexus.discord-write-not-started",
);
/** Issued only by a transport guard before any request bytes for that write are sent. */
export class DiscordWriteNotStartedError extends Error {
  readonly [discordWriteNotStartedBrand] = true;
  readonly code: string;
  constructor(code: string) {
    const safeCode = /^[A-Z][A-Z0-9_]{0,100}$/.test(code)
      ? code
      : "AUTOMATION_PARENT_POLICY_UNVERIFIED";
    super(safeCode);
    this.name = "DiscordWriteNotStartedError";
    this.code = safeCode;
  }
}
export function isDiscordWriteNotStartedError(
  error: unknown,
): error is DiscordWriteNotStartedError {
  return (
    error instanceof DiscordWriteNotStartedError ||
    Boolean(
      error &&
      typeof error === "object" &&
      (error as Record<symbol, unknown>)[discordWriteNotStartedBrand] === true,
    )
  );
}
export class DiscordFailure extends Error {
  readonly [discordFailureBrand] = true;
  constructor(
    public readonly status: number,
    public readonly retryAfter = 0,
    public readonly details: {
      kind?: "http" | "timeout" | "network";
      rateLimitScope?: string | null;
      bucket?: string | null;
      routeCategory?: string;
      isGlobal?: boolean;
    } = {},
  ) {
    super(
      details.kind === "timeout"
        ? "Discord REST timeout"
        : details.kind === "network"
          ? "Discord REST network failure"
          : `Discord HTTP ${status}`,
    );
    this.name = "DiscordFailure";
  }
  get kind() {
    return this.details.kind ?? "http";
  }
  get rateLimitScope() {
    return this.details.rateLimitScope ?? null;
  }
  get bucket() {
    return this.details.bucket ?? null;
  }
  get routeCategory() {
    return this.details.routeCategory ?? "unknown";
  }
  get isGlobal() {
    return this.details.isGlobal ?? false;
  }
}
export function isDiscordFailure(error: unknown): error is DiscordFailure {
  return (
    error instanceof DiscordFailure ||
    Boolean(
      error &&
      typeof error === "object" &&
      (error as Record<symbol, unknown>)[discordFailureBrand] === true,
    )
  );
}
export interface DiscordPort {
  automationPreflight?(
    guildId: string,
    actorId: string,
    kind: "message" | "thread" | "channel",
    channelId: string,
  ): Promise<void>;
  automationRolePreflight?(
    input: AutomationRolePolicyInput,
  ): Promise<AutomationRolePolicy>;
  automationWrite?(
    input: AutomationDiscordWrite,
    beforeDispatch: () => Promise<void>,
  ): Promise<string | null>;
  billingEntitlements?(guildId: string): Promise<APIEntitlement[]>;
  capabilityState?(
    guildId: string,
    hashOwner: (id: string) => string,
  ): Promise<DiscoverySource>;
  sendDirectMessage?(
    userId: string,
    text: string,
    nonce: string,
  ): Promise<string>;
  nativeState?(guildId: string): Promise<GuildNativeState>;
  options?(guildId: string): Promise<DiscordEntityOptions>;
  memberSnapshot?(guildId: string, userId: string): Promise<Member>;
  registerCommands(guildId: string, commands: unknown[]): Promise<void>;
  commandsMatch?(guildId: string, commands: unknown[]): Promise<boolean>;
  member(guildId: string, userId: string): Promise<Member>;
  canReadAttentionChannel?(guildId:string,channelId:string,userId:string,member:Member):Promise<boolean>;
  roles(guildId: string): Promise<Role[]>;
  roleChannelMetadata?(guildId:string,channelId:string):Promise<RoleChannelMetadata>;
  checkChannel(guildId: string, channelId: string): Promise<void>;
  validateRole(guildId: string, roleId: string): Promise<void>;
  addRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
  sendPanel(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
    nonce: string,
    files?: DiscordAttachment[],
  ): Promise<string>;
  /** Current guild metadata only; never chooses the first channel in a list. */
  installationSystemChannel?(guildId: string): Promise<string | null>;
  /** Installation notices never retry inside the transport, including HTTP 429. */
  sendInstallNotice?(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
    nonce: string,
    beforeDispatch?: () => Promise<void>,
  ): Promise<string>;
  editPanel(
    channelId: string,
    messageId: string,
    body: RESTPostAPIChannelMessageJSONBody,
  ): Promise<void>;
  deletePanel?(channelId: string, messageId: string): Promise<void>;
  editReply(
    applicationId: string,
    token: string,
    body: RESTPostAPIChannelMessageJSONBody,
    files?: DiscordAttachment[],
  ): Promise<void>;
  followup?(
    applicationId: string,
    token: string,
    body: RESTPostAPIChannelMessageJSONBody,
  ): Promise<void>;
  publicChannel?(guildId: string, channelId: string): Promise<boolean>;
  channelVisibility?(
    guildId: string,
    channelId: string,
  ): Promise<"everyone_visible" | "restricted" | "unknown">;
}
export class DiscordRest implements DiscordPort {
  private globalUntil = 0;
  private readonly routeBuckets = new Map<string, string>();
  private readonly bucketUntil = new Map<string, number>();
  private readonly locks = new Map<string, Promise<void>>();
  constructor(
    private readonly token: string,
    private readonly botId: string,
  ) {}
  async billingEntitlements(guildId: string): Promise<APIEntitlement[]> {
    const result: APIEntitlement[] = [];
    let after = "";
    for (let page = 0; page < 100; page++) {
      const rows = await this.request<APIEntitlement[]>(
        `/applications/${this.botId}/entitlements?guild_id=${guildId}&limit=100&exclude_ended=false${after ? "&after=" + after : ""}`,
      );
      result.push(...rows);
      if (rows.length < 100) return result;
      const next = rows[rows.length - 1]!.id;
      assert(next !== after, "BILLING_PAGINATION_INCOMPLETE", 503);
      after = next;
    }
    throw new Error("BILLING_PAGINATION_INCOMPLETE");
  }
  async capabilityState(
    guildId: string,
    hashOwner: (id: string) => string,
  ): Promise<DiscoverySource> {
    const endpointStatus: Record<string, CapabilityStatus> = {};
    const read = async <T>(key: string, path: string): Promise<T | null> => {
      try {
        const value = await this.request<T>(path);
        endpointStatus[key] = "AVAILABLE";
        return value;
      } catch (error) {
        endpointStatus[key] =
          isDiscordFailure(error) && error.status === 403
            ? "PERMISSION_MISSING"
            : isDiscordFailure(error) && error.status === 404
              ? "UNAVAILABLE"
              : "UNKNOWN";
        return null;
      }
    };
    const [
      guild,
      channels,
      member,
      roles,
      threads,
      onboarding,
      rules,
      welcome,
      events,
    ] = await Promise.all([
      read<{
        features: string[];
        approximate_member_count?: number;
        afk_channel_id: string | null;
        incidents_data?: Record<string, string | null>;
      }>("guild", `/guilds/${guildId}?with_counts=true`),
      read<RawChannel[]>("channels", `/guilds/${guildId}/channels`),
      read<{ roles: string[] }>(
        "member",
        `/guilds/${guildId}/members/${this.botId}`,
      ),
      read<Role[]>("roles", `/guilds/${guildId}/roles`),
      read<{ threads: RawChannel[] }>(
        "threads",
        `/guilds/${guildId}/threads/active`,
      ),
      read<NativeOnboarding>("onboarding", `/guilds/${guildId}/onboarding`),
      read<{ id: string }[]>(
        "autoMod",
        `/guilds/${guildId}/auto-moderation/rules`,
      ),
      read<{ welcome_channels: { channel_id: string }[] }>(
        "welcome",
        `/guilds/${guildId}/welcome-screen`,
      ),
      read<
        {
          id: string;
          channel_id: string | null;
          entity_type: number;
          status: number;
        }[]
      >("events", `/guilds/${guildId}/scheduled-events`),
    ]);
    if (endpointStatus.guild !== "AVAILABLE")
      throw new DiscordFailure(
        endpointStatus.guild === "PERMISSION_MISSING" ? 403 : 503,
      );
    if (!roles || !member) endpointStatus.channels = "UNKNOWN";
    const incidents: Record<string, string | null> = {};
    for (const key of [
      "invites_disabled_until",
      "dms_disabled_until",
      "dm_spam_detected_at",
      "raid_detected_at",
    ])
      incidents[key] = guild?.incidents_data?.[key] ?? null;
    const bits = (roles ?? [])
        .filter((r) => r.id === guildId || member?.roles.includes(r.id))
        .reduce((p, r) => p | BigInt(r.permissions), 0n),
      can = (p: bigint) =>
        Boolean(bits & PermissionFlagsBits.Administrator || bits & p);
    return {
      botPermissions:
        roles && member
          ? {
              manageGuild: can(PermissionFlagsBits.ManageGuild),
              manageRoles: can(PermissionFlagsBits.ManageRoles),
              sendMessages: can(PermissionFlagsBits.SendMessages),
              highestRolePosition: roles
                .filter((r) => member.roles.includes(r.id))
                .reduce<number | null>(
                  (n, r) => Math.max(n ?? 0, r.position),
                  null,
                ),
            }
          : undefined,
      features: guild?.features ?? [],
      memberCount: guild?.approximate_member_count ?? null,
      afkChannelId: guild?.afk_channel_id ?? null,
      incidents,
      endpointStatus,
      ruleCount: rules?.length ?? null,
      welcomeCount: welcome?.welcome_channels.length ?? null,
      channels: (channels ?? []).map((c) => ({
        id: c.id,
        type: c.type,
        parentId: c.parent_id ?? null,
        observable:
          roles && member
            ? observableChannel(c, guildId, this.botId, roles, member.roles)
            : false,
        tagIds: (c.available_tags ?? []).map((t) => t.id),
      })),
      threads: (threads?.threads ?? [])
        .filter((t) => t.parent_id && t.type !== 12)
        .map((t) => ({
          id: t.id,
          parentId: t.parent_id!,
          type: t.type,
          ownerHash: t.owner_id ? hashOwner(t.owner_id) : null,
          archived: t.thread_metadata?.archived ?? false,
          locked: t.thread_metadata?.locked ?? false,
          createdAt: t.thread_metadata?.create_timestamp ?? null,
          tagIds: t.applied_tags ?? [],
        })),
      onboarding: onboarding
        ? {
            enabled: onboarding.enabled,
            mode: onboarding.mode,
            defaultChannelIds: onboarding.default_channel_ids,
            prompts: onboarding.prompts.map((p) => ({
              id: p.id,
              required: p.required,
              inOnboarding: p.in_onboarding,
              options: p.options.map((o) => ({
                id: o.id,
                channelIds: o.channel_ids,
                roleIds: o.role_ids,
              })),
            })),
          }
        : null,
      scheduledEvents: (events ?? []).map((e) => ({
        id: e.id,
        channelId: e.channel_id,
        entityType: e.entity_type,
        status: e.status,
      })),
    };
  }
  async registerCommands(guildId: string, commands: unknown[]) {
    await this.request(
      `/applications/${this.botId}/guilds/${guildId}/commands`,
      "PUT",
      commands,
    );
  }
  async commandsMatch(guildId: string, commands: unknown[]) {
    const actual = await this.request<Record<string, unknown>[]>(
      `/applications/${this.botId}/guilds/${guildId}/commands?with_localizations=true`,
    );
    const matches = (found: unknown, expected: unknown): boolean => {
      if (Array.isArray(expected))
        return (
          Array.isArray(found) &&
          found.length === expected.length &&
          expected.every((item, index) => matches(found[index], item))
        );
      if (expected && typeof expected === "object") {
        if (!found || typeof found !== "object") return false;
        return Object.entries(expected)
          .filter(([key]) =>
            [
              "type",
              "name",
              "name_localizations",
              "description",
              "description_localizations",
              "required",
              "options",
              "choices",
              "min_value",
              "max_value",
              "min_length",
              "max_length",
            ].includes(key),
          )
          .every(([key, value]) =>
            matches((found as Record<string, unknown>)[key], value),
          );
      }
      return found === expected;
    };
    return (
      actual.length === commands.length &&
      commands.every((expected) => {
        const item = expected as Record<string, unknown>,
          found = actual.find((row) => row.name === item.name);
        return found && matches(found, expected);
      })
    );
  }
  private async requestMessage<T>(
    path: string,
    method: string,
    body: unknown,
    files?: DiscordAttachment[],
    applicationId = this.botId,
  ): Promise<T> {
    const config = readApplicationEmojiConfig();
    return this.request<T>(
      path,
      method,
      body,
      files,
      config.applicationId === this.botId && applicationId === this.botId
        ? config
        : undefined,
    );
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    files?: DiscordAttachment[],
    emojiConfig?: ApplicationEmojiConfig,
    writeOnce = false,
    beforeDispatch?: () => Promise<void>,
    retryRateLimits = true,
  ): Promise<T> {
    return traceStep("discord.rest", { stage: method }, () =>
      this.requestInternal<T>(
        path,
        method,
        body,
        files,
        emojiConfig,
        writeOnce,
        beforeDispatch,
        retryRateLimits,
      ),
    );
  }
  private async requestInternal<T>(
    path: string,
    method = "GET",
    body?: unknown,
    files?: DiscordAttachment[],
    emojiConfig?: ApplicationEmojiConfig,
    writeOnce = false,
    beforeDispatch?: () => Promise<void>,
    retryRateLimits = true,
  ): Promise<T> {
    let emojiFallbackUsed = false;
    const route = this.route(path, method),
      signal = AbortSignal.timeout(20000);
    const retrySafe =
      !writeOnce &&
      (method === "GET" ||
        method === "PUT" ||
        method === "DELETE" ||
        method === "PATCH" ||
        (method === "POST" &&
          typeof body === "object" &&
          body !== null &&
          "enforce_nonce" in body &&
          (body as { enforce_nonce?: unknown }).enforce_nonce === true));
    // Serialize each route, including the discovery request before Discord sends a bucket.
    // Known routes sharing a bucket also serialize against one another.
    const routeLock = this.acquire(route.key);
    let bucketLock: ReturnType<DiscordRest["acquire"]> | undefined;
    try {
      await this.waitFor(routeLock.previous, signal);
      const observed = this.routeBuckets.get(route.key);
      if (observed && observed !== route.key) {
        bucketLock = this.acquire(observed);
        await this.waitFor(bucketLock.previous, signal);
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const bucket = this.routeBuckets.get(route.key) ?? route.key;
        await this.waitForCooldown(
          Math.max(this.globalUntil, this.bucketUntil.get(bucket) ?? 0),
          signal,
        );
        let res: Response;
        await beforeDispatch?.();
        try {
          res = await fetch(`https://discord.com/api/v10${path}`, {
            method,
            headers: {
              Authorization: `Bot ${this.token}`,
              ...(files?.length ? {} : { "Content-Type": "application/json" }),
            },
            body:
              body === undefined
                ? undefined
                : files?.length
                  ? discordMultipart(body, files)
                  : JSON.stringify(body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
          });
        } catch (error) {
          const failure = new DiscordFailure(0, 0, {
            kind:
              signal.aborted ||
              (error instanceof Error && /abort|timeout/i.test(error.name))
                ? "timeout"
                : "network",
            routeCategory: route.category,
          });
          if (retrySafe && attempt < 2 && !signal.aborted) {
            await this.waitForCooldown(
              Date.now() + Math.min(1000, 250 * 2 ** attempt),
              signal,
            );
            continue;
          }
          throw failure;
        }
        const bucketId = res.headers.get("x-ratelimit-bucket"),
          scope = res.headers.get("x-ratelimit-scope");
        const bucketKey = bucketId ? `${bucketId}:${route.major}` : bucket;
        if (bucketId) this.routeBuckets.set(route.key, bucketKey);
        const resetAfterHeader = res.headers.get("x-ratelimit-reset-after"),
          absoluteResetHeader = res.headers.get("x-ratelimit-reset");
        const resetAfter =
            resetAfterHeader === null ? NaN : Number(resetAfterHeader),
          absoluteReset =
            absoluteResetHeader === null ? NaN : Number(absoluteResetHeader);
        const resetMs =
          Number.isFinite(resetAfter) && resetAfter >= 0
            ? resetAfter * 1000
            : Number.isFinite(absoluteReset)
              ? Math.max(0, absoluteReset * 1000 - Date.now())
              : 0;
        if (res.headers.get("x-ratelimit-remaining") === "0" && resetMs > 0)
          this.bucketUntil.set(
            bucketKey,
            Math.max(
              this.bucketUntil.get(bucketKey) ?? 0,
              Date.now() + resetMs,
            ),
          );
        if (res.ok) {
          if (res.status === 204) return undefined as T;
          try {
            return (await res.json()) as T;
          } catch {
            throw new DiscordFailure(res.status, 0, {
              routeCategory: route.category,
            });
          }
        }
        if (res.status === 400 && emojiConfig && !emojiFallbackUsed) {
          let fallback: unknown = null;
          try {
            fallback = fallbackRejectedApplicationEmoji(
              body,
              await res.json(),
              emojiConfig,
            );
          } catch {
            // Malformed error bodies are never logged or treated as emoji failures.
          }
          if (fallback !== null) {
            body = fallback;
            emojiFallbackUsed = true;
            // A definitive validation rejection did not create/update a message.
            // Keep the same lock, deadline and transport retry budget; retry only
            // the display payload, never an interaction's business operation.
            attempt--;
            continue;
          }
        }
        const retryHeader = res.headers.get("retry-after");
        let retryAfter = retryHeader === null ? NaN : Number(retryHeader);
        let bodyRetry: number | undefined;
        let bodyGlobal = false;
        if (res.status === 429)
          try {
            const data = (await res.json()) as {
              retry_after?: number;
              global?: boolean;
            };
            bodyRetry = data.retry_after;
            bodyGlobal = data.global === true;
          } catch {
            /* Response body is never logged. */
          }
        if (!Number.isFinite(retryAfter) || retryAfter < 0)
          retryAfter =
            bodyRetry !== undefined &&
            Number.isFinite(bodyRetry) &&
            bodyRetry >= 0
              ? bodyRetry
              : 1;
        const isGlobal =
          res.status === 429 && (bodyGlobal || scope === "global");
        const failure = new DiscordFailure(
          res.status,
          res.status === 429 ? retryAfter : 0,
          {
            rateLimitScope: scope,
            bucket: bucketId,
            routeCategory: route.category,
            isGlobal,
          },
        );
        if (res.status === 429) {
          const until = Date.now() + Math.max(0, retryAfter * 1000);
          if (isGlobal) this.globalUntil = Math.max(this.globalUntil, until);
          else
            this.bucketUntil.set(
              bucketKey,
              Math.max(this.bucketUntil.get(bucketKey) ?? 0, until),
            );
        }
        if (
          ((res.status === 429 && retryRateLimits) ||
            (res.status >= 500 && retrySafe)) &&
          attempt < 2
        ) {
          const delay =
            res.status === 429
              ? retryAfter * 1000
              : Math.min(1000, 250 * 2 ** attempt);
          if (delay >= 8000 || signal.aborted) throw failure;
          await this.waitForCooldown(Date.now() + delay, signal);
          continue;
        }
        throw failure;
      }
      throw new DiscordFailure(429, 0, { routeCategory: route.category });
    } finally {
      bucketLock?.release();
      routeLock.release();
    }
  }
  private acquire(key: string) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let done!: () => void;
    const current = new Promise<void>((resolve) => {
      done = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    return {
      previous,
      release: () => {
        done();
        if (this.locks.get(key) === tail) this.locks.delete(key);
      },
    };
  }
  private route(path: string, method: string) {
    const parts = path.split("?")[0]!.split("/").filter(Boolean),
      category =
        parts[0] === "webhooks"
          ? "webhook"
          : parts[0] === "applications"
            ? "commands"
            : parts[0] === "guilds"
              ? (parts[2] ?? "guild")
              : parts[0] === "channels"
                ? (parts[2] ?? "channel")
                : (parts[0] ?? "unknown");
    const major =
      parts[0] === "guilds" || parts[0] === "channels"
        ? (parts[1] ?? "")
        : parts[0] === "webhooks"
          ? `${parts[1] ?? ""}:${createHash("sha256")
              .update(parts[2] ?? "")
              .digest("hex")
              .slice(0, 12)}`
          : "";
    const normalized = parts
      .map((part, index) =>
        index === 1 && major
          ? part
          : /^\d{17,20}$/.test(part)
            ? ":id"
            : parts[0] === "webhooks" && index === 2
              ? ":token"
              : part,
      )
      .join("/");
    return { key: `${method}:${normalized}:${major}`, major, category };
  }
  private async waitFor(promise: Promise<void>, signal: AbortSignal) {
    if (signal.aborted) throw new DiscordFailure(0, 0, { kind: "timeout" });
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new DiscordFailure(0, 0, { kind: "timeout" }));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      await Promise.race([promise, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  private async waitForCooldown(until: number, signal: AbortSignal) {
    const ms = until - Date.now();
    if (ms <= 0) return;
    await this.waitFor(
      new Promise((resolve) => setTimeout(resolve, ms)),
      signal,
    );
  }
  async roles(guildId: string) {
    return this.request<Role[]>(`/guilds/${guildId}/roles`);
  }
  /** Existing role/channel metadata endpoints only. No member request or
   * message read, and no member overwrite identifier leaves this boundary. */
  async roleChannelMetadata(guildId:string,channelId:string):Promise<RoleChannelMetadata>{
    assert(/^\d{17,20}$/.test(guildId)&&/^\d{17,20}$/.test(channelId),"ROLE_ACCESS_TARGET_INVALID",400);
    const [channel,roles]=await Promise.all([this.request<unknown>(`/channels/${channelId}`),this.roles(guildId)]);
    return roleChannelMetadata(guildId,channelId,channel,roles,new Date());
  }
  async options(guildId: string): Promise<DiscordEntityOptions> {
    const [channels, roles, events] = await Promise.all([
      this.request<
        {
          id: string;
          name: string;
          type: number;
          available_tags?: { id: string; name: string }[];
        }[]
      >(`/guilds/${guildId}/channels`),
      this.roles(guildId),
      this.request<{ id: string; name: string; status: number }[]>(
        `/guilds/${guildId}/scheduled-events`,
      ),
    ]);
    return {
      channels: channels
        .filter((c) => c.type === 0 || c.type === 5)
        .map((c) => ({ id: c.id, label: `#${c.name}` })),
      surfaces: channels
        .filter((c) => [0, 2, 4, 5, 13, 15, 16].includes(c.type))
        .map((c) => ({ id: c.id, label: `#${c.name}`, type: c.type })),
      forumTags: channels.flatMap((c) =>
        (c.available_tags ?? []).map((tag) => ({
          channelId: c.id,
          id: tag.id,
          label: tag.name,
        })),
      ),
      roles: roles
        .filter((r) => r.id !== guildId && !r.managed)
        .map((r) => ({ id: r.id, label: `@${r.name ?? "role"}` })),
      events: events
        .filter((e) => e.status === 1 || e.status === 2)
        .map((e) => ({ id: e.id, label: e.name })),
    };
  }
  async memberSnapshot(guildId: string, userId: string): Promise<Member> {
    const raw = z
      .object({
        roles: z.array(z.string()),
        joined_at: z.string().nullable(),
        flags: z.number().int().nonnegative().optional(),
        pending: z.boolean().optional(),
        user: z.object({ bot: z.boolean().optional() }).optional(),
      })
      .parse(await this.request(`/guilds/${guildId}/members/${userId}`));
    return {
      roles: raw.roles,
      joinedAt: raw.joined_at ?? "",
      permissions: "0",
      bot: raw.user?.bot ?? false,
      flags: raw.flags === undefined ? undefined : String(raw.flags),
      pending: raw.pending ?? null,
    };
  }
  async nativeState(guildId: string): Promise<GuildNativeState> {
    const guild = z
      .object({ features: z.array(z.string()) })
      .parse(await this.request(`/guilds/${guildId}`));
    const bot = await this.member(guildId, this.botId);
    const roles = await this.roles(guildId);
    let onboarding: NativeOnboarding | null = null;
    try {
      onboarding = nativeOnboardingSchema.parse(
        await this.request(`/guilds/${guildId}/onboarding`),
      );
    } catch (error) {
      if (
        !(error instanceof DiscordFailure) ||
        ![403, 404].includes(error.status)
      )
        throw error;
    }
    return {
      features: guild.features,
      onboarding,
      bot,
      roles,
      onboardingStatus: onboarding ? "available" : "unavailable",
    };
  }
  async member(guildId: string, userId: string): Promise<Member> {
    const [raw, roles, guild] = await Promise.all([
      this.request<{
        roles: string[];
        joined_at: string | null;
        flags?: number;
        pending?: boolean;
        user: { bot?: boolean };
      }>(`/guilds/${guildId}/members/${userId}`),
      this.roles(guildId),
      this.request<{ owner_id: string; name?: string }>(`/guilds/${guildId}`),
    ]);
    let permissions = 0n;
    for (const role of roles)
      if (role.id === guildId || raw.roles.includes(role.id))
        permissions |= BigInt(role.permissions);
    if (userId === guild.owner_id)
      permissions |= PermissionFlagsBits.Administrator;
    return {
      roles: raw.roles,
      permissions: permissions.toString(),
      joinedAt: raw.joined_at ?? "",
      flags: raw.flags === undefined ? undefined : String(raw.flags),
      pending: raw.pending,
      bot: raw.user.bot ?? false,
      guildName: guild.name,
      ownerId: guild.owner_id,
    };
  }
  async checkChannel(guildId: string, channelId: string) {
    let channel: {
      guild_id: string;
      type: number;
      permission_overwrites: {
        id: string;
        type: number;
        allow: string;
        deny: string;
      }[];
    };
    try {
      channel = await this.request(`/channels/${channelId}`);
    } catch (error) {
      if (error instanceof DiscordFailure && [403, 404].includes(error.status))
        assert(false, "INVALID_START_CHANNEL");
      throw error;
    }
    const bot = await this.member(guildId, this.botId);
    assert(
      channel.guild_id === guildId &&
        (channel.type === 0 || channel.type === 5),
      "INVALID_START_CHANNEL",
    );
    let bits = BigInt(bot.permissions);
    if ((bits & PermissionFlagsBits.Administrator) === 0n) {
      const everyone = channel.permission_overwrites.find(
        (o) => o.id === guildId,
      );
      if (everyone)
        bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
      let deny = 0n,
        allow = 0n;
      for (const o of channel.permission_overwrites)
        if (o.type === 0 && bot.roles.includes(o.id)) {
          deny |= BigInt(o.deny);
          allow |= BigInt(o.allow);
        }
      bits = (bits & ~deny) | allow;
      const personal = channel.permission_overwrites.find(
        (o) => o.type === 1 && o.id === this.botId,
      );
      if (personal)
        bits = (bits & ~BigInt(personal.deny)) | BigInt(personal.allow);
      assert(
        (bits & PermissionFlagsBits.ViewChannel) !== 0n &&
          (bits & PermissionFlagsBits.SendMessages) !== 0n,
        "CHANNEL_PERMISSION_MISSING",
      );
    }
  }
  async canReadAttentionChannel(
    guildId: string,
    channelId: string,
    userId: string,
    member: Member,
  ) {
    // Read channel metadata only. No message content or new collection is requested.
    try {
      let channel = await this.request<RawChannel & { guild_id: string }>(
        `/channels/${channelId}`,
      );
      if (channel.guild_id !== guildId || channel.type === 12) return false;
      if ([10, 11].includes(channel.type)) {
        if (!channel.parent_id) return false;
        channel = await this.request<RawChannel & { guild_id: string }>(
          `/channels/${channel.parent_id}`,
        );
        if (channel.guild_id !== guildId) return false;
      }
      return canReadPostMetadata(channel, guildId, userId, member);
    } catch (error) {
      if (isDiscordFailure(error) && [403, 404].includes(error.status))
        return false;
      throw error;
    }
  }
  async channelVisibility(
    guildId: string,
    channelId: string,
  ): Promise<"everyone_visible" | "restricted" | "unknown"> {
    const [channel, roles] = await Promise.all([
      this.request<{
        guild_id: string;
        permission_overwrites: {
          id: string;
          type: number;
          allow: string;
          deny: string;
        }[];
      }>(`/channels/${channelId}`),
      this.roles(guildId),
    ]);
    assert(channel.guild_id === guildId, "INVALID_START_CHANNEL");
    const everyone = roles.find((role) => role.id === guildId);
    if (!everyone) return "unknown";
    let bits = BigInt(everyone.permissions);
    const overwrite = channel.permission_overwrites.find(
      (row) => row.id === guildId,
    );
    if (overwrite)
      bits = (bits & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
    return (bits & PermissionFlagsBits.ViewChannel) !== 0n
      ? "everyone_visible"
      : "restricted";
  }
  async publicChannel(guildId: string, channelId: string) {
    return (await this.channelVisibility(guildId, channelId)) !== "restricted";
  }
  async validateRole(guildId: string, roleId: string) {
    const [roles, bot] = await Promise.all([
      this.roles(guildId),
      this.member(guildId, this.botId),
    ]);
    const role = roles.find((r) => r.id === roleId);
    const highest = Math.max(
      0,
      ...roles.filter((r) => bot.roles.includes(r.id)).map((r) => r.position),
    );
    const bits = BigInt(bot.permissions);
    assert(
      (bits & PermissionFlagsBits.ManageRoles) !== 0n ||
        (bits & PermissionFlagsBits.Administrator) !== 0n,
      "MANAGE_ROLES_MISSING",
    );
    assert(
      role && !role.managed && role.id !== guildId && role.position < highest,
      "ROLE_NOT_MANAGEABLE",
    );
    const elevated =
      PermissionFlagsBits.Administrator |
      PermissionFlagsBits.ManageGuild |
      PermissionFlagsBits.ManageRoles |
      PermissionFlagsBits.ManageChannels |
      PermissionFlagsBits.BanMembers |
      PermissionFlagsBits.KickMembers |
      PermissionFlagsBits.ManageWebhooks;
    assert(
      (BigInt(role.permissions) & elevated) === 0n,
      "PRIVILEGED_ROLE_MAPPING_FORBIDDEN",
    );
  }
  private async automationCategoryPolicy(guildId: string, parentId: string) {
    const reference = z.string().regex(/^\d{17,20}$/);
    const bits = z.string().regex(/^(0|[1-9]\d{0,77})$/);
    const parsed = z
      .object({
        id: reference,
        guild_id: reference,
        type: z.literal(4),
        permission_overwrites: z
          .array(
            z.object({
              id: reference,
              type: z.union([z.literal(0), z.literal(1)]),
              allow: bits,
              deny: bits,
            }),
          )
          .max(100),
        nsfw: z.boolean().optional(),
      })
      .safeParse(await this.request<unknown>(`/channels/${parentId}`));
    assert(parsed.success, "AUTOMATION_PARENT_POLICY_UNVERIFIED", 503);
    const policy = parsed.data;
    assert(
      policy.id === parentId && policy.guild_id === guildId,
      "AUTOMATION_TARGET_GUILD",
      403,
    );
    const seen = new Set<string>(),
      maximumBits = (1n << 256n) - 1n;
    for (const item of policy.permission_overwrites) {
      assert(!seen.has(item.id), "AUTOMATION_PARENT_POLICY_UNVERIFIED", 503);
      seen.add(item.id);
      const allow = BigInt(item.allow),
        deny = BigInt(item.deny);
      assert(
        allow <= maximumBits && deny <= maximumBits && (allow & deny) === 0n,
        "AUTOMATION_PARENT_POLICY_UNVERIFIED",
        503,
      );
    }
    // Order does not affect Discord's overwrite semantics. All values themselves must match.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...policy,
          permission_overwrites: [...policy.permission_overwrites].sort(
            (a, b) => a.type - b.type || a.id.localeCompare(b.id),
          ),
        }),
      )
      .digest("hex");
    return { ...policy, fingerprint };
  }
  private async automationCategoryCopyPermission(
    guildId: string,
    overwrites: { allow: string; deny: string }[],
  ) {
    const currentBot = await this.member(guildId, this.botId);
    assert(
      currentBot.bot && /^(0|[1-9]\d{0,77})$/.test(currentBot.permissions),
      "AUTOMATION_BOT_PERMISSION",
      403,
    );
    const bits = BigInt(currentBot.permissions);
    if ((bits & PermissionFlagsBits.Administrator) !== 0n) return;
    assert(
      (bits & PermissionFlagsBits.ManageChannels) !== 0n,
      "AUTOMATION_BOT_PERMISSION",
      403,
    );
    if (!overwrites.length) return;
    assert(
      (bits & PermissionFlagsBits.ManageRoles) !== 0n,
      "AUTOMATION_BOT_PERMISSION",
      403,
    );
    for (const item of overwrites) {
      const changed = BigInt(item.allow) | BigInt(item.deny);
      // Discord permits only native guild permissions, and only Administrator may
      // set ManageRoles in channel overwrites. Never omit an uncopyable overwrite.
      assert(
        (changed & ~bits) === 0n &&
          (changed & PermissionFlagsBits.ManageRoles) === 0n,
        "AUTOMATION_PARENT_POLICY_UNCOPYABLE",
        403,
      );
    }
  }
  /** Fixed alpha15 routes: only server-derived category overwrites; no ambiguous write retry. */
  async automationWrite(
    input: AutomationDiscordWrite,
    beforeDispatch: () => Promise<void>,
  ) {
    const reference = z.string().regex(/^\d{17,20}$/);
    reference.parse(input.guildId);
    let legacy:CompiledLegacyMessage|undefined;
    if (input.kind === "message"||input.kind==='editMessage') {
      z.object({kind:z.enum(['message','editMessage']),guildId:reference,channelId:reference,content:z.string().min(1).max(2000).optional(),messageSpec:z.unknown().optional(),nonce:z.string().min(1).max(128).optional(),messageId:reference.optional()}).strict().parse(input);
      assert((input.content!==undefined)!==(input.messageSpec!==undefined),'AUTOMATION_MESSAGE_MODE');
      if(input.messageSpec!==undefined)legacy=validateCompiledLegacyMessage(input.messageSpec);
      if(input.kind==='message'){z.string().min(1).max(128).parse(input.nonce);assert(!Object.hasOwn(input,'messageId'),'AUTOMATION_MESSAGE_INVALID');}
      else {reference.parse(input.messageId);assert(!Object.hasOwn(input,'nonce'),'AUTOMATION_MESSAGE_INVALID');}
    } else if (input.kind === "role") {
      reference.parse(input.memberId);
      reference.parse(input.roleId);
      z.boolean().parse(input.add);
        z.object({kind:z.literal('role'),guildId:reference,memberId:reference,roleId:reference,add:z.boolean()}).strict().parse(input);
    } else {
      z.enum(["channel", "thread"]).parse(input.kind);
      reference.parse(
        input.kind === "channel" ? input.parentId : input.channelId,
      );
      z.string().trim().min(1).max(100).parse(input.name);
      if (input.kind === "channel")
        z.object({
          kind: z.literal("channel"),
          guildId: reference,
          parentId: reference,
          name: z.string().trim().min(1).max(100),
        })
          .strict()
          .parse(input);
    }
    const once = async <T>(
      path: string,
      method: string,
      body?: unknown,
      guard = beforeDispatch,
    ) => this.request<T>(path, method, body, undefined, undefined, true, guard);
    if (input.kind === "message") {
      const result = await once<{ id: string }>(
        `/channels/${input.channelId}/messages`,
        "POST",
        {
            ...(legacy??{content:input.content,allowed_mentions:{parse:[],replied_user:false}}),
          nonce: input.nonce.slice(0, 25),
          enforce_nonce: true,
        },
      );
      assert(/^\d{17,20}$/.test(result.id), "AUTOMATION_RESULT_INVALID");
      return result.id;
    }
    if(input.kind==='editMessage'){
      const body=legacy??{content:input.content,allowed_mentions:{parse:[],replied_user:false}};
      const result=await once<{id:string}>(`/channels/${input.channelId}/messages/${input.messageId}`,'PATCH',{...body,content:body.content??'',embeds:legacy?.embeds??[]});
      assert(result.id===input.messageId,'AUTOMATION_RESULT_INVALID');return result.id;
    }
    if (input.kind === "role") {
      await once(
        `/guilds/${input.guildId}/members/${input.memberId}/roles/${input.roleId}`,
        input.add ? "PUT" : "DELETE",
      );
      return null;
    }
    let result: { id: string };
    if (input.kind === "channel") {
      const policy = await this.automationCategoryPolicy(
        input.guildId,
        input.parentId,
      );
      const guard = async () => {
        // The caller verifies the actual actor, Bot, current flow and cancellation.
        await beforeDispatch();
        try {
          const [latest] = await Promise.all([
            this.automationCategoryPolicy(input.guildId, input.parentId),
            this.automationCategoryCopyPermission(
              input.guildId,
              policy.permission_overwrites,
            ),
          ]);
          assert(
            latest.fingerprint === policy.fingerprint,
            "AUTOMATION_PARENT_POLICY_CHANGED",
            409,
          );
        } catch (error) {
          // This brand must never wrap the POST, its response parsing or result checks.
          throw new DiscordWriteNotStartedError(
            isDomainError(error)
              ? error.code
              : "AUTOMATION_PARENT_POLICY_UNVERIFIED",
          );
        }
      };
      result = await once<{ id: string }>(
        `/guilds/${input.guildId}/channels`,
        "POST",
        {
          name: input.name,
          type: 0,
          parent_id: input.parentId,
          permission_overwrites: policy.permission_overwrites,
          ...(policy.nsfw === undefined ? {} : { nsfw: policy.nsfw }),
        },
        guard,
      );
    } else
      result = await once<{ id: string }>(
        `/channels/${input.channelId}/threads`,
        "POST",
        { name: input.name, type: 11, auto_archive_duration: 1440 },
      );
    assert(/^\d{17,20}$/.test(result.id), "AUTOMATION_RESULT_INVALID");
    return result.id;
  }
  async automationPreflight(
    guildId: string,
    actorId: string,
    kind: "message" | "thread" | "channel",
    channelId: string,
  ) {
    const reference = z.string().regex(/^\d{17,20}$/);
    reference.parse(guildId);
    reference.parse(actorId);
    reference.parse(channelId);
    z.enum(["message", "thread", "channel"]).parse(kind);
    const channel = await this.request<{
      guild_id: string;
      type: number;
      permission_overwrites?: {
        id: string;
        type: number;
        allow: string;
        deny: string;
      }[];
    }>(`/channels/${channelId}`);
    assert(channel.guild_id === guildId, "AUTOMATION_TARGET_GUILD", 403);
    assert(
      kind === "channel"
        ? channel.type === 4
        : kind === "thread"
          ? channel.type === 0
          : [0, 5].includes(channel.type),
      "AUTOMATION_CHANNEL_TYPE",
    );
    assert(
      Array.isArray(channel.permission_overwrites),
      "AUTOMATION_PERMISSIONS_UNVERIFIED",
      503,
    );
    const [bot, actor] = await Promise.all([
      this.member(guildId, this.botId),
      this.member(guildId, actorId),
    ]);
    const effective = (member: Member, userId: string) => {
      let bits = BigInt(member.permissions);
      if ((bits & PermissionFlagsBits.Administrator) !== 0n)
        return (
          bits |
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.ManageChannels |
          PermissionFlagsBits.CreatePublicThreads
        );
      const overwrites = channel.permission_overwrites ?? [];
      const everyone = overwrites.find(
        (item) => item.id === guildId && item.type === 0,
      );
      if (everyone)
        bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
      let deny = 0n,
        allow = 0n;
      for (const item of overwrites)
        if (item.type === 0 && member.roles.includes(item.id)) {
          deny |= BigInt(item.deny);
          allow |= BigInt(item.allow);
        }
      bits = (bits & ~deny) | allow;
      const personal = overwrites.find(
        (item) => item.type === 1 && item.id === userId,
      );
      return personal
        ? (bits & ~BigInt(personal.deny)) | BigInt(personal.allow)
        : bits;
    };
    const botBits = effective(bot, this.botId),
      actorBits = effective(actor, actorId);
    assert(
      !actor.bot && (actorBits & PermissionFlagsBits.ViewChannel) !== 0n,
      "AUTOMATION_TARGET_PERMISSION",
      403,
    );
    const required =
      PermissionFlagsBits.ViewChannel |
      (kind === "message"
        ? PermissionFlagsBits.SendMessages
        : kind === "thread"
          ? PermissionFlagsBits.CreatePublicThreads |
            PermissionFlagsBits.SendMessages
          : PermissionFlagsBits.ManageChannels);
    assert((botBits & required) === required, "AUTOMATION_BOT_PERMISSION", 403);
    // Channel creation is a native administrative operation; delegated data access alone does not grant it.
    if (kind === "channel")
      assert(
        (actorBits & PermissionFlagsBits.ManageChannels) !== 0n,
        "AUTOMATION_TARGET_PERMISSION",
        403,
      );
  }
  async automationRolePreflight(input:AutomationRolePolicyInput):Promise<AutomationRolePolicy> {
    const reference=z.string().regex(/^\d{17,20}$/);
    const parsed=z.object({guildId:reference,memberId:reference,roleId:reference,add:z.boolean(),requesterId:reference,approverId:reference,protectedRoleIds:z.array(reference).max(100)}).strict().parse(input);
    const coverage=roleCoverage(parsed.guildId);
    const [rawRoles,requester,approver,target,bot,rawChannels]=await Promise.all([
      this.roles(parsed.guildId),this.member(parsed.guildId,parsed.requesterId),this.member(parsed.guildId,parsed.approverId),this.member(parsed.guildId,parsed.memberId),this.member(parsed.guildId,this.botId),this.request<unknown>(`/guilds/${parsed.guildId}/channels`),
    ]);
    const permission=z.string().regex(/^\d+$/);
    const parsedRoles=z.array(z.object({id:reference,position:z.number().int().nonnegative(),managed:z.boolean(),permissions:permission,tags:z.record(z.string(),z.unknown()).optional()})).safeParse(rawRoles);
    assert(parsedRoles.success&&new Set(parsedRoles.data.map(role=>role.id)).size===parsedRoles.data.length,'AUTOMATION_PERMISSIONS_UNVERIFIED',503);
    const roles=parsedRoles.data;
    const channels=z.array(z.object({id:reference,guild_id:reference.optional(),type:z.number().int().min(0),flags:z.number().int().nonnegative().optional(),permission_overwrites:z.array(z.object({id:reference,type:z.union([z.literal(0),z.literal(1)]),allow:permission,deny:permission})).max(1000)})).max(1000).safeParse(rawChannels);
    assert(channels.success,'AUTOMATION_PERMISSIONS_UNVERIFIED',503);
    assert(channels.data.every(channel=>(channel.guild_id===undefined||channel.guild_id===parsed.guildId)&&[0,2,4,5,13,15,16].includes(channel.type)&&(BigInt(channel.flags??0)&(1n<<17n))===0n&&new Set(channel.permission_overwrites.map(overwrite=>overwrite.type+':'+overwrite.id)).size===channel.permission_overwrites.length&&channel.permission_overwrites.every(overwrite=>(BigInt(overwrite.allow)&BigInt(overwrite.deny))===0n)),'AUTOMATION_PERMISSIONS_UNVERIFIED',503);
    assertRoleCoverage(parsed.guildId,coverage,channels.data.map(channel=>channel.id));
    const result=evaluateAutomationRolePolicy(parsed,this.botId,roles,{requester,approver,target,bot},channels.data as RolePolicyChannel[]);
    assertRoleCoverage(parsed.guildId,coverage,channels.data.map(channel=>channel.id));
    return result;
  }
  async addRole(guildId: string, userId: string, roleId: string) {
    await this.request(
      `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      "PUT",
    );
  }
  async removeRole(guildId: string, userId: string, roleId: string) {
    await this.request(
      `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      "DELETE",
    );
  }
  async installationSystemChannel(guildId: string) {
    assert(/^\d{17,20}$/.test(guildId), "INVALID_INSTALL_NOTICE_GUILD");
    const guild = await this.request<{ id?: unknown; system_channel_id?: unknown }>(
      `/guilds/${guildId}`,
    );
    assert(
      guild?.id === guildId &&
        (guild.system_channel_id === null ||
          (typeof guild.system_channel_id === "string" &&
            /^\d{17,20}$/.test(guild.system_channel_id))),
      "INSTALL_NOTICE_SYSTEM_CHANNEL_UNVERIFIED",
    );
    return guild.system_channel_id as string | null;
  }
  async sendInstallNotice(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
    nonce: string,
    beforeDispatch?: () => Promise<void>,
  ) {
    assert(/^\d{17,20}$/.test(channelId), "INVALID_INSTALL_NOTICE_TARGET");
    assert(
      typeof nonce === "string" && nonce.length > 0 && nonce.length <= 128,
      "INVALID_INSTALL_NOTICE_NONCE",
    );
    const result = await this.request<{ id?: unknown }>(
      `/channels/${channelId}/messages`,
      "POST",
      {
        ...body,
        allowed_mentions: { parse: [], replied_user: false },
        nonce: nonce.replaceAll("-", "").slice(0, 25),
        enforce_nonce: true,
      },
      undefined,
      undefined,
      true,
      async () => {
        try {
          await beforeDispatch?.();
        } catch (error) {
          throw isDiscordWriteNotStartedError(error)
            ? error
            : new DiscordWriteNotStartedError(
                isDomainError(error) ? error.code : "INSTALL_NOTICE_UNVERIFIED",
              );
        }
      },
      false,
    );
    // A successful HTTP status without a valid message reference cannot prove
    // whether Discord created the notice. The caller must keep it unknown.
    if (typeof result?.id !== "string" || !/^\d{17,20}$/.test(result.id))
      throw new DiscordFailure(200, 0, { routeCategory: "channel_messages" });
    return result.id;
  }
  async sendPanel(
    channelId: string,
    body: RESTPostAPIChannelMessageJSONBody,
    nonce: string,
    files?: DiscordAttachment[],
  ) {
    return (
      await this.requestMessage<{ id: string }>(
        `/channels/${channelId}/messages`,
        "POST",
        {
          ...body,
          nonce: nonce.replaceAll("-", "").slice(0, 25),
          enforce_nonce: true,
        },
        files,
      )
    ).id;
  }
  async sendDirectMessage(userId: string, text: string, nonce: string) {
    const dm = await this.request<{ id: string }>(
      "/users/@me/channels",
      "POST",
      { recipient_id: userId },
    );
    return this.sendPanel(
      dm.id,
      { content: text, allowed_mentions: { parse: [] } },
      nonce,
    );
  }
  async editPanel(
    channelId: string,
    messageId: string,
    body: RESTPostAPIChannelMessageJSONBody,
  ) {
    await this.requestMessage(
      `/channels/${channelId}/messages/${messageId}`,
      "PATCH",
      body,
    );
  }
  async deletePanel(channelId: string, messageId: string) {
    await this.request(
      `/channels/${channelId}/messages/${messageId}`,
      "DELETE",
    );
  }
  async editReply(
    applicationId: string,
    token: string,
    body: RESTPostAPIChannelMessageJSONBody,
    files?: DiscordAttachment[],
  ) {
    await this.requestMessage(
      `/webhooks/${applicationId}/${encodeURIComponent(token)}/messages/@original`,
      "PATCH",
      body,
      files,
      applicationId,
    );
  }
  async followup(
    applicationId: string,
    token: string,
    body: RESTPostAPIChannelMessageJSONBody,
  ) {
    await this.requestMessage(
      `/webhooks/${applicationId}/${encodeURIComponent(token)}`,
      "POST",
      { ...body, flags: 64 },
      undefined,
      applicationId,
    );
  }
}
export function discordMultipart(body: unknown, files: DiscordAttachment[]) {
  assert(
    files.length <= 5 &&
      files.every(
        (file) =>
          /^[a-z0-9_-]+\.(png|csv|json)$/.test(file.filename) &&
          file.data.length <= 2 * 1024 * 1024,
      ),
    "DISCORD_ATTACHMENT_INVALID",
    400,
  );
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      ...(body as object),
      attachments: files.map((file, id) => ({ id, filename: file.filename })),
    }),
  );
  files.forEach((file, id) =>
    form.set(
      `files[${id}]`,
      new Blob([Uint8Array.from(file.data)], {
        type: file.filename.endsWith(".png")
          ? "image/png"
          : file.filename.endsWith(".csv")
            ? "text/csv"
            : "application/json",
      }),
      file.filename,
    ),
  );
  return form;
}
