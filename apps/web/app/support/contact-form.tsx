import { copy, type SiteLocale } from "../public-ui";

// No transport, handler, action, storage, or contact-setting read exists here.
// Inputs stay disabled until a separate approved intake path is implemented.
export function SupportContactForm({ locale }: { locale: SiteLocale }) {
  return (
    <div
      className="support-contact-form"
      role="group"
      aria-labelledby="contact-form-title"
      aria-describedby="contact-unavailable contact-privacy"
    >
      <h3 id="contact-form-title">
        {copy(locale, "一般お問い合わせフォーム", "General support form")}
      </h3>
      <p id="contact-unavailable" className="support-unavailable">
        {copy(
          locale,
          "送信先と受付経路の準備中のため、フォームは利用できません。この画面から情報が送信・受け付けられることはありません。",
          "The form is unavailable while the contact destination and intake service are being prepared. This page does not send or accept any information.",
        )}
      </p>
      <fieldset disabled aria-describedby="contact-unavailable">
        <legend>
          {copy(
            locale,
            "お問い合わせの項目（すべて必須）",
            "Inquiry fields (all required)",
          )}
        </legend>
        <label htmlFor="support-reply-email">
          {copy(locale, "返信用メールアドレス", "Reply email address")}
        </label>
        <input
          id="support-reply-email"
          name="replyEmail"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
        <label htmlFor="support-category">
          {copy(locale, "お問い合わせ区分", "Category")}
        </label>
        <select id="support-category" name="category" required defaultValue="">
          <option value="" disabled>
            {copy(locale, "区分を選択", "Choose a category")}
          </option>
          <option value="question">
            {copy(
              locale,
              "使い方・一般的な質問",
              "Usage and general questions",
            )}
          </option>
          <option value="problem">
            {copy(locale, "不具合の報告", "Problem report")}
          </option>
          <option value="beta">
            {copy(locale, "招待Betaについて", "Invitation Beta")}
          </option>
        </select>
        <label htmlFor="support-subject">
          {copy(locale, "件名", "Subject")}
        </label>
        <input
          id="support-subject"
          name="subject"
          type="text"
          maxLength={160}
          required
        />
        <label htmlFor="support-message">
          {copy(locale, "内容", "Message")}
        </label>
        <textarea
          id="support-message"
          name="message"
          rows={6}
          maxLength={5000}
          required
        />
        <button type="button" disabled>
          {copy(locale, "送信できません", "Sending unavailable")}
        </button>
      </fieldset>
      <p id="contact-privacy">
        {copy(
          locale,
          "お問い合わせには返信先と必要な内容だけを使用します。住所・生年月日・身分証を一律に求めません。Discord IDやサーバーIDは特定が必要な場合に限って案内します。秘密鍵、パスワード、トークン、決済情報を含めないでください。",
          "An inquiry needs only a reply address and the information needed to describe it. Address, date of birth and identity documents are not routinely required. Discord or server IDs are requested only when needed to identify an issue. Do not include private keys, passwords, tokens or payment information.",
        )}
      </p>
      <p>
        <a href="/privacy">
          {copy(
            locale,
            "プライバシーポリシーの公開状況",
            "Privacy Policy availability",
          )}
        </a>
      </p>
    </div>
  );
}
