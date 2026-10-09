"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Brand, Icon } from "./primitives";
import { text, type Locale } from "./content";
import "./navigation.css";

type NavigationLink = { href: string; label: string };
type NavigationGroup = NavigationLink & {
  id: string;
  primary: NavigationLink[];
  secondary: NavigationLink[];
};

function navigationGroups(locale: Locale): NavigationGroup[] {
  const link = (href: string, en: string, ja: string) => ({
    href,
    label: text(locale, en, ja),
  });
  return [
    {
      id: "product",
      ...link("/product", "Product", "製品"),
      primary: [
        link("/product", "Explore NEXUS", "NEXUSでできること"),
        link(
          "/#features",
          "Community activity and follow-up",
          "活動の確認と運営の対応",
        ),
      ],
      secondary: [
        link("/#demo", "Try the sample demo", "サンプルデモを試す"),
        link("/#privacy", "The data NEXUS uses", "使うデータと分かること"),
        link("/privacy", "Privacy policy", "プライバシーポリシー"),
      ],
    },
    {
      id: "guide",
      ...link("/#how-it-works", "How it works", "使い方"),
      primary: [
        link(
          "/#how-it-works",
          "Getting started with NEXUS",
          "NEXUSを使い始めるまで",
        ),
        link("/#demo", "Explore the sample demo", "サンプルデモで使い方を知る"),
      ],
      secondary: [
        link(
          "/#invitation-beta",
          "Joining Closed Beta 1",
          "Closed Beta 1の参加について",
        ),
        link("/support", "Get support", "サポートを見る"),
      ],
    },
    {
      id: "pricing",
      ...link("/pricing", "Pricing", "料金"),
      primary: [
        link("/pricing", "Compare all five plans", "5つのプランを比較する"),
      ],
      secondary: [
        link(
          "/#invitation-beta",
          "Closed Beta 1 access",
          "Closed Beta 1の参加条件",
        ),
        link("/billing/payments", "My payments", "自分の支払い"),
        link("/support", "Questions about plans", "プランについての問い合わせ"),
      ],
    },
    {
      id: "news",
      ...link("/news", "News", "お知らせ"),
      primary: [link("/news", "NEXUS updates", "NEXUSのお知らせ")],
      secondary: [
        link("/support", "Support", "サポート"),
        link("/legal", "Documents and operator", "文書・運営者情報"),
      ],
    },
    {
      id: "support",
      ...link("/support", "Support", "サポート"),
      primary: [
        link("/support", "Contact and support", "問い合わせとサポート"),
      ],
      secondary: [
        link("/terms", "Terms of service", "利用規約"),
        link("/privacy", "Privacy policy", "プライバシーポリシー"),
        link("/legal", "Documents and operator", "文書・運営者情報"),
        link("/billing/payments", "My payments", "自分の支払い"),
      ],
    },
  ];
}

