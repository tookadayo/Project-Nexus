/** User-provided originals. CSS frames transparent padding; never recolor pixels. */
export function BrandAsset({
  variant = "wordmark",
}: {
  variant?: "wordmark" | "blue" | "navy" | "tile";
}) {
  const file = {
    wordmark: "nexus-wordmark",
    blue: "blue-n",
    navy: "navy-n",
    tile: "navy-tile",
  }[variant];
  return (
    <span className={`brand-asset brand-asset-${variant}`}>
      <img
        src={`/nexus/brand/${file}.png`}
        alt="NEXUS"
        width={variant === "wordmark" ? 2172 : 1254}
        height={variant === "wordmark" ? 724 : 1254}
      />
    </span>
  );
}
