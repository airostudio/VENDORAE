import "server-only";
import Stripe from "stripe";
import { getStripeCredentials } from "@/lib/config/paymentCredentials";

let cachedKey: string | null = null;
let cachedClient: Stripe | null = null;

/**
 * The Stripe client, constructed lazily so a deployment without keys still builds and serves every
 * page that doesn't take payments — only the checkout routes fail, with a message that says why.
 *
 * The secret key comes from getStripeCredentials(), which prefers this deployment's own
 * STRIPE_SECRET_KEY env var and falls back to whatever the /onboarding wizard saved for the
 * current tenant — so a self-serve owner's own keys work without an operator setting env vars for
 * them. The client is cached by key value (not just once) so a wizard save that changes the key
 * takes effect on the next call instead of being stuck on a stale client from before the save.
 */
export async function stripe(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  if (!secretKey) {
    throw new Error("Payments are not configured: set STRIPE_SECRET_KEY, or complete the Stripe step of the setup wizard.");
  }
  if (cachedClient && cachedKey === secretKey) return cachedClient;
  cachedClient = new Stripe(secretKey, { apiVersion: "2024-06-20" });
  cachedKey = secretKey;
  return cachedClient;
}

export async function isStripeConfigured(): Promise<boolean> {
  const { secretKey } = await getStripeCredentials();
  return Boolean(secretKey);
}

/** Absolute base URL for Stripe's return redirects — Stripe rejects relative ones. */
export function siteUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const origin = new URL(request.url).origin;
  return origin.replace(/\/$/, "");
}
