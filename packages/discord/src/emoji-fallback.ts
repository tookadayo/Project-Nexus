import {
  applicationEmojiDefinitions,
  applicationEmojiKeys,
  type ApplicationEmojiConfig,
} from "../../shared/src/application-emoji";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Resolve only the component shapes used by the existing V2/legacy builders. */
function emojiTarget(payload: RecordValue, path: string[]): RecordValue | null {
  const emojiIndex = path.indexOf("emoji");
  if (
    emojiIndex < 2 ||
    path[0] !== "components" ||
    !/^[0-9]+$/.test(path[1]!) ||
    !Array.isArray(payload.components) ||
    (path.length !== emojiIndex + 1 &&
      (path.length !== emojiIndex + 2 ||
        !["id", "name", "animated"].includes(path.at(-1)!)))
  )
    return null;
  let target: unknown = payload.components[Number(path[1])];
  if (!record(target) || ![1, 9, 17].includes(Number(target.type))) return null;
  let cursor = 2;
  while (cursor < emojiIndex) {
    if (!record(target)) return null;
    const field = path[cursor];
    if (target.type === 9 && field === "accessory") {
      target = target.accessory;
      if (!record(target) || target.type !== 2) return null;
      cursor++;
      continue;
    }
    const array = target[field!];
    const index = path[cursor + 1];
    if (!index || !/^[0-9]+$/.test(index) || !Array.isArray(array)) return null;
    const child: unknown = array[Number(index)];
    if (!record(child)) return null;
    if (target.type === 3 && field === "options") {
      return cursor + 2 === emojiIndex ? child : null;
    }
    if (field !== "components") return null;
    if (!(
      (target.type === 17 && [1, 9].includes(Number(child.type))) ||
      (target.type === 1 && [2, 3].includes(Number(child.type)))
    ))
      return null;
    target = child;
    cursor += 2;
  }
  return record(target) && target.type === 2 && target.style !== 6
    ? target
    : null;
}

/**
 * Accept only Discord's structured Invalid Form Body response when every
 * validation leaf names a configured NEXUS button / String Select emoji.
 * Error messages are neither inspected nor returned. Mixed or unknown errors
 * fail closed; arbitrary body text, URLs and custom IDs are never rewritten.
 */
export function fallbackRejectedApplicationEmoji<T>(
  payload: T,
  response: unknown,
  config: ApplicationEmojiConfig,
): T | null {
  if (
    config.mode !== "custom" ||
    !record(payload) ||
    !record(response) ||
    response.code !== 50035 ||
    !record(response.errors)
  )
    return null;

  const replacements = new Map<string, { path: string[]; unicode: string }>();
  let nodes = 0;
  const visit = (node: unknown, path: string[]): boolean => {
    if (++nodes > 512 || path.length > 12 || !record(node)) return false;
    const entries = Object.entries(node);
    if (!entries.length) return false;
    for (const [key, value] of entries) {
      if (key !== "_errors") {
        if (!visit(value, [...path, key])) return false;
        continue;
      }
      if (
        !Array.isArray(value) ||
        !value.length ||
        !value.every(
          (error) =>
            record(error) &&
            typeof error.code === "string" &&
            error.code.length > 0,
        )
      )
        return false;
      const target = emojiTarget(payload, path);
      if (!target) return false;
      // The textual label remains available if Discord cannot render an image.
      if (
        typeof target.label !== "string" ||
        !target.label.trim() ||
        !record(target.emoji)
      )
        return false;
      const emoji = target.emoji;
      const known = applicationEmojiKeys.find((key) => {
        const configured = config.emojis[key];
        return (
          configured &&
          configured.id === emoji.id &&
          configured.name === emoji.name &&
          emoji.animated !== true
        );
      });
      if (!known) return false;
      const emojiPath = path.slice(0, path.indexOf("emoji") + 1);
      replacements.set(emojiPath.join("."), {
        path: emojiPath,
        unicode: applicationEmojiDefinitions[known].unicode,
      });
    }
    return true;
  };
  if (!visit(response.errors, []) || !replacements.size) return null;

  // Payloads are Discord JSON objects; attachments remain outside this clone.
  const fallback = structuredClone(payload);
  for (const { path, unicode } of replacements.values()) {
    let target: unknown = fallback;
    for (const key of path.slice(0, -1)) {
      target = (target as RecordValue)[key];
    }
    (target as RecordValue).emoji = { name: unicode };
  }
  return fallback;
}
