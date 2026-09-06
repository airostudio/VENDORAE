import Link from "next/link";
import { getTenantBranding } from "@/lib/tenantSettings";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

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

export const dynamic = "force-dynamic";

/**
 * Whether this tenant has never had a real admin account created — i.e. it's currently reachable
 * only via middleware.ts's break-glass shared-password fallback. Shown as a banner pointing at
 * /admin/create-account so an operator who got in with the shared password discovers the bridge
 * off it without needing to know the URL. Fails closed (no banner) on any error — a DB hiccup
 * shouldn't nag an admin who may already have a real account.
 */
async function isBootstrapTenant(): Promise<boolean> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data } = await supabase.from("memberships").select("id").eq("tenant_id", tenantId).limit(1);
    return !data || data.length === 0;
  } catch {
    return false;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [{ brandName, logoUrl }, bootstrap] = await Promise.all([getTenantBranding(), isBootstrapTenant()]);

  return (
    <div className="min-h-screen bg-warm-100">
      <div className="bg-ink-950 text-warm-50">
        <div className="container-page h-14 flex items-center gap-8 text-sm">
          <span className="font-serif text-lg flex items-center gap-2">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied logo, arbitrary remote host
              <img src={logoUrl} alt={brandName} className="h-6 w-auto object-contain" />
            )}
            {brandName} Admin
          </span>
          <nav className="flex gap-6">
            {sections.map((s) => (
              <Link key={s.href} href={s.href} className="text-stone-300 hover:text-warm-50">
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {bootstrap && (
        <div className="bg-amber-100 text-amber-900 text-sm">
          <div className="container-page py-2">
            You&rsquo;re using the shared admin password. <Link href="/admin/create-account" className="underline font-medium">Create your own admin account</Link>{" "}
            to sign in normally from now on.
          </div>
        </div>
      )}
      <div className="container-page py-10">{children}</div>
    </div>
  );
}
