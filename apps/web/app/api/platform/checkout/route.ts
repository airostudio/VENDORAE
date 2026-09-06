import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { platformStripe, isPlatformLicensingConfigured } from "@/lib/platform/stripe";
import { deriveAvailableSlug } from "@/lib/platform/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
});

/** Absolute base URL on the SAME host the request came in on (the platform apex domain). */
function requestOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin.replace(/\/$/, "");
}

/**
 * Starts a platform Stripe Checkout Session (subscription mode) for a new store license. Does
 * NOT create the tenant — that only happens once the license is actually paid for, via
 * apps/web/lib/platform/provisionTenant.ts, called from the webhook and/or /platform/welcome.
 */
export async function POST(request: Request) {
  if (!isPlatformLicensingConfigured()) {
    return NextResponse.json({ error: "Store licensing is not configured yet." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { storeName, email } = parsed.data;

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

  try {
    const session = await platformStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.PLATFORM_LICENSE_PRICE_ID!, quantity: 1 }],
      customer_email: email,
      metadata: { slug, storeName },
      subscription_data: { metadata: { slug, storeName } },
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
