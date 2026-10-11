import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import "./style.css";
import "./product.css";
import "./brand.css";
import { Geist } from "next/font/google";
const geist = Geist({
  subsets: ["latin"],
  variable: "--nx-font-sans",
  display: "swap",
});
export const metadata = {
  icons: {
    icon: "/nexus/brand/navy-tile.png",
    apple: "/nexus/brand/navy-tile.png",
  },
  title: "NEXUS · Discord community operations",
  description:
    "See where newcomers connect, find unanswered posts, understand the evidence, and improve your Discord community.",
};
export default async function Layout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get("nexus_locale")?.value,
    lang =
      saved === "ja" || saved === "en"
        ? saved
        : (await headers())
              .get("accept-language")
              ?.toLowerCase()
              .startsWith("ja")
          ? "ja"
          : "en";
  return (
    <html lang={lang} className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
