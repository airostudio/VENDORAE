import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You assign a newly imported product to the single best-fitting category from a store's existing category list. You never invent a new category — only pick one from the list given, or say none fit.

Respond with ONLY a JSON object, no other text, no markdown fences: {"handle": "<one of the given handles>"} or {"handle": null} if nothing in the list is a good fit.`;

interface CategoryOption {
  id: string;
  handle: string;
  name: string;
  description: string | null;
}

function parseHandle(text: string, validHandles: Set<string>): string | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as { handle: string | null };
  if (parsed.handle === null || parsed.handle === undefined) return null;
  return validHandles.has(parsed.handle) ? parsed.handle : null;
}

/**
 * Picks the best-fitting EXISTING category for a newly imported product, or null if none fit
 * well (never invents a new category — matches "leave uncategorized" rather than cluttering the
 * taxonomy). Never throws: any failure (no ANTHROPIC_API_KEY, API error, malformed response)
 * returns null so import is never blocked on this.
 */
export async function categorizeProduct(
  supabase: SupabaseClient,
  tenantId: string,
  product: { title: string; description: string },
): Promise<{ categoryId: string; categoryHandle: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { data: categories } = await supabase
    .from("categories")
    .select("id, handle, name, description")
    .eq("tenant_id", tenantId)
    .eq("is_hidden", false);
  const options = (categories ?? []) as CategoryOption[];
  if (options.length === 0) return null;

  try {
    const client = new Anthropic();
    const categoryList = options.map((c) => `- ${c.handle}: ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n");
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Existing categories:\n${categoryList}\n\nProduct title: ${product.title}\n\nProduct description:\n${product.description.slice(0, 2000)}`,
        },
      ],
    });

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!textBlock) return null;

    const handle = parseHandle(textBlock.text, new Set(options.map((c) => c.handle)));
    if (!handle) return null;

    const match = options.find((c) => c.handle === handle);
    return match ? { categoryId: match.id, categoryHandle: match.handle } : null;
  } catch {
    return null;
  }
}
