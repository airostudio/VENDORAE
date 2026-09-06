import { getActivePlans, type Plan } from "@/lib/platform/plans";
import PlatformCheckoutForm from "./PlatformCheckoutForm";

// Rendered by apps/web/middleware.ts's rewrite for requests to the bare platform root domain
// (no tenant subdomain) — the marketing/pricing/signup page for a new store license.
export const dynamic = "force-dynamic";

/**
 * Price is rendered straight from `plans.monthly_price_cents` — not a live Stripe lookup, unlike
 * the old single-plan version of this page. Most tiers won't have a `stripe_price_id` configured
 * yet (the operator fills those in once they've created the corresponding Stripe Products/Prices),
 * so the database column is the source of truth for what's shown here; the real charge for a
 * configured plan is still whatever its Stripe Price says at checkout time.
 */
function formatPrice(cents: number): string {
  if (cents === 0) return "$0";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
  return `${amount}/month`;
}

/** 200 -> "2%", 25 -> "0.25%" — basis points rendered as a plain percentage. */
function formatCommission(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% commission on direct sales`;
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="border border-stone-200 p-6 flex flex-col text-left">
      <p className="eyebrow mb-2">{plan.name}</p>
      <p className="text-3xl font-serif mb-1">{formatPrice(plan.monthlyPriceCents)}</p>
      <p className="text-sm text-stone-500 mb-4">{formatCommission(plan.commissionBps)}</p>
      <ul className="text-sm text-stone-600 space-y-2 mb-6 flex-1">
        <li>{plan.productLimit == null ? "Unlimited products" : `Up to ${plan.productLimit} products`}</li>
        <li>
          {plan.staffLimit} staff seat{plan.staffLimit === 1 ? "" : "s"}
        </li>
        <li>{plan.customDomainAllowed ? "Custom domain support" : "No custom domain"}</li>
        {plan.featureList.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <PlatformCheckoutForm plan={plan} />
    </div>
  );
}

export default async function PlatformPricingPage() {
  const plans = await getActivePlans();

  return (
    <div className="container-page py-24 max-w-6xl mx-auto">
      <div className="max-w-2xl mx-auto text-center mb-16">
        <p className="eyebrow mb-3">Vendorae</p>
        <h1 className="font-serif text-4xl mb-4">Launch your own dropshipping store.</h1>
        <p className="text-stone-600">
          Pick a name, add your products, connect Stripe or PayPal, and you&rsquo;re live — your own storefront on its
          own subdomain, with the admin dashboard, checkout and fulfillment tooling already built in.
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="border border-stone-200 bg-stone-50 p-8 max-w-2xl mx-auto text-center">
          <p className="text-stone-600">
            Store licensing isn&rsquo;t configured yet. Check back soon, or contact the operator of this deployment.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
