import Link from "next/link";

const sections = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/cms", label: "CMS & Banners" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/aliexpress", label: "AliExpress" },
  { href: "/admin/aliexpress/staging", label: "AliExpress Staging" },
  { href: "/admin/aliexpress/settings", label: "Dropship Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-warm-100">
      <div className="bg-ink-950 text-warm-50">
        <div className="container-page h-14 flex items-center gap-8 text-sm">
          <span className="font-serif text-lg">Beach Footprints Admin</span>
          <nav className="flex gap-6">
            {sections.map((s) => (
              <Link key={s.href} href={s.href} className="text-stone-300 hover:text-warm-50">
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="container-page py-10">{children}</div>
    </div>
  );
}
