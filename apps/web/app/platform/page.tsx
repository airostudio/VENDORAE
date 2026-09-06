import { isPlatformLicensingConfigured, platformStripe } from "@/lib/platform/stripe";
import PlatformCheckoutForm from "./PlatformCheckoutForm";

// Rendered by apps/web/middleware.ts's rewrite for requests to the bare platform root domain
// (no tenant subdomain) — the marketing/pricing/signup page for a new store license.
export const dynamic = "force-dynamic";

function formatPrice(unitAmount: number, currency: string, interval?: string): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
  return interval ? `${amount}/${interval}` : amount;
}

/**
 * The price is always read live from the Stripe Price object the operator configures
 * (PLATFORM_LICENSE_PRICE_ID) — never hardcoded, since this app has no authority to invent
 * Vendorae's actual business pricing.
 */
async function loadPrice(): Promise<{ label: string } | null> {
  const priceId = process.env.PLATFORM_LICENSE_PRICE_ID;
  if (!priceId || !isPlatformLicensingConfigured()) return null;
  try {
    const price = await platformStripe().prices.retrieve(priceId);
    if (price.unit_amount == null || !price.currency) return null;
    return { label: formatPrice(price.unit_amount, price.currency, price.recurring?.interval) };
  } catch (error) {
    console.error(`[platform] could not load price: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export default async function PlatformPricingPage() {
  const price = await loadPrice();

  return (
    <div className="container-page py-24 max-w-2xl text-center mx-auto">
      <p className="eyebrow mb-3">Vendorae</p>
      <h1 className="font-serif text-4xl mb-4">Launch your own dropshipping store.</h1>
      <p className="text-stone-600 mb-10">
        Pick a name, add your products, connect Stripe or PayPal, and you&rsquo;re live — your own storefront on its
        own subdomain, with the admin dashboard, checkout and fulfillment tooling already built in.
      </p>

      {price ? (
        <>
          <div className="mb-10">
            <p className="text-5xl font-serif mb-1">{price.label}</p>
            <p className="text-sm text-stone-500">One store license, cancel anytime.</p>
          </div>
          <PlatformCheckoutForm />
        </>
      ) : (
        <div className="border border-stone-200 bg-stone-50 p-8">
          <p className="text-stone-600">
            Store licensing isn&rsquo;t configured yet. Check back soon, or contact the operator of this deployment.
          </p>
        </div>
      )}
    </div>
  );
}
