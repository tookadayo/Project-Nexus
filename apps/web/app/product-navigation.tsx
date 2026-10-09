"use client";
import { useRef, type ReactNode } from "react";
export function NavIcon({
  kind,
}: {
  kind: "home" | "analysis" | "attention" | "history" | "settings" | "help";
}) {
  const paths = {
    home: "m3 10 9-7 9 7v10h-6v-6H9v6H3Z",
    analysis: "M4 20V10m8 10V4m8 16v-7",
    attention: "m12 3 10 18H2Zm0 5v6m0 3v1",
    history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v7l4 2",
    settings:
      "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    help: "M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
export function ProductMenu({
  children,
  locale,
}: {
  children: ReactNode;
  locale: "ja" | "en";
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <div className="product-menu">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {locale === "ja" ? "メニュー" : "Menu"}
      </button>
      <dialog
        ref={dialog}
        aria-label={locale === "ja" ? "メニュー" : "Menu"}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], summary, input, select, [tabindex="0"]',
            ),
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="menu-sheet">
          <button autoFocus type="button" onClick={close}>
            {locale === "ja" ? "閉じる" : "Close"}
          </button>
          <div
            onClick={(event) => {
              const element = event.target as HTMLElement;
              if (
                element.closest("a,button") &&
                !element.closest("[data-keep-menu]")
              )
                close();
            }}
          >
            {children}
          </div>
        </div>
      </dialog>
    </div>
  );
}
