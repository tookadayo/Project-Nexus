import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database, type Tx } from "../../db/src/index";
import { assert, isDomainError, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import { analysisChannelScope } from "../../lifecycle/src/discovery";
import { operationsAccess } from "./policy";
import { AttentionOperations } from "./attention";
import { nextZonedDayStart } from "../../shared/src/timezones";

export const attentionPageInput = z
  .object({
    state: z
      .enum([
        "ACTIVE",
        "OPEN",
        "ACKNOWLEDGED",
        "IN_PROGRESS",
        "SNOOZED",
        "RESOLVED",
      ])
      .default("ACTIVE"),
    channelId: z
      .string()
      .regex(/^\d{17,20}$/)
      .optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
export type AttentionPageInput = z.input<typeof attentionPageInput>;
const point = z
  .object({
    at: z.string().datetime({ offset: true }),
    id: z.string().regex(/^\d{17,20}$/),
  })
  .strict();
const cursorSchema = z
  .object({
    version: z.literal(1),
    organizationId: z.uuid(),
    guildId: z.string(),
    actor: z.string(),
    state: attentionPageInput.shape.state,
    channelId: z.string().nullable(),
    limit: z.number().int(),
    asOf: z.string().datetime(),
    direction: z.enum(["first", "next", "previous"]),
    point: point.nullable(),
    includePoint: z.boolean().default(false),
    snapshotId: z.uuid(),
  })
  .strict();
const SNAPSHOT_TTL_MS = 15 * 60000;
const SNAPSHOT_MAX_ITEMS = 50000;
const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_MAX_PER_ACTOR = 8;
type PageCursor = z.infer<typeof cursorSchema>;
type Row = {
  channel_id: string;
  message_id: string;
  occurred_at: Date;
  sort_at: string;
  status: string;
  version: number;
  item_type: string;
  target_surface: string;
  opened_at: Date | null;
  snooze_until: Date | null;
  resolution_reason: string | null;
  reply: boolean;
  participation: boolean;
};
export type ReadableAttentionChannel = (channelId: string) => Promise<boolean>;

/** A cursor is a position, never a grant or a copy of a deleted post. */
export class AttentionQueue {
  constructor(
    private readonly db: Database,
    private readonly signingKey: string,
  ) {
    assert(signingKey.length >= 16, "ATTENTION_CURSOR_KEY_REQUIRED", 503);
  }
  private encode(cursor: PageCursor) {
    const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    return (
      body +
      "." +
      createHmac("sha256", this.signingKey)
        .update("attention-page:" + body)
        .digest("base64url")
    );
  }
  private decode(value: string): PageCursor {
    const [body, signature, extra] = value.split(".");
    assert(body && signature && !extra, "INVALID_ATTENTION_CURSOR", 400);
    const expected = createHmac("sha256", this.signingKey)
      .update("attention-page:" + body)
      .digest();
    const provided = Buffer.from(signature, "base64url");
    assert(
      provided.length === expected.length &&
        timingSafeEqual(provided, expected),
      "INVALID_ATTENTION_CURSOR",
      400,
    );
    try {
      return cursorSchema.parse(
        JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
      );
    } catch {
      assert(false, "INVALID_ATTENTION_CURSOR", 400);
    }
  }
  async page(
    s: Scope,
    actor: Actor,
    input: AttentionPageInput = {},
    now = new Date(),
    readable: ReadableAttentionChannel = async () => true,
  ) {
    const query = attentionPageInput.parse(input);
    const cursor = query.cursor
      ? this.decode(query.cursor)
      : {
          version: 1 as const,
          snapshotId: randomUUID(),
          ...s,
          actor: actor.key,
          state: query.state,
          channelId: query.channelId ?? null,
          limit: query.limit,
          asOf: now.toISOString(),
          direction: "first" as const,
          point: null,
          includePoint: false,
        };
    assert(
      cursor.organizationId === s.organizationId &&
        cursor.guildId === s.guildId &&
        cursor.actor === actor.key &&
        cursor.state === query.state &&
        cursor.channelId === (query.channelId ?? null) &&
        cursor.limit === query.limit,
      "INVALID_ATTENTION_CURSOR",
      400,
    );
    assert(
      new Date(cursor.asOf).getTime() <= now.getTime() + 60000 &&
        new Date(cursor.asOf).getTime() > now.getTime() - SNAPSHOT_TTL_MS,
      "ATTENTION_CURSOR_EXPIRED",
      400,
    );
    return this.db.transaction().execute(async (tx) => {
      const entitlements = await operationsAccess(
        tx,
        s,
        actor,
        "READ",
        "basic_attention",
      );
      const cfg = await new SettingsService(tx).get(s);
      const scope = await analysisChannelScope(tx, s, cfg);
      // Only channels containing matching, retained posts need a fresh Discord check.
      const cutoff = new Date(
        now.getTime() -
          Math.min(
            cfg.detailedRetentionDays,
            entitlements.limits.historyDays ?? cfg.detailedRetentionDays,
          ) *
            86400000,
      );
      const states =
        query.state === "ACTIVE"
          ? ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"]
          : [query.state];
      const retained = sql`a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND a.message_id ~ '^[0-9]{17,20}$' AND a.channel_id=ANY(${scope.actualChannelIds}::text[]) AND a.detected_at>=${cutoff}`;
      const eligible = sql`${retained} AND a.status=ANY(${states}::text[]) AND (${query.channelId === undefined} OR a.channel_id=${query.channelId ?? ""}) AND a.detected_at<=${new Date(cursor.asOf)} AND COALESCE(a.opened_at,a.detected_at)<=${new Date(cursor.asOf)}`;
      const channels = (
        await sql<{
          channel_id: string;
        }>`SELECT DISTINCT a.channel_id FROM attention_items a WHERE ${eligible}`.execute(
          tx,
        )
      ).rows;
      const visible: string[] = [];
      const checkedChannels = new Map<string, boolean>();
      const canRead = async (channelId: string) => {
        if (!checkedChannels.has(channelId))
          checkedChannels.set(channelId, await readable(channelId));
        return checkedChannels.get(channelId)!;
      };
      // Sequential checks avoid a burst of REST requests on large guilds.
      for (const channel of channels)
        if (await canRead(channel.channel_id)) visible.push(channel.channel_id);
      let memberIds: string[];
      if (query.cursor) {
        const saved = (
          await sql<{
            intent: { messageIds: string[] };
          }>`SELECT intent FROM component_tokens WHERE ${tenant(s)} AND id=${cursor.snapshotId}::uuid AND actor_hash=${actor.key} AND intent->>'kind'='attention-page' AND expires_at>${now}`.execute(
            tx,
          )
        ).rows[0];
        assert(saved, "ATTENTION_CURSOR_EXPIRED", 400);
        memberIds = saved.intent.messageIds;
      } else {
        // Capture committed membership in one statement AFTER privacyReadLock.
        // Cursor rows contain only existing IDs; current status/access/retention
        // are re-evaluated below, so updates survive and deleted data cannot return.
        memberIds = (
          await sql<{
            message_id: string;
          }>`SELECT a.message_id FROM attention_items a WHERE ${eligible} AND a.channel_id=ANY(${visible}::text[]) ORDER BY a.detected_at,a.message_id LIMIT ${SNAPSHOT_MAX_ITEMS + 1}`.execute(
            tx,
          )
        ).rows.map((row) => row.message_id);
        const intent = JSON.stringify({
          kind: "attention-page",
          messageIds: memberIds,
        });
        assert(
          memberIds.length <= SNAPSHOT_MAX_ITEMS &&
            Buffer.byteLength(intent) <= SNAPSHOT_MAX_BYTES,
          "ATTENTION_SCOPE_TOO_LARGE",
          413,
        );
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"attention-page:" + s.organizationId + ":" + s.guildId + ":" + actor.key},0))`.execute(
          tx,
        );
        // Bound metadata lifetime and concurrent tab history using the existing
        // component-token store; member deletion revokes all tenant page tokens.
        await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND actor_hash=${actor.key} AND intent->>'kind'='attention-page' AND (expires_at<=${now} OR id IN (SELECT id FROM component_tokens WHERE ${tenant(s)} AND actor_hash=${actor.key} AND intent->>'kind'='attention-page' ORDER BY expires_at DESC,id OFFSET ${SNAPSHOT_MAX_PER_ACTOR - 1}))`.execute(
          tx,
        );
        await sql`INSERT INTO component_tokens(organization_id,guild_id,id,actor_hash,intent,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${cursor.snapshotId}::uuid,${actor.key},${intent}::jsonb,${new Date(+now + SNAPSHOT_TTL_MS)})`.execute(
          tx,
        );
      }
      const allowed = sql`${eligible} AND a.channel_id=ANY(${visible}::text[]) AND a.message_id=ANY(${memberIds}::text[])`;
      const total = (
        await sql<{
          total: number;
        }>`SELECT count(*)::integer AS total FROM attention_items a WHERE ${allowed}`.execute(
          tx,
        )
      ).rows[0]!.total;
      const p = cursor.point;
      const position = !p
        ? sql`TRUE`
        : cursor.direction === "previous"
          ? sql`(a.detected_at,a.message_id)${cursor.includePoint ? sql`<=` : sql`<`}(${p.at}::timestamptz,${p.id}::text)`
          : sql`(a.detected_at,a.message_id)${cursor.includePoint ? sql`>=` : sql`>`}(${p.at}::timestamptz,${p.id}::text)`;
      const descending = cursor.direction === "previous";
      let rows = (
        await sql<Row>`SELECT a.channel_id,a.message_id,a.detected_at AS occurred_at,to_char(a.detected_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_at,a.status,a.version,a.item_type,a.target_surface,a.opened_at,a.snooze_until,a.resolution_reason,EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=a.organization_id AND f.guild_id=a.guild_id AND f.kind='message.sent' AND f.data->>'messageId'=a.message_id AND f.data->>'receivedExplicitReply'='true') AS reply,EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=a.organization_id AND f.guild_id=a.guild_id AND f.kind='message.sent' AND f.data->>'messageId'=a.message_id AND f.data->>'receivedHumanParticipant'='true') AS participation FROM attention_items a WHERE ${allowed} AND ${position} ORDER BY a.detected_at ${descending ? sql`DESC` : sql`ASC`},a.message_id ${descending ? sql`DESC` : sql`ASC`} LIMIT ${query.limit}`.execute(
          tx,
        )
      ).rows;
      if (descending) rows = rows.reverse();
      const first = rows[0],
        last = rows.at(-1);
      const before = first ? { at: first.sort_at, id: first.message_id } : p;
      const after = last ? { at: last.sort_at, id: last.message_id } : p;
      const [hasPrevious, hasNext] = await Promise.all([
        before
          ? sql`SELECT 1 FROM attention_items a WHERE ${allowed} AND (a.detected_at,a.message_id)${rows.length === 0 && cursor.direction === "next" ? sql`<=` : sql`<`}(${before.at}::timestamptz,${before.id}::text) LIMIT 1`
              .execute(tx)
              .then((r) => r.rows.length > 0)
          : false,
        after
          ? sql`SELECT 1 FROM attention_items a WHERE ${allowed} AND (a.detected_at,a.message_id)${rows.length === 0 && cursor.direction === "previous" ? sql`>=` : sql`>`}(${after.at}::timestamptz,${after.id}::text) LIMIT 1`
              .execute(tx)
              .then((r) => r.rows.length > 0)
          : false,
      ]);
      // Home needs a current active count, independent of page filters and
      // fixed membership. Reuse current channel checks without a new snapshot.
      const currentCounts = (
        await sql<{
          channel_id: string;
          total: number;
        }>`SELECT a.channel_id,count(*)::integer AS total FROM attention_items a WHERE ${retained} AND a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') AND a.detected_at<=${now} AND COALESCE(a.opened_at,a.detected_at)<=${now} GROUP BY a.channel_id`.execute(
          tx,
        )
      ).rows;
      let activeCount = 0;
      for (const channel of currentCounts)
        if (await canRead(channel.channel_id)) activeCount += channel.total;
      let canOperate = true;
      try {
        await operationsAccess(tx, s, actor, "OPERATE", "basic_attention");
      } catch (error) {
        if (isDomainError(error) && error.status === 403) canOperate = false;
        else throw error;
      }
      await operationsAccess(tx, s, actor, "READ", "basic_attention");
      const resolution = new Map(
        scope.resolutions.map((c) => [c.actualChannelId, c]),
      );
      return {
        items: rows.map((row) => ({
          channelId: row.channel_id,
          messageId: row.message_id,
          status: row.status,
          version: row.version,
          surface:
            resolution.get(row.channel_id)?.surface ?? row.target_surface,
          purpose: resolution.get(row.channel_id)?.effectivePurpose ?? "OTHER",
          postedAt: row.occurred_at.toISOString(),
          openedAt: row.opened_at?.toISOString() ?? null,
          snoozeUntil: row.snooze_until?.toISOString() ?? null,
          response:
            row.resolution_reason === "OBSERVED_RESPONSE"
              ? row.reply
                ? "REPLY"
                : row.participation
                  ? "PARTICIPATION"
                  : "UNKNOWN"
              : null,
          waitingMinutes: Math.max(
            0,
            Math.floor((now.getTime() - row.occurred_at.getTime()) / 60000),
          ),
          url: `https://discord.com/channels/${s.guildId}/${row.channel_id}/${row.message_id}`,
        })),
        total,
        activeCount,
        asOf: cursor.asOf,
        checkedAt: now.toISOString(),
        cursor: this.encode(cursor),
        firstCursor: this.encode({
          ...cursor,
          direction: "first",
          point: null,
        }),
        previousCursor:
          hasPrevious && before
            ? this.encode({
                ...cursor,
                direction: "previous",
                point: before,
                includePoint: rows.length === 0 && cursor.direction === "next",
              })
            : null,
        nextCursor:
          hasNext && after
            ? this.encode({
                ...cursor,
                direction: "next",
                point: after,
                includePoint:
                  rows.length === 0 && cursor.direction === "previous",
              })
            : null,
        canOperate,
        channels: visible,
      };
    });
  }
  async action(
    s: Scope,
    actor: Actor,
    input: unknown,
    readable: ReadableAttentionChannel,
    now = new Date(),
  ) {
    const data = z
      .object({
        channelId: z.string().regex(/^\d{17,20}$/),
        messageId: z.string().regex(/^\d{17,20}$/),
        status: z.enum(["ACKNOWLEDGED", "SNOOZED", "RESOLVED"]),
        version: z.number().int().nonnegative(),
        minutes: z.union([z.literal(30), z.literal(60)]).optional(),
        untilToday: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const authorize = async (tx: Tx) => {
      const entitlements = await operationsAccess(
        tx,
        s,
        actor,
        "OPERATE",
        "basic_attention",
      );
      const cfg = await new SettingsService(tx).get(s),
        scope = await analysisChannelScope(tx, s, cfg);
      assert(
        scope.actualChannelIds.includes(data.channelId) &&
          (await readable(data.channelId)),
        "CHANNEL_PERMISSION_MISSING",
        403,
      );
      assert(
        (
          await sql`SELECT 1 FROM attention_items WHERE ${tenant(s)} AND message_id=${data.messageId} AND channel_id=${data.channelId} AND item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND detected_at>=${new Date(now.getTime() - Math.min(cfg.detailedRetentionDays, entitlements.limits.historyDays ?? cfg.detailedRetentionDays) * 86400000)}`.execute(
            tx,
          )
        ).rows.length,
        "ATTENTION_NOT_FOUND",
        404,
      );
    };
    const cfg = await new SettingsService(this.db).get(s);
    const until =
      data.status !== "SNOOZED"
        ? null
        : data.untilToday
          ? nextZonedDayStart(now, cfg.timezone)
          : new Date(now.getTime() + (data.minutes ?? 30) * 60000);
    return new AttentionOperations(this.db).action(
      s,
      data.messageId,
      data.channelId,
      data.status,
      now,
      until,
      "MANUAL",
      authorize,
      data.version,
      actor.key,
    );
  }
}
export type AttentionPage = Awaited<ReturnType<AttentionQueue["page"]>>;
