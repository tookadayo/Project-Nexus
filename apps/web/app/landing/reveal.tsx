"use client";
import { useEffect } from "react";
/** Content is visible before JS. Animation never controls scrolling or layout. */
export function GentleReveal() {
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches || !("IntersectionObserver" in window)) return;
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            if (!media.matches)
              animations.push(
                entry.target.animate(
                  [
                    { opacity: 0.8, transform: "translateY(6px)" },
                    { opacity: 1, transform: "none" },
                  ],
                  { duration: 180, easing: "ease-out" },
                ),
              );
          }
      },
      { threshold: 0.15 },
    );
    document
      .querySelectorAll(".nx-feature-row")
      .forEach((el) => observer.observe(el));
    const stop = () => {
      if (media.matches) animations.forEach((a) => a.cancel());
    };
    media.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animations.forEach((a) => a.cancel());
      media.removeEventListener("change", stop);
    };
  }, []);
  return null;
}
