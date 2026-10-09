/** Optional decorations: confirmed is an owner's offline declaration, not Discord verification. */
export const applicationEmojiKeys = [
  "overview",
  "analysis",
  "attention",
  "history",
  "settings",
  "help",
  "done",
  "news",
] as const;
export type ApplicationEmojiKey = (typeof applicationEmojiKeys)[number];
export type ApplicationEmojiMode = "custom" | "unicode" | "text";

export const applicationEmojiDefinitions = Object.freeze({
  overview: Object.freeze({ name: "nx_overview", unicode: "🧭" }),
  analysis: Object.freeze({ name: "nx_analysis", unicode: "📊" }),
  attention: Object.freeze({ name: "nx_attention", unicode: "🔎" }),
  history: Object.freeze({ name: "nx_history", unicode: "🕘" }),
  settings: Object.freeze({ name: "nx_settings", unicode: "⚙️" }),
  help: Object.freeze({ name: "nx_help", unicode: "❔" }),
  done: Object.freeze({ name: "nx_done", unicode: "✅" }),
  news: Object.freeze({ name: "nx_news", unicode: "📣" }),
} satisfies Record<ApplicationEmojiKey, { name: string; unicode: string }>);

export type ApplicationComponentEmoji = Readonly<{
  id: string;
  name: string;
  animated: false;
}>;
export type ApplicationEmojiConfig = Readonly<{
  mode: ApplicationEmojiMode;
  applicationId?: string;
  emojis: Readonly<
    Partial<Record<ApplicationEmojiKey, ApplicationComponentEmoji>>
  >;
}>;
export type ApplicationEmojiOptions = {
  config?: ApplicationEmojiConfig;
  /** Local display override, including the Unicode retry and text-only tests. */
  mode?: ApplicationEmojiMode;
};
type DecorationEnvironment = Readonly<Record<string, string | undefined>>;
const maximumSnowflake = 18_446_744_073_709_551_615n;
const maximumConfigurationLength = 8_192;

function validSnowflake(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d{16,19}$/.test(value) &&
    BigInt(value) <= maximumSnowflake
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}
function configuredMode(value: string | undefined): ApplicationEmojiMode {
  if (value === undefined || value === "" || value === "custom")
    return "custom";
  return value === "text" ? "text" : "unicode";
}

/**
 * NEXUS_APPLICATION_EMOJIS:
 * {"applicationId":"...","emojis":{"overview":{"id":"...","status":"confirmed"}}}
 * Optional name must equal the fixed nx_KEY name. Invalid, unverified, or deleted
 * entries fall back independently; a registry for another application is ignored.
 * NEXUS_EMOJI_MODE: custom (default), unicode, or text. No network request,
 * registration, credential access, or startup failure is introduced.
 */
export function readApplicationEmojiConfig(
  env: DecorationEnvironment = process.env,
): ApplicationEmojiConfig {
  const mode = configuredMode(env.NEXUS_EMOJI_MODE);
  const emojis: Partial<
    Record<ApplicationEmojiKey, ApplicationComponentEmoji>
  > = {};
  const fallback = (): ApplicationEmojiConfig =>
    Object.freeze({ mode, emojis: Object.freeze(emojis) });
  const encoded = env.NEXUS_APPLICATION_EMOJIS;
  const applicationId = env.DISCORD_APPLICATION_ID;
  if (
    !encoded ||
    encoded.length > maximumConfigurationLength ||
    !validSnowflake(applicationId)
  )
    return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return fallback();
  }
  if (
    !record(parsed) ||
    own(parsed, "applicationId") !== applicationId ||
    Object.keys(parsed).some(
      (key) => key !== "applicationId" && key !== "emojis",
    )
  )
    return fallback();
  const entries = own(parsed, "emojis");
  if (!record(entries)) return fallback();
  for (const key of applicationEmojiKeys) {
    const entry = own(entries, key);
    if (!record(entry)) continue;
    const id = own(entry, "id");
    const name = own(entry, "name");
    if (
      !validSnowflake(id) ||
      own(entry, "status") !== "confirmed" ||
      (name !== undefined && name !== applicationEmojiDefinitions[key].name) ||
      Object.keys(entry).some(
        (field) => field !== "id" && field !== "name" && field !== "status",
      )
    )
      continue;
    emojis[key] = Object.freeze({
      id,
      name: applicationEmojiDefinitions[key].name,
      animated: false,
    });
  }
  return Object.freeze({ mode, applicationId, emojis: Object.freeze(emojis) });
}

function displayOptions(options: ApplicationEmojiOptions) {
  const config = options.config ?? readApplicationEmojiConfig();
  return { config, mode: options.mode ?? config.mode };
}
/** Dedicated button/String Select field. Never put custom markup in a label. */
export function componentEmoji(
  key: ApplicationEmojiKey,
  options: ApplicationEmojiOptions = {},
): ApplicationComponentEmoji | Readonly<{ name: string }> | undefined {
  const { config, mode } = displayOptions(options);
  if (mode === "text") return undefined;
  if (mode === "custom" && config.emojis[key]) return config.emojis[key];
  return { name: applicationEmojiDefinitions[key].unicode };
}
/** Supported message text only; not modal titles, embed authors, or footers. */
export function emojiText(
  key: ApplicationEmojiKey,
  options: ApplicationEmojiOptions = {},
): string {
  const { config, mode } = displayOptions(options);
  if (mode === "text") return "";
  const custom = mode === "custom" ? config.emojis[key] : undefined;
  return custom
    ? `<:${custom.name}:${custom.id}>`
    : applicationEmojiDefinitions[key].unicode;
}
export function withEmojiText(
  key: ApplicationEmojiKey,
  label: string,
  options: ApplicationEmojiOptions = {},
): string {
  const emoji = emojiText(key, options);
  return emoji ? `${emoji} ${label}` : label;
}
