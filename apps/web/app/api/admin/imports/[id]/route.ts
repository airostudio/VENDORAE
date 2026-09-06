import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, status, progress, result, created_at, updated_at")
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  return NextResponse.json(data);
}
