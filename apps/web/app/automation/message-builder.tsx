"use client";

import { useEffect, useRef, useState } from "react";
import type {
  JsonValue,
  ValueInput,
} from "../../../../packages/automation/src/types";
import {
  renderRichText,
  escapeMarkdown,
  validateEmbedSpec,
  validateMessageSpec,
  type EmbedSpec,
  type LegacyMessageSpec,
  type RichTextNode,
} from "../../../../packages/automation/src/message";
import { missing, words, type Locale } from "./model";

/** Author registered data parts. Neither HTML nor arbitrary JSON is accepted. */
export function MessageBuilder({
  value,
  onChange,
  locale,
  onValidity,
}: {
  value: ValueInput;
  onChange: (value: ValueInput) => void;
  locale: Locale;
  onValidity: (message: string | null) => void;
}) {
  const initial = (): LegacyMessageSpec =>
    value.kind === "literal" && value.type === "LegacyMessageSpec"
      ? (value.value as unknown as LegacyMessageSpec)
      : value.kind === "literal" && value.type === "EmbedSpec"
        ? { kind: "legacy", embeds: [value.value as unknown as EmbedSpec] }
        : value.kind === "literal" && value.type === "RichTextSpec"
          ? {
              kind: "legacy",
              richText: value.value as unknown as RichTextNode[],
            }
          : { kind: "legacy", richText: [] };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const last = useRef(JSON.stringify(value));
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== last.current) {
      last.current = next;
      setDraft(initial());
      setError("");
      onValidity(null);
    }
  }, [value]); // Parent undo replaces the whole typed value.
  const commit = (next: LegacyMessageSpec) => {
    setDraft(next);
    try {
      let data: unknown = next;
      if (value.type === "RichTextSpec") {
        data = next.richText ?? [];
        renderRichText(data as RichTextNode[]);
        if (!(data as unknown[]).length) throw new Error("EMPTY");
      } else if (value.type === "EmbedSpec")
        data = validateEmbedSpec(next.embeds?.[0]);
      else {
        const validated = validateMessageSpec(next);
        if (validated.kind !== "legacy") throw new Error("MODE");
        data = validated;
      }
      const output: ValueInput = {
        kind: "literal",
        type: value.type,
        value: data as JsonValue,
      };
      last.current = JSON.stringify(output);
      onChange(output);
      onValidity(null);
      setError("");
    } catch {
      const output = missing(value.type);
      last.current = JSON.stringify(output);
      onChange(output);
      const message = words(
        locale,
        "未入力・長すぎる内容・不正なHTTPSリンクなどを確認してください。例示は値になりません。",
        "Check missing fields, text limits and HTTPS links. Examples are not execution values.",
      );
      setError(message);
      onValidity(message);
    }
  };
  let preview = "";
  try {
    preview =
      draft.richText !== undefined
        ? renderRichText(draft.richText)
        : escapeMarkdown(draft.content ?? "");
  } catch {
    /* Invalid drafts have no sendable preview. */
  }
  return (
    <div className="automation-message-builder">
      <p className="automation-hint">
        {words(
          locale,
          "この画面の投稿は本文と埋め込みカードに対応します。投稿内のボタン・選択欄・モーダル・V2部品はまだ使えません。変数を含む文章は「計算ブロック」で型付きの文章部品を組み立てます。",
          "These posts support text and embed cards. Message buttons, selects, modals and V2 parts are not yet available. Use Calculation to compose typed text parts containing variables.",
        )}
      </p>
      <p className="automation-hint">
        {words(
          locale,
          "Legacyメッセージの部品を編集します。通知メンションは無効です。V2部品との混在はできません。",
          "Edit registered Legacy message parts. Mention notifications are off. V2 components cannot be mixed in.",
        )}
      </p>
      {value.type !== "EmbedSpec" && (
        <>
          {draft.content !== undefined ? (
            <label>
              {words(locale, "保存済みの本文", "Saved message content")}
              <textarea
                value={draft.content}
                rows={3}
                maxLength={2000}
                onChange={(e) => commit({ ...draft, content: e.target.value })}
              />
            </label>
          ) : (
            <RichParts
              nodes={draft.richText ?? []}
              onChange={(richText) => commit({ ...draft, richText })}
              locale={locale}
            />
          )}
          {draft.content !== undefined && (
            <button
              type="button"
              onClick={() => {
                const { content, ...rest } = draft;
                commit({
                  ...rest,
                  richText: [{ kind: "text", text: content ?? "" }],
                });
              }}
            >
              {words(
                locale,
                "本文を型付きテキスト部品に変換",
                "Convert content into typed text parts",
              )}
            </button>
          )}
        </>
      )}
      {value.type !== "RichTextSpec" && (
        <>
          {(draft.embeds ?? []).map((embed, index) => (
            <EmbedEditor
              key={index}
              value={embed}
              locale={locale}
              onChange={(next) =>
                commit({
                  ...draft,
                  embeds: (draft.embeds ?? []).map((item, i) =>
                    i === index ? next : item,
                  ),
                })
              }
              onDelete={
                value.type === "EmbedSpec"
                  ? undefined
                  : () =>
                      commit({
                        ...draft,
                        embeds: draft.embeds?.filter((_, i) => i !== index),
                      })
              }
            />
          ))}
          <button
            type="button"
            disabled={
              (draft.embeds?.length ?? 0) >=
              (value.type === "EmbedSpec" ? 1 : 10)
            }
            onClick={() =>
              commit({ ...draft, embeds: [...(draft.embeds ?? []), {}] })
            }
          >
            {words(locale, "埋め込みカードを追加", "Add an embed card")}
          </button>
        </>
      )}
      {error && (
        <p role="status" className="automation-field-error">
          {error}
        </p>
      )}
      <section
        className="automation-message-preview"
        aria-label={words(
          locale,
          "メッセージのローカル確認",
          "Local message preview",
        )}
      >
        <strong>
          {words(
            locale,
            "送信前の確認（通知なし）",
            "Preview before sending (no notification)",
          )}
        </strong>
        <pre>
          {preview ||
            words(locale, "本文は未入力です", "Message text is unset")}
        </pre>
        {(draft.embeds ?? []).map((embed, i) => (
          <article
            key={i}
            style={{
              borderInlineStart: `4px solid #${(embed.color ?? 0x4a6cf7).toString(16).padStart(6, "0")}`,
            }}
          >
            <strong>{embed.title}</strong>
            <p>{embed.description}</p>
            {embed.fields?.map((field, index) => (
              <div key={index}>
                <b>{field.name}</b>
                <p>{field.value}</p>
              </div>
            ))}
            <small>{embed.footer?.text}</small>
          </article>
        ))}
        <small>
          {words(
            locale,
            "装飾のコンパイル結果とカードを表示します。Discordの表示・リンク先・現在の権限はここでは検証しません。",
            "Shows compiled formatting and cards. This preview does not verify Discord rendering, destinations or current permissions.",
          )}
        </small>
      </section>
    </div>
  );
}

