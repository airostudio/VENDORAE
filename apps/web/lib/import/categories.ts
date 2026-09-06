import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

function humanize(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Ensures every category handle a chunk's rows reference exists for the
 * tenant BEFORE those rows' products get inserted and linked to them — the
 * import must create categories first, so a product never lands with a
 * dangling/missing category reference. A "/"-nested handle (e.g.
 * "dresses-kimonos/sale") auto-creates its ancestors too, shallowest first
 * ("dresses-kimonos" before "dresses-kimonos/sale"), matching how
 * apps/web/lib/data/categories.ts derives parent/child from parent_id.
 * Existing categories are left untouched — only missing ones get created,
 * named from the handle's last segment.
 */
export async function ensureCategoriesExist(
  supabase: SupabaseClient,
  tenantId: string,
  handles: string[],
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const uniqueHandles = [...new Set(handles.filter(Boolean))];
  if (uniqueHandles.length === 0) return { errors };

  const allHandles = new Set<string>();
  for (const handle of uniqueHandles) {
    const segments = handle.split("/").filter(Boolean);
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      allHandles.add(path);
    }
  }
  const orderedHandles = [...allHandles].sort((a, b) => a.split("/").length - b.split("/").length);

  const { data: existing, error: existingErr } = await supabase
    .from("categories")
    .select("id, handle")
    .eq("tenant_id", tenantId)
    .in("handle", orderedHandles);
  if (existingErr) {
    errors.push(`Could not check for existing categories: ${existingErr.message}`);
    return { errors };
  }

  const idByHandle = new Map((existing ?? []).map((c) => [c.handle as string, c.id as string]));

  for (const handle of orderedHandles) {
    if (idByHandle.has(handle)) continue;
    const segments = handle.split("/");
    const parentHandle = segments.length > 1 ? segments.slice(0, -1).join("/") : undefined;
    const parentId = parentHandle ? idByHandle.get(parentHandle) : undefined;
    const name = humanize(segments[segments.length - 1]);

    const { data: created, error: insertErr } = await supabase
      .from("categories")
      .insert({ tenant_id: tenantId, handle, name, parent_id: parentId ?? null })
      .select("id, handle")
      .single();

    if (insertErr) {
      // Could already exist now if another chunk/job created it concurrently — check before giving up.
      const { data: nowExists } = await supabase
        .from("categories")
        .select("id, handle")
        .eq("tenant_id", tenantId)
        .eq("handle", handle)
        .maybeSingle();
      if (nowExists) {
        idByHandle.set(nowExists.handle as string, nowExists.id as string);
        continue;
      }
      errors.push(`Could not create category "${handle}": ${insertErr.message}`);
      continue;
    }
    idByHandle.set(created.handle as string, created.id as string);
  }

  return { errors };
}
