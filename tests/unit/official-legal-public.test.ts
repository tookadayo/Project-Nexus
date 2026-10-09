import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Terms from "../../apps/web/app/terms/page";
import Privacy from "../../apps/web/app/privacy/page";
import Legal from "../../apps/web/app/legal/page";
import Beta from "../../apps/web/app/legal/beta/page";
import Operator from "../../apps/web/app/legal/operator/page";
import History from "../../apps/web/app/legal/history/page";
import Support from "../../apps/web/app/support/page";
import { SupportContactForm } from "../../apps/web/app/support/contact-form";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createElement } = requireWeb("react") as typeof import("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};

const state = vi.hoisted(() => ({ locale: "en" as "ja" | "en" }));
vi.mock("../../apps/web/app/public-ui", () => ({
  siteLocale: async () => state.locale,
  copy: <T>(locale: "ja" | "en", ja: T, en: T) => (locale === "ja" ? ja : en),
  SiteShell: ({ children }: { children: ReactNode }) =>
    createElement("main", {}, children),
}));
afterEach(() => vi.unstubAllEnvs());

describe("unreleased public legal documents", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`keeps every legal route unavailable without a candidate fallback (${locale})`, async () => {
      state.locale = locale;
      vi.stubEnv(
        "NEXUS_LEGAL_CONTACTS_PATH",
        "/private-review/synthetic-contacts.json",
      );
      for (const Page of [Terms, Privacy, Legal, Beta, Operator, History]) {
        const html = renderToStaticMarkup(await Page());
        expect(html).toContain(
          locale === "ja"
            ? "公開文書はまだありません"
            : "No published document is available",
        );
        expect(html).toContain(
          locale === "ja"
            ? "利用への同意を受け付ける画面ではありません"
            : "It does not accept agreement to use the service",
        );
        for (const href of [
          "/terms",
          "/privacy",
          "/legal/beta",
          "/legal/operator",
          "/legal/history",
          "/support#general-support",
          "/support#rights-requests",
        ])
          expect(html).toContain(`href="${href}"`);
        expect(html).not.toMatch(
          /要確定|To be confirmed|正式氏名|Legal Name|editor notes|編集者|Publication Candidate|掲載候補|\[Support email/i,
        );
        expect(html).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        expect(html).not.toMatch(
          /<form|<input|<button|<article|mailto:|download=/i,
        );
      }
    });
    it(`makes rights guidance publicly available and preserves alpha14 help anchors (${locale})`, async () => {
      state.locale = locale;
      vi.stubEnv(
        "NEXUS_LEGAL_CONTACTS_PATH",
        "/private-review/synthetic-contacts.json",
      );
      vi.stubEnv(
        "NEXUS_FEEDBACK_URL",
        "https://private.invalid/synthetic-unapproved-contact",
      );
      const html = renderToStaticMarkup(await Support());
      expect(html).toContain('id="rights-requests"');
      expect(html).toContain('id="general-support"');
      expect(html).toContain('id="product-info"');
      expect(html).toContain(
        locale === "ja"
          ? "ログインやDiscordサーバーの管理者権限がなくても"
          : "without signing in to NEXUS or having Discord server administrator access",
      );
      expect(html).toContain(
        locale === "ja"
          ? "受付、本人確認、情報の開示・削除を行いません"
          : "does not accept requests, verify identity, disclose information or delete data",
      );
      expect(html).not.toContain("synthetic-unapproved-contact");
      expect(html).not.toContain("mailto:");
      expect(html).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(html).not.toMatch(/publication-review-body|data-legal-candidate/);
    });
    it(`renders the minimum inquiry fields disabled without a transport or receipt claim (${locale})`, () => {
      const html = renderToStaticMarkup(
        createElement(SupportContactForm, { locale }),
      );
      expect(html).toContain('<fieldset disabled=""');
      const email = html.match(
        /<input[^>]*id="support-reply-email"[^>]*>/,
      )?.[0];
      expect(email).toContain('type="email"');
      expect(email).toContain('name="replyEmail"');
      expect(email).toContain('required=""');
      for (const id of [
        "support-reply-email",
        "support-category",
        "support-subject",
        "support-message",
      ])
        expect(html).toContain(`id="${id}"`);
      expect(html.match(/required=""/g) ?? []).toHaveLength(4);
      expect(html).toContain('<button type="button" disabled=""');
      expect(html).toContain(
        locale === "ja" ? "送信できません" : "Sending unavailable",
      );
      expect(html).not.toMatch(
        /<form|action=|mailto:|name="(?:address|dob|discordId|serverId)"|role="status"/i,
      );
    });
  }
});
