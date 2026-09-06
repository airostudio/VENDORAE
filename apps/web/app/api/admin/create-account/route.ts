import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * Creates the first real admin account (Supabase Auth user + `memberships` row, role OWNER) for
 * the tenant this request resolved to. Reachable only via middleware.ts's break-glass Basic Auth
 * fallback, which only applies while the tenant has zero `memberships` rows — this route
 * double-checks that itself so it can never be used to add a second owner, or to reuse the
 * shared password against a store that has already bootstrapped a real account.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Enter a valid email and password" }, { status: 400 });
  }

  const supabase = createServiceRoleSupabaseClient();
  try {
    const tenantId = await resolveTenantId(supabase);

    const { data: existing, error: existingError } = await supabase
      .from("memberships")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "This store already has an admin account. Sign in at /admin/login instead." },
        { status: 403 },
      );
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
    });
    if (createError || !created?.user) throw new Error(createError?.message || "Could not create the account");

    const { error: membershipError } = await supabase
      .from("memberships")
      .insert({ tenant_id: tenantId, user_id: created.user.id, role: "OWNER" });
    if (membershipError) throw new Error(membershipError.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the account" }, { status: 500 });
  }
}
