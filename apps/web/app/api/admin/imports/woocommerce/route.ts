import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { convertWooCommerceWorkbook, PRODUCT_CSV_COLUMNS } from "@/lib/import/woocommerce";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  tenant: z.string().optional(),
  path: z.string().min(1), // storage path of the uploaded .xlsx, from /api/admin/imports/upload-url
  markMissingOutOfStock: z.boolean().optional(),
});

/**
 * Downloads an uploaded WooCommerce .xlsx, converts it to the standard
 * product-import CSV (see lib/import/woocommerce.ts), re-uploads the result,
 * and registers it as an import_jobs row — from here on it's indistinguishable
 * from a hand-authored CSV upload and goes through the exact same tested
 * byte-range chunked processor at /api/admin/imports/[id]/process.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  const { data: file, error: downloadErr } = await supabase.storage.from("imports").download(parsed.data.path);
  if (downloadErr || !file) {
    return NextResponse.json({ error: downloadErr?.message ?? "Could not download the uploaded file" }, { status: 500 });
  }

  let conversion;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    conversion = await convertWooCommerceWorkbook(buffer);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not parse the workbook" }, { status: 400 });
  }

  const csvPath = parsed.data.path.replace(/\.xlsx$/i, "") + ".converted.csv";
  const { error: uploadErr } = await supabase.storage
    .from("imports")
    .upload(csvPath, conversion.csv, { contentType: "text/csv", upsert: true });
  if (uploadErr) return NextResponse.json({ error: `Could not stage converted CSV: ${uploadErr.message}` }, { status: 500 });

  const { data: job, error: jobErr } = await supabase
    .from("import_jobs")
    .insert({
      tenant_id: tenantId,
      type: "product_csv",
      status: "QUEUED",
      file_url: csvPath,
      mapping: { columns: PRODUCT_CSV_COLUMNS, source: "woocommerce_xlsx", sourceFile: parsed.data.path },
      options: { byteOffset: 0, carryover: "", header: null, chunkBytes: 262_144, markMissingOutOfStock: parsed.data.markMissingOutOfStock ?? false },
      result: { processedRows: 0, skippedExisting: 0, errors: [], seenHandles: [], seenBrands: [] },
      progress: 0,
    })
    .select("id")
    .single();

  if (jobErr || !job) return NextResponse.json({ error: jobErr?.message ?? "Could not create import job" }, { status: 500 });

  return NextResponse.json({
    id: job.id,
    totalRows: conversion.totalRows,
    excludedTitles: conversion.excludedTitles,
    typeCounts: conversion.typeCounts,
  });
}
