import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { CartProvider } from "@/lib/cart";
import { getNavCategories } from "@/lib/data/categories";
import { getTenantBranding } from "@/lib/tenantSettings";

// Read per request (not the static `metadata` export) so the tab title/description reflect the
// tenant's own business name from the setup wizard instead of a fixed string baked in at build
// time — a store that hasn't onboarded yet still gets a sensible generic title.
export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await getTenantBranding();
  return {
    metadataBase: new URL("https://example.com"),
    title: { default: brandName, template: `%s | ${brandName}` },
    description: `Shop the ${brandName} catalogue.`,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: brandName,
      title: brandName,
      description: `Shop the ${brandName} catalogue.`,
    },
  };
}

// The nav is read per request so a category appears the moment its first product is published.
// That makes every page dynamic, since they all render this layout — the alternative is a header
// frozen at build time, which is the staleness this is meant to remove.
export const dynamic = "force-dynamic";

// Reads the categories that actually have published products, so the header and footer never
// advertise an empty section and pick up a new one as soon as it has stock.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [navCategories, branding] = await Promise.all([getNavCategories(), getTenantBranding()]);

  return (
    <html lang="en">
      <body className="font-sans">
        <CartProvider>
          <Header categories={navCategories} brandName={branding.brandName} logoUrl={branding.logoUrl} />
          <main>{children}</main>
          <Footer categories={navCategories} brandName={branding.brandName} />
        </CartProvider>
      </body>
    </html>
  );
}
