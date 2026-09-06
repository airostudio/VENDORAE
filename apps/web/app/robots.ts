import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/checkout", "/cart"] },
    ],
    sitemap: "https://example.com/sitemap.xml",
  };
}
