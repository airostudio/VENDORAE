// Rendered by apps/web/middleware.ts's rewrite for storefront requests to a tenant whose platform
// license has been canceled (tenant_licenses.status = 'canceled'). /admin stays reachable so the
// owner can see why and potentially resubscribe — see middleware.ts.
export const dynamic = "force-dynamic";

export default function StoreUnavailablePage() {
  return (
    <div className="container-page py-24 max-w-lg text-center mx-auto">
      <h1 className="font-serif text-3xl mb-4">This store is no longer available.</h1>
      <p className="text-stone-600">The owner&rsquo;s subscription has been canceled. If you&rsquo;re the owner, sign in to /admin to review your billing status.</p>
    </div>
  );
}
