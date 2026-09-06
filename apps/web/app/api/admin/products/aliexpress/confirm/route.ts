import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { commitAliExpressImport } from "@/lib/import/commitAliExpressImport";
import { getStagedProduct } from "@/lib/import/staging";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  stagedIds: z.array(z.string().uuid()).min(1).max(25),
  tenant: z.string().optional(),
});

interface ConfirmOutcome {
  stagedId: string;
  ok: boolean;
  handle?: string;
  productId?: string;
  isNewProduct?: boolean;
  /** DRAFT products are real products but deliberately invisible on the storefront until published. */
  status?: "DRAFT" | "PUBLISHED";
  error?: string;
}

/**
 * Commits reviewed staged products into the store. This is the gate: a product only becomes real
 * here, using the copy/pricing/category as the admin last edited it. Each id is committed
 * independently so one bad row can't roll back the rest of a bulk confirmation — the response says
 * exactly which succeeded and which didn't.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  const results: ConfirmOutcome[] = [];
  for (const stagedId of parsed.data.stagedIds) {
    try {
      const staged = await getStagedProduct(supabase, tenantId, stagedId);
      if (!staged) {
        results.push({ stagedId, ok: false, error: "Staged product not found" });
        continue;
      }
      if (staged.status === "failed") {
        results.push({ stagedId, ok: false, error: staged.error ?? "This product failed to import and can't be confirmed" });
        continue;
      }

      const committed = await commitAliExpressImport(supabase, { tenantId, staged });

      // Checked, and checked for having matched a row: the product is already written at this
      // point, so an unmarked staged row leaves the item sitting in the review queue as though it
      // had never been confirmed — and confirming it again is the natural next thing to try.
      // (That re-confirm is safe: the commit finds the existing variant by supplier product id and
      // updates the same product rather than creating a second one.) Silence here was how a
      // promoted product stayed in staging with nothing to explain it.
      const { data: marked, error: markError } = await supabase
        .from("aliexpress_staged_products")
        .update({ status: "confirmed", confirmed_product_id: committed.productId, confirmed_at: new Date().toISOString() })
        .eq("id", stagedId)
        .eq("tenant_id", tenantId)
        .select("id");

      if (markError || (marked ?? []).length === 0) {
        const reason = markError?.message ?? "the staged row did not match on its tenant";
        console.error(`[aliexpress/confirm] UNMARKED staged=${stagedId} product=${committed.productId} tenant=${tenantId}: ${reason}`);
        results.push({
          stagedId,
          ok: false,
          handle: committed.handle,
          productId: committed.productId,
          isNewProduct: committed.isNewProduct,
          error:
            `"${committed.handle}" was added to the store, but it could not be cleared from this queue: ${reason}. ` +
            "It is in Products now — remove the staged row here, or confirm again, which updates the same product rather than creating a second one.",
        });
        continue;
      }

      // Logged so a "it said confirmed but I can't find it" report can be traced from the
      // runtime logs alone — response bodies aren't recorded there.
      console.log(
        `[aliexpress/confirm] committed staged=${stagedId} product=${committed.productId} handle=${committed.handle} ` +
          `new=${committed.isNewProduct} status=${staged.publish ? "PUBLISHED" : "DRAFT"} tenant=${tenantId} ` +
          `variants=${committed.variantIds.length} images=${staged.imageUrls.length}`,
      );

      results.push({
        stagedId,
        ok: true,
        handle: committed.handle,
        productId: committed.productId,
        isNewProduct: committed.isNewProduct,
        status: staged.publish ? "PUBLISHED" : "DRAFT",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add this product to the store";
      console.error(`[aliexpress/confirm] FAILED staged=${stagedId} tenant=${tenantId}: ${message}`);
      results.push({ stagedId, ok: false, error: message });
    }
  }

  return NextResponse.json({ results, confirmed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
