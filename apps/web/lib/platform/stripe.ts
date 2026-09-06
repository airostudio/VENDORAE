import "server-only";
import Stripe from "stripe";

let cachedClient: Stripe | null = null;

/**
 * The PLATFORM's own Stripe client — for charging the platform's own SaaS license fee to
 * Vendorae's Stripe account. Deliberately separate from apps/web/lib/checkout/stripe.ts's
 * `stripe()`, which is the tenant-facing client each store uses for ITS OWN customers' checkout
 * (resolved per-tenant via apps/web/lib/config/paymentCredentials.ts). Conflating the two would
 * mean either charging license fees through a tenant's own Stripe account, or vice versa — never
 * reuse this for tenant checkout or that for platform billing.
 *
 * Built from its own dedicated env var (PLATFORM_STRIPE_SECRET_KEY) rather than STRIPE_SECRET_KEY,
 * so the two can point at entirely different Stripe accounts (or the same account's own keys, if
 * an operator chooses to run both from one account — but that's their choice, not assumed here).
 */
export function platformStripe(): Stripe {
  const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "Platform licensing is not configured: set PLATFORM_STRIPE_SECRET_KEY (the platform's own Stripe secret key, distinct from STRIPE_SECRET_KEY).",
    );
  }
  if (cachedClient) return cachedClient;
  cachedClient = new Stripe(secretKey, { apiVersion: "2024-06-20" });
  return cachedClient;
}

export function isPlatformLicensingConfigured(): boolean {
  return Boolean(process.env.PLATFORM_STRIPE_SECRET_KEY && process.env.PLATFORM_LICENSE_PRICE_ID);
}
