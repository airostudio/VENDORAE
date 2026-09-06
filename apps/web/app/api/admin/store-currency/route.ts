import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { getSettings, updateSettings } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * The store's selling currency, owned by this database (tenant_settings.base_currency, which
 * defaults to USD) rather than by the dropship engine. That default is the point: an unconfigured
 * store is definitively priced in USD instead of inheriting whatever an external service happens
 * to default to.
 *
 * Saving also pushes the same code to the engine's `import.targetCurrency`, so products imported
 * from then on are quoted in the currency the store actually sells in. The engine being
 * unreachable doesn't fail the save — the local value is the source of truth, and the response
 * says whether the engine picked it up.
 */
export async function GET() {
  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase);

  const { data } = await supabase.from("tenant_settings").select("base_currency").eq("tenant_id", tenantId).maybeSingle();

  let importCurrency: string | null = null;
  try {
    const { settings } = await getSettings();
    importCurrency = settings.import.targetCurrency ?? null;
  } catch {
    // The engine being unreachable shouldn't blank the currency screen.
  }

  return NextResponse.json({ storeCurrency: (data?.base_currency as string | undefined) ?? "USD", importCurrency });
}

const bodySchema = z.object({
  // ISO 4217. Two-decimal currencies only: prices are integer cents throughout, so a zero-decimal
  // currency (JPY, KRW) would be charged 100x under that model.
  currency: z.enum(["USD", "AUD", "NZD", "GBP", "EUR", "CAD", "SGD"]),
});

export async function PUT(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a supported currency.", detail: parsed.error.flatten() }, { status: 400 });
  const currency = parsed.data.currency;

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase);

  // Update first, insert only if this tenant has no settings row yet — an insert needs
  // brand_name (not null, no default), which updating an existing row doesn't touch.
  const { data: updated, error: updateError } = await supabase
    .from("tenant_settings")
    .update({ base_currency: currency })
    .eq("tenant_id", tenantId)
    .select("tenant_id");
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (!updated || updated.length === 0) {
    const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId).single();
    const { error: insertError } = await supabase
      .from("tenant_settings")
      .insert({ tenant_id: tenantId, brand_name: tenant?.name ?? "Store", base_currency: currency });
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  let engineSynced = false;
  let engineError: string | null = null;
  try {
    const { settings } = await getSettings();
    await updateSettings({ ...settings, import: { ...settings.import, targetCurrency: currency } });
    engineSynced = true;
  } catch (error) {
    engineError = error instanceof Error ? error.message : "Could not reach the dropship engine";
  }

  return NextResponse.json({ ok: true, storeCurrency: currency, engineSynced, engineError });
}
