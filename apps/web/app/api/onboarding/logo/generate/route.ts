import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // image generation is slow; the default serverless timeout can cut it off

const bodySchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  businessDescription: z.string().trim().max(2000).optional(),
  productNiche: z.string().trim().max(500).optional(),
});

/**
 * AI logo generation, entirely optional: only enabled when OPENAI_API_KEY is set on this
 * deployment. There is no image-generation-capable provider in packages/core/src/providers/ai.ts
 * today (that abstraction is for the deterministic product-finder recommender — see its own
 * doc comment — and sending data externally is opt-in by design there too), so this calls
 * OpenAI's Images API directly rather than inventing a fake provider abstraction for one caller.
 *
 * Returns a clear, actionable error when no key is configured, so the wizard can tell the owner
 * to upload a logo instead — never a crash or a fabricated image.
 */
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI logo generation isn't configured — upload a logo instead, or set OPENAI_API_KEY on this deployment." },
      { status: 501 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { businessName, businessDescription, productNiche } = parsed.data;

  const prompt =
    `A clean, modern, minimalist logo mark for an online store called "${businessName}"` +
    (productNiche ? ` that sells ${productNiche}` : "") +
    (businessDescription ? `. ${businessDescription}` : ".") +
    " Flat vector style, simple bold shapes, one or two colors, centered on a plain white background, no text, no watermark, no photograph.";

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI image generation failed (${response.status}): ${body || response.statusText}`);
    }
    const result = (await response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
    const image = result.data?.[0];
    if (!image) throw new Error("OpenAI returned no image.");

    let bytes: Uint8Array;
    if (image.b64_json) {
      bytes = Uint8Array.from(Buffer.from(image.b64_json, "base64"));
    } else if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) throw new Error("Could not download the generated image.");
      bytes = new Uint8Array(await imageResponse.arrayBuffer());
    } else {
      throw new Error("OpenAI returned no usable image data.");
    }

    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const path = `${tenantId}/logo.png`;
    const { error: uploadError } = await supabase.storage.from("branding").upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrlData } = supabase.storage.from("branding").getPublicUrl(path);
    const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase.from("tenant_settings").update({ logo_url: logoUrl }).eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ logoUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not generate a logo" }, { status: 500 });
  }
}
