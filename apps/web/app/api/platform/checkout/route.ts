import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { platformStripe, isPlatformLicensingConfigured } from "@/lib/platform/stripe";
import { deriveAvailableSlug } from "@/lib/platform/slug";
import { getPlanBySlug } from "@/lib/platform/plans";
import { provisionFreeTenant } from "@/lib/platform/provisionTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
  planSlug: z.string().trim().min(1, "Plan is required"),
});

/** Absolute base URL on the SAME host the request came in on (the platform apex domain). */
function requestOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin.replace(/\/$/, "");
}

/**
 * Starts platform signup for a chosen plan. Two very different paths depending on the plan:
 *
 *  - A plan with a Stripe Price configured (`stripe_price_id` set) starts a subscription Stripe
 *    Checkout Session, exactly as before — the tenant is NOT created here, only once the license
 *    is actually paid for (see apps/web/lib/platform/provisionTenant.ts, called from the webhook
 *    and/or /platform/welcome).
 *  - The `free` plan ("Start Selling") has no subscription fee at all, so it never touches Stripe:
 *    the tenant is provisioned synchronously, right here, via provisionFreeTenant().
 *
 * Any OTHER plan with no `stripe_price_id` (a paid tier the operator hasn't finished configuring
 * in Stripe yet) is refused rather than silently treated as free — only `free` itself is allowed
 * to bypass payment.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { storeName, email, planSlug } = parsed.data;

  const plan = await getPlanBySlug(planSlug).catch((error) => {
    console.error(`[platform/checkout] could not load plan "${planSlug}": ${error instanceof Error ? error.message : error}`);
    return null;
  });
  if (!plan) return NextResponse.json({ error: "That plan doesn't exist." }, { status: 400 });

  if (!plan.stripePriceId) {
    if (plan.slug !== "free") {
      return NextResponse.json({ error: "This plan isn't available for signup yet." }, { status: 503 });
    }

    const result = await provisionFreeTenant(storeName, email, plan.id, plan.commissionBps);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ url: `/platform/welcome?slug=${encodeURIComponent(result.slug)}` });
  }

  if (!isPlatformLicensingConfigured()) {
    return NextResponse.json({ error: "Store licensing is not configured yet." }, { status: 503 });
  }

  const supabase = createServiceRoleSupabaseClient();

  let slug: string | null;
  try {
    slug = await deriveAvailableSlug(supabase, storeName);
  } catch (error) {
    console.error(`[platform/checkout] slug derivation failed: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Could not validate that store name. Please try again." }, { status: 500 });
  }
  if (!slug) {
    return NextResponse.json({ error: "That store name doesn't contain any usable letters or numbers — try another." }, { status: 400 });
  }

  const origin = requestOrigin(request);
  const metadata = { slug, storeName, planId: plan.id, commissionBps: String(plan.commissionBps) };

  try {
    const session = await platformStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      customer_email: email,
      metadata,
      subscription_data: { metadata },
      success_url: `${origin}/platform/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/platform`,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return NextResponse.json({ url: session.url, slug });
  } catch (error) {
    console.error(`[platform/checkout] could not create checkout session: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}
