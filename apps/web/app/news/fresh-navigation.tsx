"use client";

import { useEffect } from "react";

export function FreshNewsNavigation() {
  useEffect(() => {
    const refreshRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", refreshRestoredPage);
    return () => window.removeEventListener("pageshow", refreshRestoredPage);
  }, []);
  return null;
}
