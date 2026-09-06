// Rendered by apps/web/middleware.ts's rewrite for requests to the bare platform root domain
// (no tenant subdomain) — Phase 2 will replace this with the real marketing/pricing/signup site.
export const dynamic = "force-dynamic";

export default function PlatformComingSoonPage() {
  return (
    <div className="container-page py-24 max-w-2xl text-center mx-auto">
      <p className="eyebrow mb-3">Vendorae</p>
      <h1 className="font-serif text-4xl mb-4">The multi-store platform is coming soon.</h1>
      <p className="text-stone-600">
        Vendorae is becoming a single platform hosting many independent storefronts, each on its own subdomain. Plans,
        pricing and self-serve signup aren&rsquo;t live yet — check back soon.
      </p>
    </div>
  );
}
