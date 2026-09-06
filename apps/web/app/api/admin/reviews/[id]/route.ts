import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/** Approves a pending review, making it visible on the product page. */
export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("reviews").update({ is_approved: true }).eq("id", params.id).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Review not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Rejects (deletes) a pending review — there is no "rejected but kept" state, just gone. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("reviews").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
