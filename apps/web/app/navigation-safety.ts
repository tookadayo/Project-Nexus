"use client";
import { useEffect, useRef, useState } from "react";

/** Drafts stay in component memory. Only confirmed saves advance the baseline. */
export function useDraft<T>(value: T) {
  const [saved, setSaved] = useState(() => JSON.stringify(value));
  return {
    dirty: JSON.stringify(value) !== saved,
    saved: (submitted: T = value) => setSaved(JSON.stringify(submitted)),
    savedPatch: (patch: Partial<T>) =>
      setSaved((previous) =>
        JSON.stringify({ ...JSON.parse(previous), ...patch }),
      ),
  };
}

export function useUnsavedChanges(dirty: boolean, locale: "ja" | "en") {
  const current = useRef(dirty);
  const permittedUnload = useRef(false);
  current.current = dirty;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (permittedUnload.current) {
        permittedUnload.current = false;
        return;
      }
      if (!current.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return (unload = false) => {
    const allowed =
      !current.current ||
      window.confirm(
        locale === "ja"
          ? "未保存の変更または処理中の操作があります。この画面を離れますか？保存していない変更は失われる場合があります。"
          : "You have unsaved changes or an operation in progress. Leave this screen? Unsaved changes may be lost.",
      );
    if (allowed && unload) permittedUnload.current = true;
    return allowed;
  };
}
