import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { CartProvider } from "@/lib/cart";
import { getNavCategories } from "@/lib/data/categories";

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: { default: "Beach Footprints — Boho Surf Lifestyle", template: "%s | Beach Footprints" },
  description: "Boho surf-culture apparel and accessories — woven, hand-dyed and built for barefoot mornings.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Beach Footprints",
    title: "Beach Footprints — Boho Surf Lifestyle",
    description: "Boho surf-culture apparel and accessories for warm sand and salt air.",
  },
};

// The nav is read per request so a category appears the moment its first product is published.
// That makes every page dynamic, since they all render this layout — the alternative is a header
// frozen at build time, which is the staleness this is meant to remove.
export const dynamic = "force-dynamic";

// Reads the categories that actually have published products, so the header and footer never
// advertise an empty section and pick up a new one as soon as it has stock.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navCategories = await getNavCategories();

  return (
    <html lang="en">
      <body className="font-sans">
        <CartProvider>
          <Header categories={navCategories} />
          <main>{children}</main>
          <Footer categories={navCategories} />
        </CartProvider>
      </body>
    </html>
  );
}
