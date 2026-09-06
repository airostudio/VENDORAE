import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { getStagedProduct } from "@/lib/import/staging";
import { generateSeoCopy } from "@/lib/import/seoCopy";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The editor sends whatever is currently on screen, so generating works against unsaved
// edits too; anything omitted falls back to the stored staged row.
const bodySchema = z.object({
  title: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Writes an SEO title + meta description for a staged product with AI, sized to what search
 * results display. Returns the suggestions rather than saving them, so the admin reviews them in
 * the editor and keeps them with the next save like any other edit.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const staged = await getStagedProduct(supabase, tenantId, params.id);
    if (!staged) return NextResponse.json({ error: "Staged product not found" }, { status: 404 });

    const draft = bodySchema.safeParse(await request.json().catch(() => ({})));
    const current = draft.success ? draft.data : {};

    const seo = await generateSeoCopy({
      title: current.title || staged.title,
      shortDescription: current.shortDescription ?? staged.shortDescription,
      description: current.description || staged.description,
    });
    if (!seo) {
      return NextResponse.json(
        { error: "AI copy is unavailable — check ANTHROPIC_API_KEY, or use the copy-from buttons instead." },
        { status: 503 },
      );
    }

    return NextResponse.json(seo);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate SEO copy" },
      { status: 500 },
    );
  }
}