export function Navigation({ locale }: { locale: Locale }) {
  const [enhanced, setEnhanced] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousOverflow = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const groups = navigationGroups(locale);

  function clearTimers() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    hoverTimer.current = null;
    leaveTimer.current = null;
  }
  function showPanel(id: string | null) {
    clearTimers();
    activeRef.current = id;
    setActive(id);
  }
  function hoverGroup(id: string, pointerType: string) {
    clearTimers();
    if (
      pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    // Do not replace a panel beneath a keyboard user's focus.
    if (
      header.current
        ?.querySelector(".nx-nav-panel:not([hidden])")
        ?.contains(document.activeElement)
    )
      return;
    hoverTimer.current = setTimeout(() => showPanel(id), 150);
  }
  function leaveNavigation() {
    clearTimers();
    leaveTimer.current = setTimeout(() => {
      if (!header.current?.contains(document.activeElement)) showPanel(null);
    }, 200);
  }
  function closeMobile() {
    menu.current?.close();
  }
  function restorePage() {
    if (previousOverflow.current !== null) {
      document.body.style.overflow = previousOverflow.current;
      previousOverflow.current = null;
    }
    setMobileOpen(false);
    if (window.matchMedia("(max-width: 69.999rem)").matches)
      mobileTrigger.current?.focus();
  }
  function openMobile() {
    showPanel(null);
    if (!menu.current || menu.current.open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menu.current.showModal();
    menu.current.scrollTop = 0;
    setMobileOpen(true);
  }
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const elements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      ),
    );
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  useEffect(() => {
    setEnhanced(true);
    const desktop = window.matchMedia("(min-width: 70rem)");
    const onResize = () => {
      clearTimers();
      activeRef.current = null;
      setActive(null);
      if (desktop.matches) menu.current?.close();
    };
    const onOutside = (event: Event) => {
      if (!header.current?.contains(event.target as Node)) {
        clearTimers();
        activeRef.current = null;
        setActive(null);
      }
    };
    desktop.addEventListener("change", onResize);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      clearTimers();
      desktop.removeEventListener("change", onResize);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
      if (previousOverflow.current !== null)
        document.body.style.overflow = previousOverflow.current;
    };
  }, []);

  const languages = (
    <form
      action="/locale"
      method="post"
      className="nx-nav-languages"
      aria-label={text(locale, "Language", "言語")}
    >
      <button
        name="locale"
        value="ja"
        aria-current={locale === "ja" ? "true" : undefined}
      >
        日本語
      </button>
      <span aria-hidden="true">/</span>
      <button
        name="locale"
        value="en"
        aria-current={locale === "en" ? "true" : undefined}
      >
        English
      </button>
    </form>
  );
  const secondaryLinks = groups
    .flatMap((group) => group.secondary)
    .filter(
      (link, index, all) =>
        all.findIndex((item) => item.href === link.href) === index &&
        !groups.some((group) => group.href === link.href) &&
        link.href !== "/#invitation-beta",
    );
  const betaLabel = text(locale, "Closed Beta 1", "Closed Beta 1");
  return (
    <div className="nx-navigation" data-enhanced={enhanced}>
      <header
        ref={header}
        className="nx-site-header"
        onPointerEnter={() => {
          if (leaveTimer.current) clearTimeout(leaveTimer.current);
        }}
        onPointerLeave={leaveNavigation}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !activeRef.current) return;
          event.preventDefault();
          const trigger = triggers.current[activeRef.current];
          showPanel(null);
          trigger?.focus();
        }}
      >
        <div className="nx-nav-bar">
          <a
            className="nx-nav-home"
            href="/"
            aria-label={text(locale, "NEXUS home", "NEXUS ホーム")}
          >
            <Brand />
          </a>
          <nav
            className="nx-nav-main"
            aria-label={text(locale, "Main navigation", "メインナビゲーション")}
          >
            {groups.map((group) => (
              <div
                className="nx-nav-item"
                key={group.id}
                onPointerEnter={(event) =>
                  hoverGroup(group.id, event.pointerType)
                }
                onPointerLeave={() => {
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                }}
              >
                <a href={group.href} onClick={() => showPanel(null)}>
                  {group.label}
                </a>
                <button
                  ref={(element) => {
                    triggers.current[group.id] = element;
                  }}
                  className="nx-nav-disclosure"
                  type="button"
                  aria-label={text(
                    locale,
                    group.label + " menu",
                    group.label + "のメニュー",
                  )}
                  aria-expanded={active === group.id}
                  aria-controls={"nexus-nav-" + group.id}
                  onClick={() =>
                    showPanel(activeRef.current === group.id ? null : group.id)
                  }
                >
                  <Icon name="chevron" size={12} />
                </button>
              </div>
            ))}
          </nav>
          <div className="nx-nav-desktop-actions">
            <form action="/locale" method="post">
              <button
                className="nx-nav-language-switch"
                name="locale"
                value={locale === "en" ? "ja" : "en"}
                aria-label={
                  locale === "en"
                    ? "JA — 日本語に切り替え"
                    : "EN — Switch to English"
                }
              >
                {locale === "en" ? "JA" : "EN"}
              </button>
            </form>
            <a className="nx-nav-login" href="/auth/login">
              {text(locale, "Log in", "ログイン")}
            </a>
            <a className="nx-nav-beta" href="/#invitation-beta">
              {betaLabel}
              <Icon name="arrow" size={15} />
            </a>
          </div>
          <button
            ref={mobileTrigger}
            className="nx-nav-mobile-trigger"
            type="button"
            aria-label={text(locale, "Open menu", "メニューを開く")}
            aria-expanded={mobileOpen}
            aria-controls="nexus-mobile-menu"
            onClick={openMobile}
          >
            <Icon name="menu" />
          </button>
        </div>
        <div className="nx-nav-panels" hidden={!active}>
          {groups.map((group) => (
            <nav
              className="nx-nav-panel"
              key={group.id}
              id={"nexus-nav-" + group.id}
              aria-label={text(
                locale,
                group.label + " links",
                group.label + "のリンク",
              )}
              hidden={active !== group.id}
            >
              <div className="nx-nav-primary-links">
                {group.primary.map((link) => (
                  <a
                    href={link.href}
                    key={link.href}
                    onClick={() => showPanel(null)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
              <div className="nx-nav-secondary-links">
                {group.secondary.map((link) => (
                  <a
                    href={link.href}
                    key={link.href}
                    onClick={() => showPanel(null)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </nav>
          ))}
        </div>
      </header>
      {/* Server-rendered native disclosure remains usable if scripts are blocked or fail. */}
      {!enhanced && (
        <details className="nx-nav-fallback">
          <summary>{text(locale, "Menu", "メニュー")}</summary>
          <nav
            aria-label={text(locale, "Site navigation", "サイトナビゲーション")}
          >
            {groups.map((group) => (
              <a key={group.id} href={group.href}>
                {group.label}
              </a>
            ))}
            {secondaryLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            <a href="/#invitation-beta">
              {text(
                locale,
                "Joining Closed Beta 1",
                "Closed Beta 1の参加について",
              )}
            </a>
            <a href="/auth/login">{text(locale, "Log in", "ログイン")}</a>
          </nav>
          {languages}
        </details>
      )}
      <dialog
        ref={menu}
        id="nexus-mobile-menu"
        className="nx-nav-mobile"
        aria-labelledby="nexus-mobile-title"
        onKeyDown={trapFocus}
        onCancel={restorePage}
        onClose={restorePage}
      >
        <div className="nx-nav-mobile-top">
          <h2 id="nexus-mobile-title">{text(locale, "Menu", "メニュー")}</h2>
          <button
            type="button"
            autoFocus
            onClick={closeMobile}
            aria-label={text(locale, "Close menu", "メニューを閉じる")}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav
          className="nx-nav-mobile-primary"
          aria-label={text(locale, "Main navigation", "メインナビゲーション")}
        >
          {groups.map((group) => (
            <a key={group.id} href={group.href} onClick={closeMobile}>
              {group.label}
              <Icon name="arrow" size={20} />
            </a>
          ))}
        </nav>
        <div className="nx-nav-mobile-actions">
          <a
            className="nx-nav-beta"
            href="/#invitation-beta"
            onClick={closeMobile}
          >
            {text(
              locale,
              "Joining Closed Beta 1",
              "Closed Beta 1の参加について",
            )}
            <Icon name="arrow" size={16} />
          </a>
          <a className="nx-nav-login" href="/auth/login" onClick={closeMobile}>
            {text(locale, "Log in", "ログイン")}
          </a>
        </div>
        {languages}
        <nav
          className="nx-nav-mobile-secondary"
          aria-label={text(locale, "More information", "関連情報")}
        >
          {secondaryLinks.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMobile}>
              {link.label}
            </a>
          ))}
        </nav>
      </dialog>
    </div>
  );
}
