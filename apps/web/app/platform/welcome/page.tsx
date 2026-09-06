import { getPlatformRootDomain } from "@/lib/tenant/host";
import { provisionTenantFromCheckoutSession } from "@/lib/platform/provisionTenant";

// Rendered by apps/web/middleware.ts leaving this apex-domain path alone (see the fix there — only
// the bare "/" gets rewritten to /platform, so this real route is hit directly with its query
// string intact, e.g. ?session_id=cs_test_...).
export const dynamic = "force-dynamic";

/**
 * Provisions the new tenant synchronously on the buyer's landing here, for a fast "your store is
 * ready" experience instead of making them wait on webhook delivery. The webhook
 * (/api/webhooks/platform-stripe) calls the exact same idempotent function, so whichever of the
 * two runs first wins and the other is a safe no-op — see
 * apps/web/lib/platform/provisionTenant.ts for how that race is resolved.
 */
export default async function PlatformWelcomePage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = searchParams.session_id;

  if (!sessionId) {
    return (
      <Shell>
        <p className="text-stone-600">Missing checkout session. If you just completed checkout, check your email for a confirmation.</p>
      </Shell>
    );
  }

  const result = await provisionTenantFromCheckoutSession(sessionId);

  if ("error" in result) {
    // Stripe may not have finalized the session server-side yet, or the webhook hasn't landed —
    // rather than a hard error, tell the buyer it's still in progress. A manual refresh (or the
    // webhook completing shortly) resolves this without any extra engineering here.
    return (
      <Shell>
        <p className="text-stone-600 mb-4">Finishing setup — this can take a few seconds.</p>
        <p className="text-sm text-stone-500">Refresh this page in a moment. If it still hasn&rsquo;t come through, check your email for a confirmation.</p>
      </Shell>
    );
  }

  const storeUrl = `https://${result.slug}.${getPlatformRootDomain()}/onboarding`;

  return (
    <Shell>
      <p className="text-stone-600 mb-6">Your store is ready.</p>
      <a href={storeUrl} className="inline-block bg-stone-900 text-white px-6 py-3 text-sm font-medium">
        Go to your new store &rarr;
      </a>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page py-24 max-w-lg text-center mx-auto">
      <p className="eyebrow mb-3">Vendorae</p>
      <h1 className="font-serif text-3xl mb-6">Welcome aboard</h1>
      {children}
    </div>
  );
}