const PARTS: { kind: RichTextNode["kind"]; ja: string; en: string }[] = [
  { kind: "text", ja: "普通の文章", en: "Plain text" },
  { kind: "break", ja: "改行", en: "Line break" },
  { kind: "bold", ja: "太字", en: "Bold" },
  { kind: "italic", ja: "斜体", en: "Italic" },
  { kind: "underline", ja: "下線", en: "Underline" },
  { kind: "strike", ja: "取り消し線", en: "Strike through" },
  { kind: "spoiler", ja: "伏せ字", en: "Spoiler" },
  { kind: "quote", ja: "引用", en: "Quote" },
  { kind: "heading", ja: "見出し", en: "Heading" },
  { kind: "code", ja: "コード表示", en: "Code display" },
  { kind: "link", ja: "HTTPSリンク", en: "HTTPS link" },
  { kind: "timestamp", ja: "日時", en: "Timestamp" },
  { kind: "list", ja: "箇条書き", en: "List" },
];
function newPart(kind: RichTextNode["kind"]): RichTextNode {
  switch (kind) {
    case "text":
      return { kind, text: "" };
    case "break":
      return { kind };
    case "heading":
      return { kind, level: 1, children: [] };
    case "code":
      return { kind, text: "", multiline: true, language: "text" };
    case "link":
      return { kind, text: "", url: "" };
    case "timestamp":
      return { kind, instant: "", format: "f" };
    case "list":
      return { kind, ordered: false, items: [[]] };
    default:
      return { kind, children: [] };
  }
}
function RichParts({
  nodes,
  onChange,
  locale,
  depth = 0,
}: {
  nodes: RichTextNode[];
  onChange: (nodes: RichTextNode[]) => void;
  locale: Locale;
  depth?: number;
}) {
  const [choice, setChoice] = useState<RichTextNode["kind"]>("text");
  const patch = (index: number, node: RichTextNode) =>
    onChange(nodes.map((item, i) => (index === i ? node : item)));
  return (
    <div className="automation-rich-parts">
      {nodes.map((node, index) => (
        <fieldset key={index}>
          <legend>
            {index + 1}.{" "}
            {PARTS.find((part) => part.kind === node.kind)?.[locale]}
          </legend>
          {"text" in node && (
            <label>
              {words(locale, "文章", "Text")}
              <textarea
                value={node.text}
                rows={2}
                maxLength={2000}
                onChange={(e) =>
                  patch(index, { ...node, text: e.target.value })
                }
              />
            </label>
          )}
          {node.kind === "link" && (
            <label>
              {words(locale, "リンク先（HTTPS）", "Destination (HTTPS)")}
              <input
                type="url"
                placeholder="https://"
                value={node.url}
                onChange={(e) => patch(index, { ...node, url: e.target.value })}
              />
            </label>
          )}
          {node.kind === "heading" && (
            <label>
              {words(locale, "見出しの大きさ", "Heading level")}
              <select
                value={node.level}
                onChange={(e) =>
                  patch(index, {
                    ...node,
                    level: Number(e.target.value) as 1 | 2 | 3,
                  })
                }
              >
                {[1, 2, 3].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          )}
          {node.kind === "code" && (
            <label>
              <input
                type="checkbox"
                checked={node.multiline === true}
                onChange={(e) =>
                  patch(index, { ...node, multiline: e.target.checked })
                }
              />
              {words(
                locale,
                "複数行のコード表示（実行はしません）",
                "Multiline code display (never executes)",
              )}
            </label>
          )}
          {node.kind === "timestamp" && (
            <>
              <label>
                {words(locale, "日時（UTC）", "Date and time (UTC)")}
                <input
                  type="datetime-local"
                  value={
                    node.instant.endsWith("Z")
                      ? node.instant.slice(0, 16)
                      : node.instant
                  }
                  onChange={(e) => {
                    const entered = e.target.value;
                    patch(index, {
                      ...node,
                      instant: entered
                        ? new Date(entered + "Z").toISOString()
                        : "",
                    });
                  }}
                />
              </label>
              <label>
                {words(locale, "日時の表示方法", "Time display format")}
                <select
                  value={node.format}
                  onChange={(e) =>
                    patch(index, {
                      ...node,
                      format: e.target.value as typeof node.format,
                    })
                  }
                >
                  {(["t", "T", "d", "D", "f", "F", "R"] as const).map(
                    (format, i) => (
                      <option key={format} value={format}>
                        {words(
                          locale,
                          [
                            "時刻",
                            "秒付き時刻",
                            "日付",
                            "長い日付",
                            "日付と時刻",
                            "曜日付き日時",
                            "相対時刻",
                          ][i]!,
                          [
                            "Time",
                            "Time with seconds",
                            "Date",
                            "Long date",
                            "Date and time",
                            "Date, weekday and time",
                            "Relative time",
                          ][i]!,
                        )}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </>
          )}
          {"children" in node && (
            <RichParts
              nodes={node.children}
              onChange={(children) => patch(index, { ...node, children })}
              locale={locale}
              depth={depth + 1}
            />
          )}
          {node.kind === "list" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={node.ordered}
                  onChange={(e) =>
                    patch(index, { ...node, ordered: e.target.checked })
                  }
                />
                {words(locale, "番号を付ける", "Number this list")}
              </label>
              {node.items.map((item, i) => (
                <div key={i}>
                  <RichParts
                    nodes={item}
                    onChange={(children) =>
                      patch(index, {
                        ...node,
                        items: node.items.map((part, j) =>
                          j === i ? children : part,
                        ),
                      })
                    }
                    locale={locale}
                    depth={depth + 1}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch(index, {
                        ...node,
                        items: node.items.filter((_, j) => j !== i),
                      })
                    }
                  >
                    {words(locale, "この項目を削除", "Delete list item")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={node.items.length >= 100}
                onClick={() =>
                  patch(index, { ...node, items: [...node.items, []] })
                }
              >
                {words(locale, "箇条書きの項目を追加", "Add a list item")}
              </button>
            </>
          )}
          <div className="automation-inline-actions">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                const next = [...nodes];
                [next[index - 1], next[index]] = [
                  next[index]!,
                  next[index - 1]!,
                ];
                onChange(next);
              }}
            >
              {words(locale, "上へ", "Move up")}
            </button>
            <button
              type="button"
              disabled={index === nodes.length - 1}
              onClick={() => {
                const next = [...nodes];
                [next[index], next[index + 1]] = [
                  next[index + 1]!,
                  next[index]!,
                ];
                onChange(next);
              }}
            >
              {words(locale, "下へ", "Move down")}
            </button>
            <button
              type="button"
              onClick={() => onChange(nodes.filter((_, i) => i !== index))}
            >
              {words(locale, "部品を削除", "Delete part")}
            </button>
          </div>
        </fieldset>
      ))}
      <label>
        {words(locale, "追加する文章の部品", "Text part to add")}
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value as RichTextNode["kind"])}
        >
          {PARTS.filter(
            (part) =>
              depth < 7 ||
              ![
                "bold",
                "italic",
                "underline",
                "strike",
                "spoiler",
                "quote",
                "heading",
                "list",
              ].includes(part.kind),
          ).map((part) => (
            <option key={part.kind} value={part.kind}>
              {part[locale]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={nodes.length >= 256 || depth >= 8}
        onClick={() => onChange([...nodes, newPart(choice)])}
      >
        {words(locale, "文章の部品を追加", "Add a text part")}
      </button>
    </div>
  );
}
function EmbedEditor({
  value,
  onChange,
  onDelete,
  locale,
}: {
  value: EmbedSpec;
  onChange: (value: EmbedSpec) => void;
  onDelete?: () => void;
  locale: Locale;
}) {
  const text = (
    key: "title" | "description" | "url",
    ja: string,
    en: string,
    max: number,
  ) => (
    <label>
      {words(locale, ja, en)}
      {key === "description" ? (
        <textarea
          rows={3}
          value={value[key] ?? ""}
          maxLength={max}
          onChange={(e) =>
            onChange({ ...value, [key]: e.target.value || undefined })
          }
        />
      ) : (
        <input
          type={key === "url" ? "url" : "text"}
          value={value[key] ?? ""}
          maxLength={max}
          onChange={(e) =>
            onChange({ ...value, [key]: e.target.value || undefined })
          }
        />
      )}
    </label>
  );
  return (
    <fieldset className="automation-embed-editor">
      <legend>{words(locale, "埋め込みカード", "Embed card")}</legend>
      {text("title", "タイトル", "Title", 256)}
      {text("description", "説明文", "Description", 4096)}
      {text("url", "HTTPSリンク（任意）", "HTTPS link (optional)", 2048)}
      <label>
        {words(locale, "色（任意）", "Color (optional)")}
        <input
          type="color"
          value={`#${(value.color ?? 0x4a6cf7).toString(16).padStart(6, "0")}`}
          onChange={(e) =>
            onChange({ ...value, color: parseInt(e.target.value.slice(1), 16) })
          }
        />
      </label>
      <label>
        {words(locale, "日時（UTC・任意）", "Timestamp (UTC, optional)")}
        <input
          type="datetime-local"
          value={value.timestamp?.slice(0, 16) ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              timestamp: e.target.value
                ? new Date(e.target.value + "Z").toISOString()
                : undefined,
            })
          }
        />
      </label>
      <label>
        {words(
          locale,
          "作成者の表示名（任意）",
          "Author display name (optional)",
        )}
        <input
          maxLength={256}
          value={value.author?.name ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              author: e.target.value ? { name: e.target.value } : undefined,
            })
          }
        />
      </label>
      <label>
        {words(locale, "末尾の文章（任意）", "Footer text (optional)")}
        <input
          maxLength={2048}
          value={value.footer?.text ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              footer: e.target.value ? { text: e.target.value } : undefined,
            })
          }
        />
      </label>
      {value.fields?.map((field, index) => (
        <fieldset key={index}>
          <legend>
            {words(locale, `項目 ${index + 1}`, `Field ${index + 1}`)}
          </legend>
          <label>
            {words(locale, "項目名", "Field name")}
            <input
              value={field.name}
              maxLength={256}
              onChange={(e) =>
                onChange({
                  ...value,
                  fields: value.fields?.map((item, i) =>
                    i === index ? { ...item, name: e.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <label>
            {words(locale, "項目の内容", "Field value")}
            <textarea
              value={field.value}
              maxLength={1024}
              onChange={(e) =>
                onChange({
                  ...value,
                  fields: value.fields?.map((item, i) =>
                    i === index ? { ...item, value: e.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={field.inline === true}
              onChange={(e) =>
                onChange({
                  ...value,
                  fields: value.fields?.map((item, i) =>
                    i === index ? { ...item, inline: e.target.checked } : item,
                  ),
                })
              }
            />
            {words(locale, "横に並べる", "Display inline")}
          </label>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                fields: value.fields?.filter((_, i) => i !== index),
              })
            }
          >
            {words(locale, "項目を削除", "Delete field")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={(value.fields?.length ?? 0) >= 25}
        onClick={() =>
          onChange({
            ...value,
            fields: [...(value.fields ?? []), { name: "", value: "" }],
          })
        }
      >
        {words(locale, "カードの項目を追加", "Add an embed field")}
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete}>
          {words(locale, "カードを削除", "Delete embed card")}
        </button>
      )}
    </fieldset>
  );
}
