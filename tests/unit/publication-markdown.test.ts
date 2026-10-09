import { describe, expect, it } from "vitest";
import { renderPublicationMarkdown } from "../../packages/shared/src/publication-markdown";

describe("restricted publication Markdown shared by preview and public pages", () => {
  it("preserves Japanese and English clauses, emphasis, code, and paragraphs", () => {
    const result = renderPublicationMarkdown(
      "# 第1条　適用と運営者\r\n\r\n**重要な条件**と*補足*。\r\n次の行。\r\n\r\n## Section 2. Scope\r\n\r\nUse `account_id` and retain literal snake_case.",
    );
    expect(result.headings).toEqual([
      {
        id: "publication-第1条-適用と運営者",
        level: 2,
        text: "第1条　適用と運営者",
      },
      { id: "publication-section-2-scope", level: 3, text: "Section 2. Scope" },
    ]);
    expect(result.html).toContain(
      'id="publication-第1条-適用と運営者" tabindex="-1"',
    );
    expect(result.html).toContain(
      "<strong>重要な条件</strong>と<em>補足</em>。\n次の行。",
    );
    expect(result.html).toContain(
      "Use <code>account_id</code> and retain literal snake_case.",
    );
  });

  it("gives deterministic unique ids even when a suffix is part of a heading", () => {
    const source =
      "## Rights\n\n## Rights\n\n## Rights-2\n\n## **Rights**\n\n## <script>\n\n## !!!";
    const result = renderPublicationMarkdown(source);
    expect(result.headings.map((item) => item.id)).toEqual([
      "publication-rights",
      "publication-rights-2",
      "publication-rights-2-2",
      "publication-rights-3",
      "publication-script",
      "publication-section",
    ]);
    expect(renderPublicationMarkdown(source)).toEqual(result);
    expect(result.html).not.toContain("<script>");
    expect(result.headings[4]?.text).toBe("<script>");
  });

  it("nests body headings under the article title and reports their rendered levels", () => {
    const result = renderPublicationMarkdown(
      "# First\n\n## Second\n\n##### Fifth\n\n###### Sixth",
    );
    expect(result.headings.map(({ level }) => level)).toEqual([2, 3, 6, 6]);
    expect(result.html).not.toContain("<h1");
    for (const { id, level, text } of result.headings)
      expect(result.html).toContain(
        `<h${level} id="${id}" tabindex="-1">${text}</h${level}>`,
      );
  });

  it("keeps long headings and paragraphs complete while bounding anchor length", () => {
    const text = "日本語の重要な条文".repeat(300);
    const result = renderPublicationMarkdown(`# ${text}\n\n${text}`);
    expect(result.headings[0]?.text).toBe(text);
    expect(result.headings[0]!.id.length).toBeLessThanOrEqual(112);
    expect(result.html).toContain(`<p>${text}</p>`);
  });

  it.each([
    "<script>alert(1)</script>",
    '<iframe src="https://tracker.example"></iframe>',
    '<img src=x onerror="alert(1)">',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    "<style>body{background:url(https://tracker.example)}</style>",
    '<input autofocus onfocus="alert(1)">',
    "<!-- hidden -->&lt;script&gt;",
  ])("renders raw HTML as visible escaped text: %s", (source) => {
    const result = renderPublicationMarkdown(source);
    expect(result.html).toBe(
      `<p>${source.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)}</p>`,
    );
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,attack",
    "vbscript:msgbox(1)",
    "//evil.example/path",
    "\\\\evil.example/path",
    "/\\evil.example/path",
    "https://good.example\\@evil.example/",
    "javascript%3Aalert(1)",
    "javascript%253Aalert(1)",
    "%2f%2fevil.example",
    "/%2Fevil.example",
    "https%3A//evil.example",
    "java%09script:alert(1)",
    "https://good.example/%0d%0aattack",
    "javascript&#58;alert(1)",
    "javascript&colon;alert(1)",
    "https://user:password@example.org",
    "file:///C:/secret",
    "mailto:operator@example.org",
    "https://example.org/%ZZ",
    "java\u200bscript:alert(1)",
  ])("does not create a link for unsafe or ambiguous URL %s", (url) => {
    const result = renderPublicationMarkdown(`[Read this](${url})`);
    expect(result.html).not.toContain("<a ");
    expect(result.html).toContain("Read this");
  });

  it.each([
    "https://example.org/legal?version=1&lang=en#terms",
    "http://localhost:3100/news",
    "/legal/privacy",
    "./previous",
    "../terms",
    "#publication-section-1",
    "?lang=ja",
    "news/current",
    "/legal/%E6%97%A5%E6%9C%AC%E8%AA%9E",
    "https://example.org/path_(v1)",
  ])("accepts a safe link %s", (url) => {
    const result = renderPublicationMarkdown(`[Read this](${url})`);
    expect(result.html).toContain(`<a href="${url.replace(/&/g, "&amp;")}"`);
    expect(result.html).toContain(">Read this</a>");
    expect(result.html).not.toContain("target=");
  });

  it("escapes attributes and link labels and ignores optional title attributes", () => {
    const result = renderPublicationMarkdown(
      '[<img src=x>](https://example.org/"test "ordinary title")',
    );
    expect(result.html).toContain('href="https://example.org/&quot;test"');
    expect(result.html).toContain("&lt;img src=x&gt;</a>");
    expect(result.html).not.toContain(" title=");
    expect(result.html).toContain('rel="noopener noreferrer"');
  });

  it("does not create nested anchor elements", () => {
    const result = renderPublicationMarkdown(
      "[outer [inner](https://inner.example)](https://outer.example)",
    );
    expect(result.html.match(/<a /g)).toHaveLength(1);
    expect(result.html).toContain("https://outer.example");
  });

  it("renders image alternatives without loading an image, iframe, or embedded content", () => {
    const result = renderPublicationMarkdown(
      "![見取り図](https://tracker.example/pixel?id=secret)\n\n![<script>](data:image/svg+xml,attack)",
    );
    expect(result.html).toBe("<p>見取り図</p>\n<p>&lt;script&gt;</p>");
    expect(result.html).not.toMatch(/<(?:img|iframe|object|embed|script)\b/);
    expect(result.html).not.toContain("tracker.example");
  });

  it("preserves unordered, ordered, nested, and quoted clauses", () => {
    const result = renderPublicationMarkdown(
      "- First clause\n  - Nested clause\n- Second clause\n\n3. Third clause\n4. Fourth clause\n\n> Important notice\n>\n> **Rights are preserved.**\n\n---",
    );
    expect(result.html).toContain(
      "<ul><li><p>First clause</p>\n<ul><li><p>Nested clause</p></li></ul></li><li><p>Second clause</p></li></ul>",
    );
    expect(result.html).toContain(
      '<ol start="3"><li><p>Third clause</p></li><li><p>Fourth clause</p></li></ol>',
    );
    expect(result.html).toContain(
      "<blockquote><p>Important notice</p>\n<p><strong>Rights are preserved.</strong></p></blockquote>",
    );
    expect(result.html).toContain("<hr>");
  });

  it("renders legal retention tables without losing extra text or escaped pipes", () => {
    const result = renderPublicationMarkdown(
      "| Category | Retention |\n| :--- | ---: |\n| Events | **7 days** |\n| Logs \\| traces | `a|b` | extra qualification |\n\nFollowing clause.",
    );
    expect(result.html).toContain(
      '<div class="publication-table-scroll" tabindex="0" role="region" aria-label="Scrollable table / 横スクロール可能な表">',
    );
    expect(result.html).toContain(
      '<th scope="col">Category</th><th scope="col">Retention</th>',
    );
    expect(result.html).toContain(
      "<tr><td>Events</td><td><strong>7 days</strong></td></tr>",
    );
    expect(result.html).toContain(
      "<tr><td>Logs | traces</td><td><code>a|b</code></td><td>extra qualification</td></tr>",
    );
    expect(result.html).toContain("<p>Following clause.</p>");
  });

  it("escapes fenced code and leaves unclosed fences readable", () => {
    expect(
      renderPublicationMarkdown(
        "```html\n<script>alert(1)</script>\n```\n\nEnd.",
      ).html,
    ).toBe(
      "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>\n<p>End.</p>",
    );
    expect(renderPublicationMarkdown("~~~\n<img src=x>").html).toBe(
      "<pre><code>&lt;img src=x&gt;</code></pre>",
    );
    expect(renderPublicationMarkdown("`` a ` b ``").html).toBe(
      "<p><code>a ` b</code></p>",
    );
  });

  it("keeps hard line breaks separate from spaces inside code", () => {
    expect(renderPublicationMarkdown("Line one  \nLine two").html).toBe(
      "<p>Line one<br>\nLine two</p>",
    );
    expect(renderPublicationMarkdown("`code  `\nLine two").html).toBe(
      "<p><code>code  </code>\nLine two</p>",
    );
  });

  it("handles empty, malformed, and deeply nested input without executing HTML", () => {
    expect(renderPublicationMarkdown(" \n\n")).toEqual({
      html: "",
      headings: [],
    });
    const result = renderPublicationMarkdown(
      "> ".repeat(100) +
        "<script>payload</script>\n\n[broken](javascript:alert(1)\n\n\\*literal\\*",
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<a ");
    expect(result.html).toContain("*literal*");
  });

  it("keeps a long run of unmatched link delimiters readable", () => {
    const text = "[".repeat(30_000) + "未完のリンク";
    expect(renderPublicationMarkdown(text).html).toBe(`<p>${text}</p>`);
  });
});
