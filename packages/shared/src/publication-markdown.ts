/** Restricted, dependency-free publication Markdown. Never accepts raw HTML. */
export type PublicationHeading = { id: string; level: number; text: string };
export type PublicationMarkdown = {
  html: string;
  headings: PublicationHeading[];
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

const relativeOrigin = "https://publication.invalid";

/** Check both the original and decoded spelling; do not turn encoded schemes into links. */
function safeUrl(value: string): string | null {
  const classify = (candidate: string): "absolute" | "relative" | null => {
    if (
      !candidate ||
      /[\s\p{Cc}\p{Cf}\\]/u.test(candidate) ||
      /&(?:#|[a-z][a-z\d]*;)/i.test(candidate)
    )
      return null;
    if (candidate.startsWith("//")) return null;
    const absolute = /^https?:\/\//i.test(candidate);
    if (!absolute && /^[^/?#]*:/.test(candidate)) return null;
    try {
      const url = new URL(candidate, relativeOrigin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
      if (!absolute && url.origin !== relativeOrigin) return null;
      return absolute ? "absolute" : "relative";
    } catch {
      return null;
    }
  };
  const kind = classify(value);
  if (!kind) return null;
  let decoded = value;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value;
      if (classify(next) !== kind) return null;
      decoded = next;
    } catch {
      return null;
    }
  }
  // Deeply nested encoding is unnecessary for a publication link and is ambiguous.
  return null;
}

type Inline = { html: string; text: string };
type LinkToken = { label: string; destination: string; end: number };

function closingDelimiters(source: string): Map<number, number> {
  const closing = new Map<number, number>();
  const brackets: number[] = [];
  const parentheses: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") brackets.push(index);
    if (character === "(") parentheses.push(index);
    const start =
      character === "]"
        ? brackets.pop()
        : character === ")"
          ? parentheses.pop()
          : undefined;
    if (start !== undefined) closing.set(start, index);
  }
  return closing;
}

function linkToken(
  source: string,
  start: number,
  closing: Map<number, number>,
): LinkToken | null {
  // Pre-index delimiters so malformed input containing many '[' cannot cause repeated full scans.
  const labelEnd = closing.get(start);
  if (labelEnd === undefined || source[labelEnd + 1] !== "(") return null;
  const destinationEnd = closing.get(labelEnd + 1);
  if (destinationEnd === undefined) return null;
  const rawDestination = source.slice(labelEnd + 2, destinationEnd).trim();
  if (rawDestination.includes("\n")) return null;
  // Optional Markdown link titles are not rendered as attributes.
  const destination = rawDestination.match(
    /^(?:<([^<>]*)>|(\S+?))(?:\s+["'][^"']*["'])?$/,
  );
  if (!destination) return null;
  return {
    label: source.slice(start + 1, labelEnd),
    destination: destination[1] ?? destination[2]!,
    end: destinationEnd + 1,
  };
}

function inline(source: string, depth = 0, links = true): Inline {
  if (depth >= 24) return { html: escapeHtml(source), text: source };
  const closing = closingDelimiters(source);
  let html = "";
  let text = "";
  for (let index = 0; index < source.length;) {
    const character = source[index]!;
    if (
      character === "\\" &&
      /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[index + 1] ?? "")
    ) {
      const escaped = source[index + 1]!;
      html += escapeHtml(escaped);
      text += escaped;
      index += 2;
      continue;
    }
    if (character === "`") {
      const marker = source.slice(index).match(/^`+/)![0];
      let close = source.indexOf(marker, index + marker.length);
      while (
        close >= 0 &&
        (source[close - 1] === "`" || source[close + marker.length] === "`")
      )
        close = source.indexOf(marker, close + marker.length);
      if (close >= 0) {
        let code = source
          .slice(index + marker.length, close)
          .replace(/\n/g, " ");
        if (code.startsWith(" ") && code.endsWith(" ") && /\S/.test(code))
          code = code.slice(1, -1);
        html += `<code>${escapeHtml(code)}</code>`;
        text += code;
        index = close + marker.length;
        continue;
      }
      html += escapeHtml(marker);
      text += marker;
      index += marker.length;
      continue;
    }
    const image = character === "!" && source[index + 1] === "[";
    if ((links && character === "[") || image) {
      const token = linkToken(source, image ? index + 1 : index, closing);
      if (token) {
        const label = inline(token.label, depth + 1, false);
        const href = image ? null : safeUrl(token.destination);
        html += href
          ? `<a href="${escapeHtml(href)}"${/^https?:\/\//i.test(href) ? ' rel="noopener noreferrer"' : ""}>${label.html}</a>`
          : label.html;
        text += label.text;
        index = token.end;
        continue;
      }
    }
    if (character === "*" || character === "_") {
      const marker =
        source[index + 1] === character ? character.repeat(2) : character;
      const insideWord =
        character === "_" &&
        /[\p{L}\p{N}]/u.test(source[index - 1] ?? "") &&
        /[\p{L}\p{N}]/u.test(source[index + marker.length] ?? "");
      const close = insideWord
        ? -1
        : source.indexOf(marker, index + marker.length);
      if (
        close > index + marker.length &&
        !/\s/.test(source[index + marker.length]!) &&
        !/\s/.test(source[close - 1]!)
      ) {
        const content = inline(
          source.slice(index + marker.length, close),
          depth + 1,
          links,
        );
        const tag = marker.length === 2 ? "strong" : "em";
        html += `<${tag}>${content.html}</${tag}>`;
        text += content.text;
        index = close + marker.length;
        continue;
      }
    }
    if (
      character === "\n" &&
      source[index - 1] === " " &&
      source[index - 2] === " "
    ) {
      html = html.slice(0, -2) + "<br>\n";
      text = text.slice(0, -2) + "\n";
      index += 1;
      continue;
    }
    html += escapeHtml(character);
    text += character;
    index += 1;
  }
  return { html, text };
}

function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let codeMarker = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\" && index + 1 < value.length) {
      cell += character + value[++index];
      continue;
    }
    if (character === "`") {
      const marker = value.slice(index).match(/^`+/)![0];
      if (marker === codeMarker) codeMarker = "";
      else if (!codeMarker) codeMarker = marker;
      cell += marker;
      index += marker.length - 1;
      continue;
    }
    if (character === "|" && !codeMarker) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

type ListMarker = {
  indent: number;
  width: number;
  ordered: boolean;
  start: number;
  content: string;
};
function listMarker(line: string): ListMarker | null {
  const match = line.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/);
  if (!match) return null;
  return {
    indent: match[1]!.length,
    width: match[1]!.length + match[2]!.length + match[3]!.length,
    ordered: /^\d/.test(match[2]!),
    start: Number.parseInt(match[2]!, 10) || 1,
    content: match[4]!,
  };
}

function heading(line: string): RegExpMatchArray | null {
  return line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
}
function fence(line: string): RegExpMatchArray | null {
  return line.match(/^ {0,3}(`{3,}|~{3,})([^`~]*)$/);
}
function rule(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    line,
  );
}
function tableDivider(line: string): boolean {
  return (
    line.includes("|") &&
    tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    !line.trim() ||
    !!heading(line) ||
    !!fence(line) ||
    rule(line) ||
    /^ {0,3}>/.test(line) ||
    !!listMarker(line) ||
    (line.includes("|") && tableDivider(lines[index + 1] ?? ""))
  );
}

/** The returned HTML is generated solely from this renderer, including preview and public views. */
export function renderPublicationMarkdown(
  markdown: string,
): PublicationMarkdown {
  const headings: PublicationHeading[] = [];
  const usedIds = new Set<string>();
  const headingId = (text: string): string => {
    const slug =
      text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 100)
        .replace(/-$/g, "") || "section";
    const base = `publication-${slug}`;
    let id = base;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    usedIds.add(id);
    return id;
  };
  const blocks = (lines: string[], depth = 0): string => {
    if (depth >= 24) return `<p>${escapeHtml(lines.join("\n"))}</p>`;
    const output: string[] = [];
    for (let index = 0; index < lines.length;) {
      const line = lines[index]!;
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const fenced = fence(line);
      if (fenced) {
        const marker = fenced[1]!;
        const code: string[] = [];
        index += 1;
        while (
          index < lines.length &&
          !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(
            lines[index]!,
          )
        )
          code.push(lines[index++]!);
        if (index < lines.length) index += 1;
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }
      const title = heading(line);
      if (title) {
        const content = inline(title[2]!);
        // Reserve h1 for the surrounding article title in both reader and preview.
        const level = Math.min(title[1]!.length + 1, 6);
        const id = headingId(content.text);
        headings.push({ id, level, text: content.text });
        output.push(
          `<h${level} id="${escapeHtml(id)}" tabindex="-1">${content.html}</h${level}>`,
        );
        index += 1;
        continue;
      }
      if (rule(line)) {
        output.push("<hr>");
        index += 1;
        continue;
      }
      if (/^ {0,3}>/.test(line)) {
        const quote: string[] = [];
        while (index < lines.length && /^ {0,3}>/.test(lines[index]!))
          quote.push(lines[index++]!.replace(/^ {0,3}>[ \t]?/, ""));
        output.push(`<blockquote>${blocks(quote, depth + 1)}</blockquote>`);
        continue;
      }
      const marker = listMarker(line);
      if (marker) {
        const items: string[] = [];
        while (index < lines.length) {
          const itemMarker = listMarker(lines[index]!);
          if (
            !itemMarker ||
            itemMarker.ordered !== marker.ordered ||
            itemMarker.indent !== marker.indent
          )
            break;
          const itemLines = [itemMarker.content];
          index += 1;
          while (index < lines.length) {
            const next = lines[index]!;
            if (!next.trim()) {
              const following = lines[index + 1] ?? "";
              if (
                !following.trim() ||
                following.match(/^ */)![0].length < itemMarker.width
              )
                break;
              itemLines.push("");
              index += 1;
              continue;
            }
            if (next.match(/^ */)![0].length < itemMarker.width) break;
            itemLines.push(next.slice(itemMarker.width));
            index += 1;
          }
          items.push(`<li>${blocks(itemLines, depth + 1)}</li>`);
          if (
            !lines[index]?.trim() &&
            listMarker(lines[index + 1] ?? "")?.ordered === marker.ordered
          )
            index += 1;
        }
        const tag = marker.ordered ? "ol" : "ul";
        output.push(
          `<${tag}${marker.ordered && marker.start !== 1 ? ` start="${marker.start}"` : ""}>${items.join("")}</${tag}>`,
        );
        continue;
      }
      if (line.includes("|") && tableDivider(lines[index + 1] ?? "")) {
        const headers = tableCells(line);
        const rows: string[] = [];
        index += 2;
        while (
          index < lines.length &&
          lines[index]!.trim() &&
          lines[index]!.includes("|") &&
          !startsBlock(lines, index)
        ) {
          const cells = tableCells(lines[index++]!);
          // Preserve extra cells instead of silently discarding possible legal text.
          rows.push(
            `<tr>${Array.from({ length: Math.max(headers.length, cells.length) }, (_, cell) => `<td>${inline(cells[cell] ?? "").html}</td>`).join("")}</tr>`,
          );
        }
        output.push(
          `<div class="publication-table-scroll" tabindex="0" role="region" aria-label="Scrollable table / 横スクロール可能な表"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inline(cell).html}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
        );
        continue;
      }
      const paragraph = [line];
      index += 1;
      while (index < lines.length && !startsBlock(lines, index))
        paragraph.push(lines[index++]!);
      output.push(`<p>${inline(paragraph.join("\n")).html}</p>`);
    }
    return output.join("\n");
  };
  return {
    html: blocks(markdown.replace(/\r\n?/g, "\n").split("\n")),
    headings,
  };
}
