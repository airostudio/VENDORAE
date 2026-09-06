import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

/**
 * Google truncates a title around 60 characters and a meta description around 160 (it renders by
 * pixel width, so these are the widely-used character equivalents). Aiming just under each keeps
 * the whole snippet visible in search results.
 */
export const SEO_TITLE_MAX = 60;
export const SEO_TITLE_TARGET_MIN = 50;
export const SEO_DESC_MAX = 160;
export const SEO_DESC_TARGET_MIN = 140;

const SYSTEM_PROMPT = `You write search-engine snippets for an Australian coastal/beach lifestyle store.

Write two things for the product given:
1. "seoTitle" — a search-result title of ${SEO_TITLE_TARGET_MIN}-${SEO_TITLE_MAX} characters. Lead with the words a shopper would actually search for. No brand padding, no ALL CAPS, no exclamation marks, no keyword stuffing, no "Free Shipping"/"Hot Sale" marketplace noise.
2. "seoDesc" — a meta description of ${SEO_DESC_TARGET_MIN}-${SEO_DESC_MAX} characters. One or two natural sentences describing what the product is and who it suits, ending with a concrete detail rather than a generic call to action.

Both must be plain text, grounded only in the product information provided — never invent materials, sizes, certifications or claims. Stay within the character limits; a snippet cut off mid-word is worse than a shorter one.

Respond with ONLY a JSON object, no other text and no markdown fences: {"seoTitle": "...", "seoDesc": "..."}`;

/** Trim to a hard limit on a word boundary, so a snippet never ends mid-word. */
export function truncateAtWord(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, "");
}

function parseSeo(text: string): { seoTitle: string; seoDesc: string } | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as { seoTitle?: unknown; seoDesc?: unknown };
    if (typeof parsed.seoTitle !== "string" || typeof parsed.seoDesc !== "string") return null;
    if (!parsed.seoTitle.trim() || !parsed.seoDesc.trim()) return null;
    return { seoTitle: parsed.seoTitle, seoDesc: parsed.seoDesc };
  } catch {
    return null;
  }
}

/**
 * Writes an SEO title and meta description for a staged product, sized to what search results
 * actually display. Returns null on any failure (no API key, API error, malformed response) so the
 * caller can fall back to deriving them from the product copy rather than surfacing a hard error.
 */
export async function generateSeoCopy(product: {
  title: string;
  shortDescription?: string;
  description: string;
}): Promise<{ seoTitle: string; seoDesc: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `Product title: ${product.title}`,
            product.shortDescription ? `Short description: ${product.shortDescription}` : "",
            `Description:\n${product.description.slice(0, 3000)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!textBlock) return null;

    const parsed = parseSeo(textBlock.text);
    if (!parsed) return null;

    // The model is asked to stay within the limits; enforce them anyway so a long
    // response can never produce a snippet search engines would cut off.
    return {
      seoTitle: truncateAtWord(parsed.seoTitle, SEO_TITLE_MAX),
      seoDesc: truncateAtWord(parsed.seoDesc, SEO_DESC_MAX),
    };
  } catch {
    return null;
  }
}
