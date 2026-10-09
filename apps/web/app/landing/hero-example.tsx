import { text, type Locale } from "./content";
import "./official-refresh.css";

/** Actual Attention UI captured with synthetic data; no live links or mutations. */
export function HeroExample({ locale }: { locale: Locale }) {
  return (
    <figure className="nx-hero-example">
      <figcaption>
        <strong>
          {text(
            locale,
            "Attention · Review eligible posts",
            "要確認 · 対象投稿の返信状況",
          )}
        </strong>
        <span>
          {text(
            locale,
            "Actual UI · Synthetic data · Still image",
            "実画面 · 合成データ · 静止画",
          )}
        </span>
      </figcaption>
      <div
        className="nx-hero-screen-scroll"
        tabIndex={0}
        role="region"
        aria-label={text(
          locale,
          "Attention screenshot; scroll horizontally on small screens",
          "要確認画面の画像。小さな画面では横にスクロールできます",
        )}
      >
        {/* The source screenshot stays unmodified and is served locally. */}
        <img
          src={"/nexus/screens/attention-" + locale + ".png"}
          width={1024}
          height={383}
          alt={text(
            locale,
            "Attention shows one synthetic help-channel post with no response detected, the eligibility conditions and actions for staff review.",
            "要確認画面。返信を確認できない合成のヘルプ投稿1件、対象条件、スタッフが確認するための操作欄を表示。",
          )}
        />
      </div>
      <p className="nx-example-footnote">
        {text(
          locale,
          "This image is not interactive. In the product, check the original post in Discord before recording a staff action. A detected reply does not prove resolution.",
          "この画像は操作できません。製品ではDiscordの元の投稿を確認してから、スタッフの対応を記録します。返信の確認は、問題の解決を意味しません。",
        )}
      </p>
    </figure>
  );
}
