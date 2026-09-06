import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

// Match tenant_settings' own column defaults (supabase/migrations/0007_checkout_settings.sql) —
// what checkout falls back to when a tenant has no settings row yet.
const DEFAULTS = { shippingFlatRateCents: 995, freeShippingThresholdCents: 10000, taxRatePercent: 0 };

/** Shipping/tax as an admin actually configures them, not the raw column names. */
export async function GET() {
  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase);

  const { data } = await supabase
    .from("tenant_settings")
    .select("shipping_flat_rate_cents, free_shipping_threshold_cents, tax_rate_percent")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return NextResponse.json({
    shippingFlatRateCents: data?.shipping_flat_rate_cents ?? DEFAULTS.shippingFlatRateCents,
    freeShippingThresholdCents: data?.free_shipping_threshold_cents ?? DEFAULTS.freeShippingThresholdCents,
    taxRatePercent: data?.tax_rate_percent ?? DEFAULTS.taxRatePercent,
  });
}

const bodySchema = z.object({
  shippingFlatRateCents: z.number().int().min(0),
  freeShippingThresholdCents: z.number().int().min(0),
  taxRatePercent: z.number().min(0).max(100),
});

export async function PUT(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please check the values entered.", detail: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase);

  const patch = {
    shipping_flat_rate_cents: input.shippingFlatRateCents,
    free_shipping_threshold_cents: input.freeShippingThresholdCents,
    tax_rate_percent: input.taxRatePercent,
  };

  // Try an update first: most tenants already have a tenant_settings row (branding etc.). Only
  // fall back to inserting one if this tenant genuinely has none yet — an insert needs
  // brand_name (not null, no default), which an update to an existing row doesn't touch.
  const { data: updated, error: updateError } = await supabase.from("tenant_settings").update(patch).eq("tenant_id", tenantId).select("tenant_id");
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (!updated || updated.length === 0) {
    const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId).single();
    const { error: insertError } = await supabase.from("tenant_settings").insert({ tenant_id: tenantId, brand_name: tenant?.name ?? "Store", ...patch });
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
