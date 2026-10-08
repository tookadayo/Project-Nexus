"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Brand, Icon } from "./primitives";
import { text, type Locale } from "./content";

export function Navigation({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const previousOverflow = useRef("");
  const links = [
    ["/#features", text(locale, "Product", "製品")],
    ["/#how-it-works", text(locale, "How it works", "使い方")],
    ["/#privacy", text(locale, "Privacy", "プライバシー")],
    ["/pricing", text(locale, "Pricing", "プラン")],
    ["/support", text(locale, "Support", "サポート")],
    ["/billing/payments", text(locale, "My payments", "自分の支払い")],
  ];
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1025px)");
    const close = () => {
      if (media.matches) menu.current?.close();
    };
    media.addEventListener("change", close);
    return () => {
      media.removeEventListener("change", close);
      document.body.style.overflow = previousOverflow.current;
    };
  }, []);
  function openMenu() {
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menu.current?.showModal();
    setOpen(true);
  }
  function restorePage() {
    document.body.style.overflow = previousOverflow.current;
    setOpen(false);
  }
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const elements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("a[href], button"),
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
  const languages = (
    <form action="/locale" method="post" className="nx-language">
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
  return (
    <>
      <header className="nx-header">
        <div className="nx-container nx-nav-inner">
          <a href="/" aria-label={text(locale, "Nexus home", "Nexus ホーム")}>
            <Brand />
          </a>
          <nav
            className="nx-desktop-nav"
            aria-label={text(locale, "Main navigation", "メインナビゲーション")}
          >
            {links.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="nx-nav-actions">
            <form action="/locale" method="post">
              <button
                className="nx-language-toggle"
                name="locale"
                value={locale === "en" ? "ja" : "en"}
                aria-label={
                  locale === "en" ? "日本語に切り替え" : "Switch to English"
                }
              >
                {locale === "en" ? "JA" : "EN"}
              </button>
            </form>
            <a
              className="nx-button nx-button-small nx-button-outline"
              href="/auth/login"
            >
              {text(locale, "Log in", "ログイン")}
              <Icon name="arrow" size={16} />
            </a>
          </div>
          <button
            className="nx-menu-trigger"
            aria-label={text(locale, "Open menu", "メニューを開く")}
            aria-expanded={open}
            aria-controls="nexus-mobile-menu"
            onClick={openMenu}
          >
            <Icon name="menu" />
          </button>
        </div>
      </header>
      <dialog
        ref={menu}
        id="nexus-mobile-menu"
        className="nx-mobile-menu"
        aria-label={text(locale, "Navigation menu", "ナビゲーションメニュー")}
        onKeyDown={trapFocus}
        onCancel={restorePage}
        onClose={restorePage}
      >
        <div className="nx-mobile-top">
          <Brand />
          <button
            autoFocus
            onClick={() => menu.current?.close()}
            aria-label={text(locale, "Close menu", "メニューを閉じる")}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav
          aria-label={text(
            locale,
            "Mobile navigation",
            "モバイルナビゲーション",
          )}
        >
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => menu.current?.close()}>
              {label}
              <Icon name="arrow" size={18} />
            </a>
          ))}
        </nav>
        <a className="nx-button nx-button-primary" href="/auth/login">
          {text(locale, "Log in", "ログイン")}
          <Icon name="arrow" size={18} />
        </a>
        {languages}
      </dialog>
    </>
  );
}
