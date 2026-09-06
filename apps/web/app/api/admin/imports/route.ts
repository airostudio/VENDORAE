import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { PRODUCT_IMPORT_FIELDS } from "@/lib/import/columnMapping";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const DEFAULT_CHUNK_BYTES = 262_144; // 256KB per range request — small enough that every
// invocation finishes in well under a second of DB + parse work, regardless of total file size.

const bodySchema = z.object({
  tenant: z.string().optional(),
  path: z.string().min(1), // storage path returned by /api/admin/imports/upload-url
  chunkBytes: z.number().int().positive().max(2_000_000).optional(),
  markMissingOutOfStock: z.boolean().optional(),
  /**
   * Field key -> the heading that field lives under in this file, as confirmed by the admin in
   * the mapping step. Omitted for a file whose headings are already the canonical keys, which is
   * how imports behaved before mapping existed.
   */
  fieldMap: z.record(z.string(), z.string().nullable()).optional(),
});

/** Registers an uploaded CSV as an import job. Processing happens later, one bounded chunk per call to [id]/process. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      tenant_id: tenantId,
      type: "product_csv",
      status: "QUEUED",
      file_url: parsed.data.path,
      mapping: {
        columns: PRODUCT_IMPORT_FIELDS.map((f) => f.key),
        fields: parsed.data.fieldMap ?? null,
      },
      options: {
        byteOffset: 0,
        carryover: "",
        header: null,
        chunkBytes: parsed.data.chunkBytes ?? DEFAULT_CHUNK_BYTES,
        markMissingOutOfStock: parsed.data.markMissingOutOfStock ?? false,
      },
      result: { processedRows: 0, skippedExisting: 0, errors: [], seenHandles: [], seenBrands: [] },
      progress: 0,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create import job" }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
