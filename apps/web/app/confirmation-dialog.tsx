"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
/** Native modal keeps the background inert and restores the initiating control. */
export function ConfirmationDialog({
  label,
  children,
  onCancel,
  busy = false,
  returnFocus,
  className,
}: {
  label: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  returnFocus?: RefObject<HTMLElement | SVGElement | null>;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const source = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => (returnFocus?.current ?? source)?.focus());
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled)",
          ),
        ).filter((item) => item.getClientRects().length > 0);
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="confirmation-body">{children}</div>
    </dialog>
  );
}
