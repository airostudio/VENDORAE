import "server-only";
import { db, getTenantId } from "./client";

export interface Guide {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  content: string;
}

interface GuideRow {
  slug: string;
  title: string;
  content: string;
  category: string | null;
  excerpt: string | null;
}

function toGuide(row: GuideRow): Guide {
  const excerpt = row.excerpt ?? (row.content.length > 160 ? `${row.content.slice(0, 157)}...` : row.content);
  return { slug: row.slug, title: row.title, category: row.category ?? "Guide", excerpt, content: row.content };
}

export async function getGuides(): Promise<Guide[]> {
  const tenantId = await getTenantId();
  const { data, error } = await db()
    .from("blog_posts")
    .select("slug, title, content, category, excerpt")
    .eq("tenant_id", tenantId)
    .eq("status", "PUBLISHED")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load guides: ${error.message}`);
  return ((data ?? []) as GuideRow[]).map(toGuide);
}

export async function getGuideBySlug(slug: string): Promise<Guide | undefined> {
  const tenantId = await getTenantId();
  const { data } = await db()
    .from("blog_posts")
    .select("slug, title, content, category, excerpt")
    .eq("tenant_id", tenantId)
    .eq("status", "PUBLISHED")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return undefined;
  return toGuide(data as GuideRow);
}
