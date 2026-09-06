"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface StagedSku {
  aliexpressSkuId: string;
  properties: string | null;
  retailPriceCents: number;
  compareAtCents: number | null;
  supplierCostCents: number;
  marginRate: number;
  stockOnHand: number;
  isActive: boolean;
}

interface StagedProduct {
  id: string;
  aliexpressProductId: string;
  sourceUrl: string | null;
  status: "ready" | "failed" | "confirmed";
  error: string | null;
  title: string;
  shortDescription: string;
  description: string;
  seoTitle: string | null;
  seoDesc: string | null;
  categoryId: string | null;
  suggestedCategoryId: string | null;
  publish: boolean;
  productType: string;
  brand: string | null;
  currencyCode: string;
  imageUrls: string[];
  skus: StagedSku[];
}

interface CategoryOption {
  id: string;
  handle: string;
  name: string;
}

const PRODUCT_TYPES = ["STANDARD", "ACCESSORY", "CARE_PRODUCT", "BUNDLE", "GIFT_CARD"];

// Google cuts a title around 60 characters and a meta description around 160; the lower
// bounds are where a snippet stops looking thin. Kept in sync with lib/import/seoCopy.ts.
const SEO_TITLE_MAX = 60;
const SEO_TITLE_TARGET_MIN = 50;
const SEO_DESC_MAX = 160;
const SEO_DESC_TARGET_MIN = 140;

/** Trim to a hard limit on a word boundary, so a snippet never ends mid-word. */
function truncateAtWord(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, "");
}

/** Strips the markdown-ish headings the rewriter emits, so copying gives prose, not "## Details". */
function toPlainProse(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line) && !/^\s*[-*]\s/.test(line))
    .join(" ")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function counterClass(length: number, min: number, max: number): string {
  if (length === 0) return "text-stone-400";
  if (length > max) return "text-red-600";
  if (length < min) return "text-amber-600";
  return "text-green-700";
}

