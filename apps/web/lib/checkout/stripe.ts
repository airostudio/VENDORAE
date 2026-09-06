import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * The Stripe client, constructed lazily so a deployment without keys still builds and serves every
 * page that doesn't take payments — only the checkout routes fail, with a message that says why.
 */
export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Payments are not configured: STRIPE_SECRET_KEY is not set on this deployment.");
  }
  cached = new Stripe(key, { apiVersion: "2024-06-20" });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Absolute base URL for Stripe's return redirects — Stripe rejects relative ones. */
export function siteUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const origin = new URL(request.url).origin;
  return origin.replace(/\/$/, "");
}
