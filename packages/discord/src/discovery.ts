import { PermissionFlagsBits, ChannelFlags } from "discord-api-types/v10";
import { surfaceUsageKey } from "../../shared/src/community-model";
import type {
  CapabilitySnapshot,
  ChannelMetadata,
  ThreadMetadata,
  CapabilityStatus,
} from "../../shared/src/community-model";
export type RawChannel = {
  flags?: number;
  id: string;
  type: number;
  parent_id?: string | null;
  owner_id?: string;
  permission_overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
  available_tags?: { id: string }[];
  applied_tags?: string[];
  thread_metadata?: {
    archived: boolean;
    locked: boolean;
    create_timestamp?: string;
  };
};
export type DiscoverySource = {
  channelCensus?: "FULL" | "VISIBLE_ONLY" | "UNKNOWN";
  botPermissions?: {
    manageGuild: boolean;
    manageRoles: boolean;
    sendMessages: boolean;
    highestRolePosition: number | null;
  };
  features: string[];
  memberCount: number | null;
  afkChannelId: string | null;
  incidents: Record<string, string | null>;
  channels: ChannelMetadata[];
  threads: ThreadMetadata[];
  onboarding: CapabilitySnapshot["onboarding"];
  endpointStatus: Record<string, CapabilityStatus>;
  ruleCount: number | null;
  welcomeCount: number | null;
  scheduledEvents: {
    id: string;
    channelId: string | null;
    entityType: number;
    status: number;
  }[];
};
export function observableChannel(
  channel: RawChannel,
  guildId: string,
  botId: string,
  roles: { id: string; permissions: string }[],
  botRoles: string[],
) {
  if ((channel.flags ?? 0) & ChannelFlags.ChannelObfuscated) return false;
  let permissions = roles
    .filter((r) => r.id === guildId || botRoles.includes(r.id))
    .reduce((value, r) => value | BigInt(r.permissions), 0n);
  if (permissions & PermissionFlagsBits.Administrator) return true;
  const overwrites = channel.permission_overwrites ?? [],
    everyone = overwrites.find((o) => o.id === guildId);
  if (everyone)
    permissions =
      (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n,
    deny = 0n;
  for (const o of overwrites.filter(
    (o) => o.type === 0 && botRoles.includes(o.id),
  )) {
    allow |= BigInt(o.allow);
    deny |= BigInt(o.deny);
  }
  permissions = (permissions & ~deny) | allow;
  const member = overwrites.find((o) => o.type === 1 && o.id === botId);
  if (member)
    permissions = (permissions & ~BigInt(member.deny)) | BigInt(member.allow);
  return Boolean(permissions & PermissionFlagsBits.ViewChannel);
}
export function buildCapabilitySnapshot(
  source: DiscoverySource,
  now = new Date(),
  prior: CapabilitySnapshot | null = null,
  usage: Record<string, number> = {},
): CapabilitySnapshot {
  const counts: Record<string, number> = {};
  for (const c of source.channels)
    counts[String(c.type)] = (counts[String(c.type)] ?? 0) + 1;
  const capabilities: CapabilitySnapshot["capabilities"] = {};
  const put = (key: string, status: CapabilityStatus, reason?: string) => {
    capabilities[key] = {
      status,
      availableSince:
        status === "UNKNOWN" ||
        status === "UNAVAILABLE" ||
        status === "PERMISSION_MISSING"
          ? (prior?.capabilities[key]?.availableSince ?? null)
          : (prior?.capabilities[key]?.availableSince ?? now.toISOString()),
      ...(reason ? { reason } : {}),
    };
  };
  const features = source.features;
  for (const [key, feature] of [
    ["community", "COMMUNITY"],
    ["screening", "MEMBER_VERIFICATION_GATE_ENABLED"],
    ["guests", "GUESTS_ENABLED"],
    ["discovery", "DISCOVERABLE"],
  ] as const)
    put(key, features.includes(feature) ? "ENABLED" : "UNAVAILABLE");
  for (const [key, type] of [
    [surfaceUsageKey.TEXT, 0],
    [surfaceUsageKey.ANNOUNCEMENT, 5],
    ["voice", 2],
    ["stage", 13],
    [surfaceUsageKey.FORUM_POST, 15],
    [surfaceUsageKey.MEDIA_POST, 16],
    ["category", 4],
  ] as const)
    put(
      key,
      source.endpointStatus.channels !== "AVAILABLE"
        ? (source.endpointStatus.channels ?? "UNKNOWN")
        : counts[String(type)]
          ? usage[key]
            ? "OBSERVED"
            : "ENABLED"
          : "UNAVAILABLE",
    );
  put(
    "threads",
    source.endpointStatus.threads === "AVAILABLE"
      ? usage.threads
        ? "OBSERVED"
        : source.threads.length
          ? "ENABLED"
          : "AVAILABLE"
      : (source.endpointStatus.threads ?? "UNKNOWN"),
    "Accessible active threads only; archived/private totals unknown",
  );
  put(
    "onboarding",
    source.endpointStatus.onboarding === "AVAILABLE"
      ? source.onboarding?.enabled
        ? "ENABLED"
        : "AVAILABLE"
      : (source.endpointStatus.onboarding ?? "UNKNOWN"),
  );
  put(
    "serverGuide",
    usage.serverGuide ? "OBSERVED" : "UNKNOWN",
    "Member Home Action flags are observable; Guide configuration is not exposed",
  );
  put(
    "legacyWelcome",
    source.endpointStatus.welcome ?? "UNKNOWN",
    "Read success establishes configuration availability, not enabled state",
  );
  put(
    "autoMod",
    source.endpointStatus.autoMod === "AVAILABLE"
      ? (source.ruleCount ?? 0) > 0
        ? "CONFIGURED"
        : "AVAILABLE"
      : (source.endpointStatus.autoMod ?? "UNKNOWN"),
  );
  put(
    "events",
    source.endpointStatus.events === "AVAILABLE"
      ? source.scheduledEvents.length
        ? "CONFIGURED"
        : "AVAILABLE"
      : (source.endpointStatus.events ?? "UNKNOWN"),
  );
  for (const key of ["reaction", "poll", "voiceText", "stageText"])
    put(key, usage[key] ? "OBSERVED" : "AVAILABLE");
  put(
    "incidents",
    Object.values(source.incidents).some(Boolean) ? "OBSERVED" : "UNKNOWN",
    "No incident data does not establish absence of incidents",
  );
  const fullCensus =
    source.endpointStatus.channels === "AVAILABLE" &&
    (source.channelCensus ??
      (now < new Date("2026-11-16T00:00:00Z") ? "FULL" : "VISIBLE_ONLY")) ===
      "FULL";
  const totalState =
    source.endpointStatus.channels !== "AVAILABLE"
      ? "UNKNOWN"
      : fullCensus
        ? "KNOWN"
        : "LOWER_BOUND";
  const relevant = source.channels.filter((c) =>
      [0, 2, 5, 13, 15, 16].includes(c.type),
    ),
    observable = relevant.filter((c) => c.observable),
    suggestions: CapabilitySnapshot["suggestions"] = [];
  if (counts["2"]) suggestions.push("VOICE", "LFG_PLAY");
  if (counts["15"]) suggestions.push("SUPPORT_QA", "DEVELOPMENT_FEEDBACK");
  if (counts["13"] || source.scheduledEvents.length) suggestions.push("EVENTS");
  if (counts["16"]) suggestions.push("CONTENT_SHOWCASE");
  if (counts["5"]) suggestions.push("CREATOR_FAN");
  return {
    schemaVersion: 2,
    checkedAt: now.toISOString(),
    features,
    memberCount: source.memberCount,
    afkChannelId: source.afkChannelId,
    channelTypeCounts: counts,
    botPermissions: source.botPermissions ?? null,
    threadCounts: {
      active:
        source.endpointStatus.threads === "AVAILABLE"
          ? source.threads.length
          : null,
      public:
        source.endpointStatus.threads === "AVAILABLE"
          ? source.threads.filter((t) => t.type === 11).length
          : null,
      private:
        source.endpointStatus.threads === "AVAILABLE"
          ? source.threads.filter((t) => t.type === 12).length
          : null,
      announcement:
        source.endpointStatus.threads === "AVAILABLE"
          ? source.threads.filter((t) => t.type === 10).length
          : null,
    },
    capabilities,
    channels: source.channels,
    coverage: {
      totalState,
      knownTotalChannels: fullCensus ? relevant.length : null,
      coverageState:
        totalState === "UNKNOWN"
          ? "UNKNOWN"
          : totalState === "LOWER_BOUND"
            ? "LOWER_BOUND"
            : observable.length === relevant.length
              ? "COMPLETE"
              : "PARTIAL",
      reasons:
        totalState === "UNKNOWN"
          ? ["CHANNEL_DISCOVERY_UNAVAILABLE"]
          : fullCensus
            ? observable.length === relevant.length
              ? []
              : ["VIEW_CHANNEL_MISSING"]
            : ["DISCORD_VISIBLE_CHANNELS_ONLY"],
      observableChannels: observable.length,
      totalRelevantChannels: relevant.length,
      ratio:
        fullCensus && relevant.length
          ? observable.length / relevant.length
          : null,
      blindSpots: relevant
        .filter((c) => !c.observable)
        .map((c) => ({
          channelId: c.id,
          reason:
            source.endpointStatus.channels === "AVAILABLE"
              ? "VIEW_CHANNEL_MISSING"
              : "CHANNEL_VISIBILITY_UNKNOWN",
        })),
      privateThreads: "PARTIAL",
    },
    onboarding: source.onboarding,
    suggestions: [...new Set(suggestions)],
    incidents: source.incidents,
    observedUsage: usage,
  };
}