/** Zod returns a field-error object, not a string — surface something an admin can act on. */
function describeApiError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  const fieldErrors = (error as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
  if (fieldErrors) {
    const parts = Object.entries(fieldErrors)
      .map(([field, messages]) => `${field}: ${(messages ?? []).join(", ")}`)
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  return fallback;
}

function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export default function StagedProductEditor({ params }: { params: { id: string } }) {
  const [product, setProduct] = useState<StagedProduct | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [generatingSeo, setGeneratingSeo] = useState(false);
  const [confirmed, setConfirmed] = useState<{ handle: string; status: "DRAFT" | "PUBLISHED" } | null>(null);

  const load = useCallback(async () => {
    try {
      const [productRes, categoriesRes] = await Promise.all([
        fetch(`/api/admin/products/aliexpress/staged/${params.id}`),
        fetch("/api/admin/categories"),
      ]);
      const data = await productRes.json();
      if (!productRes.ok) throw new Error(data.error ?? "Could not load this staged product");
      const categoriesData = await categoriesRes.json().catch(() => ({ categories: [] }));
      setProduct(data);
      setCategories(categoriesData.categories ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this staged product");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  function update(patch: Partial<StagedProduct>) {
    setProduct((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSavedAt(null);
  }

  function updateSku(index: number, patch: Partial<StagedSku>) {
    setProduct((prev) =>
      prev ? { ...prev, skus: prev.skus.map((sku, i) => (i === index ? { ...sku, ...patch } : sku)) } : prev,
    );
    setDirty(true);
    setSavedAt(null);
  }

  function moveImage(from: number, to: number) {
    setProduct((prev) => {
      if (!prev || to < 0 || to >= prev.imageUrls.length) return prev;
      const next = [...prev.imageUrls];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, imageUrls: next };
    });
    setDirty(true);
    setSavedAt(null);
  }

  /** Writes both SEO fields with AI, from whatever is currently on screen (no save required first). */
  async function generateSeo() {
    if (!product) return;
    setGeneratingSeo(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/aliexpress/staged/${product.id}/seo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: product.title,
          shortDescription: product.shortDescription,
          description: product.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(describeApiError(data.error, "Could not generate SEO copy"));
      update({ seoTitle: data.seoTitle, seoDesc: data.seoDesc });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate SEO copy");
    } finally {
      setGeneratingSeo(false);
    }
  }

  function copyTitleToSeo() {
    if (!product) return;
    update({ seoTitle: truncateAtWord(product.title, SEO_TITLE_MAX) });
  }

  function copyDescriptionToSeo() {
    if (!product) return;
    const source = product.shortDescription?.trim() ? product.shortDescription : toPlainProse(product.description);
    update({ seoDesc: truncateAtWord(toPlainProse(source), SEO_DESC_MAX) });
  }

  async function save(): Promise<boolean> {
    if (!product) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/aliexpress/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: product.title,
          shortDescription: product.shortDescription,
          description: product.description,
          seoTitle: product.seoTitle,
          seoDesc: product.seoDesc,
          categoryId: product.categoryId,
          publish: product.publish,
          productType: product.productType,
          brand: product.brand,
          imageUrls: product.imageUrls,
          skus: product.skus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(describeApiError(data.error, "Could not save your changes"));
      setProduct(data);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Save first so the store gets exactly what's on screen, then commit.
  async function saveAndConfirm() {
    if (!product) return;
    setConfirming(true);
    try {
      if (dirty && !(await save())) return;
      const res = await fetch("/api/admin/products/aliexpress/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagedIds: [product.id] }),
      });
      const data = await res.json();
      const outcome = data.results?.[0];
      if (!res.ok || !outcome?.ok) throw new Error(outcome?.error ?? data.error ?? "Could not add this product to the store");
      // Show what happened rather than redirecting silently — a Draft product is easy to
      // mistake for "nothing happened", since it never reaches the storefront.
      setConfirmed({ handle: outcome.handle ?? "", status: outcome.status ?? "DRAFT" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this product to the store");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <p className="text-sm text-stone-500">Loading…</p>;
  if (!product) return <p className="text-sm text-red-600">{error ?? "Not found"}</p>;

  const busy = saving || confirming || generatingSeo;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/aliexpress/staging" className="text-xs text-stone-500 underline">
          ← Back to Staging
        </Link>
      </div>

      <div className="flex justify-between items-start mb-8 gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2">Staged product</p>
          <h1 className="font-serif text-3xl truncate">{product.title}</h1>
          <p className="text-xs text-stone-500 mt-1">
            AliExpress ID {product.aliexpressProductId}
            {product.sourceUrl && (
              <>
                {" · "}
                <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  view on AliExpress ↗
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className="btn-secondary" disabled={busy || !dirty} onClick={save}>
            {saving ? "Saving…" : dirty ? "Save changes" : savedAt ? `Saved ${savedAt}` : "Saved"}
          </button>
          <button className="btn-primary" disabled={busy} onClick={saveAndConfirm}>
            {confirming ? "Adding…" : "Confirm & add to store"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {confirmed ? (
        <div className="border border-green-700 bg-green-50 px-4 py-3 mb-6 text-xs text-stone-700">
          Added to the store as <span className="font-medium">{confirmed.handle}</span>
          {confirmed.status === "DRAFT"
            ? " — as a Draft, so it is not on the storefront until you publish it."
            : " — published and live on the storefront."}{" "}
          <Link href="/admin/products" className="underline">
            Open Products
          </Link>{" "}
          ·{" "}
          <Link href="/admin/aliexpress/staging" className="underline">
            Back to staging
          </Link>
        </div>
      ) : (
        <div className="border border-stone-300 bg-stone-50 px-4 py-3 mb-6 text-xs text-stone-600">
          This product is <span className="font-medium">not in the store yet</span>. Saving keeps your edits here in
          staging — it&rsquo;s <span className="font-medium">Confirm &amp; add to store</span> that actually creates the
          product.
        </div>
      )}

      <section className="card p-6 mb-6">
        <h2 className="text-sm font-medium mb-4">Images</h2>
        {product.imageUrls.length === 0 && <p className="text-xs text-stone-500">No images came back from AliExpress.</p>}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {product.imageUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="border border-stone-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full aspect-square object-cover bg-stone-100" />
              <div className="flex justify-between items-center px-1 py-1 text-[10px]">
                <span className={i === 0 ? "font-medium" : "text-stone-400"}>{i === 0 ? "Primary" : i + 1}</span>
                <span className="flex gap-1">
                  <button className="underline disabled:opacity-30" disabled={i === 0} onClick={() => moveImage(i, i - 1)}>
                    ←
                  </button>
                  <button
                    className="underline disabled:opacity-30"
                    disabled={i === product.imageUrls.length - 1}
                    onClick={() => moveImage(i, i + 1)}
                  >
                    →
                  </button>
                  <button
                    className="underline text-red-600"
                    onClick={() => update({ imageUrls: product.imageUrls.filter((_, idx) => idx !== i) })}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-stone-500 mt-3">The first image becomes the product&rsquo;s primary image.</p>
      </section>

      <section className="card p-6 mb-6">
        <h2 className="text-sm font-medium mb-4">Listing copy</h2>
        <label className="block text-xs text-stone-600 mb-1">Title</label>
        <input
          type="text"
          value={product.title}
          onChange={(e) => update({ title: e.target.value })}
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-1"
        />
        <p className="text-[10px] text-stone-400 mb-4">{product.title.length} characters — aim for under 70 for search results.</p>

        <label className="block text-xs text-stone-600 mb-1">Short description</label>
        <textarea
          value={product.shortDescription}
          onChange={(e) => update({ shortDescription: e.target.value })}
          rows={2}
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-4"
        />

        <label className="block text-xs text-stone-600 mb-1">Description</label>
        <textarea
          value={product.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={14}
          className="w-full border border-stone-300 px-3 py-2 text-sm font-mono mb-4"
        />

        <div className="border-t border-stone-200 pt-4 mt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Search engine snippet</h3>
            <button className="btn-secondary text-xs py-1 px-3" disabled={busy} onClick={generateSeo}>
              {generatingSeo ? "Writing…" : "Write both with AI"}
            </button>
          </div>

          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-stone-600">SEO title</label>
            <div className="flex items-center gap-2">
              <button className="text-[10px] underline text-stone-500" disabled={busy} onClick={copyTitleToSeo}>
                Copy from title
              </button>
              <span className={`text-[10px] ${counterClass((product.seoTitle ?? "").length, SEO_TITLE_TARGET_MIN, SEO_TITLE_MAX)}`}>
                {(product.seoTitle ?? "").length}/{SEO_TITLE_MAX}
              </span>
            </div>
          </div>
          <input
            type="text"
            value={product.seoTitle ?? ""}
            onChange={(e) => update({ seoTitle: e.target.value || null })}
            placeholder="Defaults to the product title"
            className="w-full border border-stone-300 px-3 py-2 text-sm mb-1"
          />
          <p className="text-[10px] text-stone-400 mb-4">Best between {SEO_TITLE_TARGET_MIN} and {SEO_TITLE_MAX} characters — longer gets cut off in search results.</p>

          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-stone-600">SEO description</label>
            <div className="flex items-center gap-2">
              <button className="text-[10px] underline text-stone-500" disabled={busy} onClick={copyDescriptionToSeo}>
                Copy from description
              </button>
              <span className={`text-[10px] ${counterClass((product.seoDesc ?? "").length, SEO_DESC_TARGET_MIN, SEO_DESC_MAX)}`}>
                {(product.seoDesc ?? "").length}/{SEO_DESC_MAX}
              </span>
            </div>
          </div>
          <textarea
            value={product.seoDesc ?? ""}
            onChange={(e) => update({ seoDesc: e.target.value || null })}
            rows={3}
            placeholder="Defaults to the short description"
            className="w-full border border-stone-300 px-3 py-2 text-sm mb-1"
          />
          <p className="text-[10px] text-stone-400">Best between {SEO_DESC_TARGET_MIN} and {SEO_DESC_MAX} characters. Copying trims on a word boundary so nothing ends mid-word.</p>
        </div>
      </section>

      <section className="card p-6 mb-6">
        <h2 className="text-sm font-medium mb-4">Placement</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-stone-600 mb-1">Category</label>
            <select
              value={product.categoryId ?? ""}
              onChange={(e) => update({ categoryId: e.target.value || null })}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {product.suggestedCategoryId && (
              <p className="text-[10px] text-stone-400 mt-1">
                {product.categoryId === product.suggestedCategoryId
                  ? "Auto-suggested by AI"
                  : `AI suggested: ${categories.find((c) => c.id === product.suggestedCategoryId)?.name ?? "—"}`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-stone-600 mb-1">Product type</label>
            <select
              value={product.productType}
              onChange={(e) => update({ productType: e.target.value })}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-600 mb-1">Brand</label>
            <input
              type="text"
              value={product.brand ?? ""}
              onChange={(e) => update({ brand: e.target.value || null })}
              placeholder="Beach Footprints"
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-600 mb-1">Status once you confirm</label>
            <select
              value={product.publish ? "PUBLISHED" : "DRAFT"}
              onChange={(e) => update({ publish: e.target.value === "PUBLISHED" })}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="DRAFT">Draft — review before it goes live</option>
              <option value="PUBLISHED">Published — live as soon as it&rsquo;s confirmed</option>
            </select>
            <p className="text-[10px] text-stone-400 mt-1">Applied when you confirm, not when you save.</p>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-medium mb-1">Variants &amp; pricing</h2>
        <p className="text-xs text-stone-500 mb-4">
          Prices came from your pricing rule applied to the live supplier cost. Editing a price here overrides it for
          this import; catalog sync will keep costs and stock current afterwards.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="py-2 pr-2">Variant</th>
                <th className="py-2 pr-2">Cost</th>
                <th className="py-2 pr-2">Price</th>
                <th className="py-2 pr-2">Compare at</th>
                <th className="py-2 pr-2">Stock</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {product.skus.map((sku, i) => (
                <tr key={sku.aliexpressSkuId} className="border-b border-stone-100">
                  <td className="py-2 pr-2">
                    <span className="block max-w-[200px] truncate">{sku.properties || "Default"}</span>
                    <span className="text-[10px] text-stone-400">{sku.aliexpressSkuId}</span>
                  </td>
                  <td className="py-2 pr-2 text-stone-500">{centsToDollars(sku.supplierCostCents)}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={centsToDollars(sku.retailPriceCents)}
                      onChange={(e) => updateSku(i, { retailPriceCents: dollarsToCents(e.target.value) ?? 0 })}
                      className="w-20 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={centsToDollars(sku.compareAtCents)}
                      onChange={(e) => updateSku(i, { compareAtCents: dollarsToCents(e.target.value) })}
                      placeholder="—"
                      className="w-20 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      value={sku.stockOnHand}
                      onChange={(e) => updateSku(i, { stockOnHand: Number.parseInt(e.target.value, 10) || 0 })}
                      className="w-16 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <input type="checkbox" checked={sku.isActive} onChange={(e) => updateSku(i, { isActive: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
