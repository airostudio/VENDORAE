"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ProductRow {
  id: string;
  title: string;
  handle: string;
  short_description: string | null;
  description: string | null;
  seo_title: string | null;
  seo_desc: string | null;
  status: string;
  product_type: string;
  brand: string | null;
  shipping_class: string;
  stock_policy: string;
  packaged_weight_grams: number | null;
  care_instructions: string | null;
  is_indexable: boolean;
}

interface VariantRow {
  id: string;
  title: string | null;
  sku: string | null;
  price: number;
  compare_at: number | null;
  currency: string;
  is_active: boolean;
  supplier: string | null;
  supplier_sku_id: string | null;
  cost: number | null;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  stock_on_hand: number;
}

interface SpecRow {
  group: string;
  label: string;
  value: string;
}
interface MediaRow {
  url: string;
  alt: string | null;
}
interface Category {
  id: string;
  name: string;
}

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED", "OUT_OF_STOCK"];
const PRODUCT_TYPES = ["STANDARD", "ACCESSORY", "CARE_PRODUCT", "BUNDLE", "GIFT_CARD"];
const SHIPPING_CLASSES = ["STANDARD", "HEAVY", "OVERSIZED", "FREIGHT", "SPECIAL"];
const STOCK_POLICIES = ["IN_STOCK", "MADE_TO_ORDER", "PREORDER", "BACKORDER", "DISCONTINUED"];
const TABS = ["Details", "Images", "Variants", "Specifications", "SEO"] as const;

// Two-decimal currencies only: prices are integer cents throughout, so a zero-decimal
// currency (JPY, KRW) would be charged 100x under that model.
const CURRENCIES = ["USD", "AUD", "NZD", "GBP", "EUR", "CAD", "SGD"];

const STATUS_BADGE: Record<string, string> = {
  PUBLISHED: "bg-green-100 text-green-800",
  DRAFT: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-stone-200 text-stone-600",
  OUT_OF_STOCK: "bg-red-100 text-red-700",
};

function formatMoney(cents: number | null, currency: string): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function centsToDollars(cents: number | null): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}
function dollarsToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function ProductEditorPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Details");
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const originalCurrencyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, catRes] = await Promise.all([
        fetch(`/api/admin/products/${params.id}`),
        fetch("/api/admin/categories"),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load this product");
      setProduct(data.product);
      setVariants(data.variants ?? []);
      originalCurrencyRef.current = data.variants?.[0]?.currency ?? "USD";
      setMedia(data.media ?? []);
      setSpecs(data.specs ?? []);
      setCategoryIds(data.categoryIds ?? []);
      const catData = await catRes.json().catch(() => ({ categories: [] }));
      setCategories(catData.categories ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this product");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  function touch() {
    setDirty(true);
    setSavedAt(null);
  }
  function update(patch: Partial<ProductRow>) {
    setProduct((p) => (p ? { ...p, ...patch } : p));
    touch();
  }
  function updateVariant(id: string, patch: Partial<VariantRow>) {
    setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    touch();
  }

  /** Currency is a property of the whole product in practice — a cart can only be charged in one. */
  function setProductCurrency(currency: string) {
    setVariants((vs) => vs.map((v) => ({ ...v, currency })));
    touch();
  }

  async function save() {
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: product.title,
          handle: product.handle,
          shortDescription: product.short_description,
          description: product.description,
          seoTitle: product.seo_title,
          seoDesc: product.seo_desc,
          status: product.status,
          productType: product.product_type,
          brand: product.brand,
          shippingClass: product.shipping_class,
          stockPolicy: product.stock_policy,
          packagedWeightGrams: product.packaged_weight_grams,
          careInstructions: product.care_instructions,
          isIndexable: product.is_indexable,
          categoryIds,
          media,
          specs,
          variants: variants.map((v) => ({
            id: v.id,
            priceCents: v.price,
            compareAtCents: v.compare_at,
            sku: v.sku,
            option1Name: v.option1_name,
            option1Value: v.option1_value,
            option2Name: v.option2_name,
            option2Value: v.option2_value,
            option3Name: v.option3_name,
            option3Value: v.option3_value,
            stockOnHand: v.stock_on_hand,
            isActive: v.is_active,
            currency: v.currency,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save this product");
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this product");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!product) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete this product");
      router.push("/admin/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this product");
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-stone-500">Loading…</p>;
  if (!product) return <p className="text-sm text-red-600">{error ?? "Not found"}</p>;

  const currency = variants[0]?.currency ?? "USD";
  const originalCurrency = originalCurrencyRef.current ?? currency;
  const mixedCurrency = new Set(variants.map((v) => v.currency)).size > 1;
  const isDropshipped = variants.some((v) => v.supplier === "dropship-engine");

  const prices = variants.map((v) => v.price);
  const priceRange = prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 };
  const costs = variants.map((v) => v.cost).filter((c): c is number => typeof c === "number");
  const costRange = costs.length > 0 ? { min: Math.min(...costs), max: Math.max(...costs) } : null;
  // Margin on the cheapest variant, which is what the storefront advertises.
  const marginPercent =
    costRange && priceRange.min > 0 && costRange.min > 0 ? ((priceRange.min - costRange.min) / priceRange.min) * 100 : null;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/products" className="text-xs text-stone-500 underline">
          ← Back to Products
        </Link>
      </div>

      <div className="flex justify-between items-start mb-6 gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2">Product</p>
          <h1 className="font-serif text-3xl truncate">{product.title}</h1>
          <p className="text-xs text-stone-500 mt-1">
            <span className="font-mono">/{product.handle}</span> · {product.status}
            {isDropshipped && " · synced from AliExpress"}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className="btn-secondary" disabled={saving || !dirty} onClick={save}>
            {saving ? "Saving…" : dirty ? "Save changes" : savedAt ? `Saved ${savedAt}` : "Saved"}
          </button>
          <Link href={`/product/${product.handle}`} target="_blank" className="btn-secondary">
            View ↗
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {isDropshipped && (
        <p className="text-xs text-stone-500 border border-stone-200 bg-stone-50 px-3 py-2 mb-6">
          Prices and stock on this product are kept up to date by catalogue sync. Editing them here is fine — sync will
          overwrite a price only when the supplier&rsquo;s cost actually changes.
        </p>
      )}

      {/* Above the tabs on purpose: status, publishing and categories are what an admin comes to
          this page to change after an import, and they were previously buried inside one tab. */}
      <div className="border border-stone-200 p-5 mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className={`text-xs tracking-widest2 uppercase px-2 py-1 ${STATUS_BADGE[product.status] ?? "bg-stone-100 text-stone-600"}`}>
            {product.status.replace(/_/g, " ")}
          </span>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={product.status === "PUBLISHED"}
              onChange={(e) => update({ status: e.target.checked ? "PUBLISHED" : "DRAFT" })}
            />
            <span>
              Published <span className="text-stone-500">— visible on the storefront</span>
            </span>
          </label>
          {product.status !== "PUBLISHED" && product.status !== "DRAFT" && (
            <span className="text-xs text-stone-500">
              Unticking returns this to Draft. Use the Status field under Details for {product.status.replace(/_/g, " ").toLowerCase()}.
            </span>
          )}
        </div>

        <div>
          <p className="text-xs text-stone-500 mb-2">Categories</p>
          {categories.length === 0 ? (
            <Link href="/admin/categories" className="text-xs underline">
              Create a category first
            </Link>
          ) : (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(c.id)}
                    onChange={() => {
                      setCategoryIds((ids) => (ids.includes(c.id) ? ids.filter((i) => i !== c.id) : [...ids, c.id]));
                      touch();
                    }}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          )}
          {categories.length > 0 && categoryIds.length === 0 && (
            <p className="text-xs text-amber-700 mt-2">
              Not in any category — customers can only reach this product by direct link. Tick at least one.
            </p>
          )}
        </div>

        {dirty && <p className="text-xs text-stone-500">Unsaved — use Save changes above.</p>}
      </div>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs tracking-widest2 uppercase px-3 py-2 border-b-2 -mb-px ${tab === t ? "border-ink-950 text-ink-950" : "border-transparent text-stone-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Details" && (
        <section className="space-y-4">
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">Title</span>
            <input value={product.title} onChange={(e) => update({ title: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">URL handle</span>
            <input value={product.handle} onChange={(e) => update({ handle: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm font-mono" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">Short description</span>
            <textarea value={product.short_description ?? ""} onChange={(e) => update({ short_description: e.target.value })} rows={2} className="w-full border border-stone-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">Description</span>
            <textarea value={product.description ?? ""} onChange={(e) => update({ description: e.target.value })} rows={12} className="w-full border border-stone-300 px-3 py-2 text-sm font-mono" />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Status</span>
              <select value={product.status} onChange={(e) => update({ status: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Product type</span>
              <select value={product.product_type} onChange={(e) => update({ product_type: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm">
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Brand</span>
              <input value={product.brand ?? ""} onChange={(e) => update({ brand: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Shipping weight (g)</span>
              <input
                type="number"
                min="0"
                value={product.packaged_weight_grams ?? ""}
                onChange={(e) => update({ packaged_weight_grams: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full border border-stone-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Shipping class</span>
              <select value={product.shipping_class} onChange={(e) => update({ shipping_class: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm">
                {SHIPPING_CLASSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-stone-500 mb-1">Stock policy</span>
              <select value={product.stock_policy} onChange={(e) => update({ stock_policy: e.target.value })} className="w-full border border-stone-300 px-3 py-2 text-sm">
                {STOCK_POLICIES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">Care instructions</span>
            <textarea value={product.care_instructions ?? ""} onChange={(e) => update({ care_instructions: e.target.value })} rows={3} className="w-full border border-stone-300 px-3 py-2 text-sm" />
          </label>

          <div className="pt-6 border-t border-stone-200">
            <button className="text-xs underline text-red-600" disabled={saving} onClick={remove}>
              Delete this product
            </button>
          </div>
        </section>
      )}

      {tab === "Images" && (
        <section>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
            {media.map((m, i) => (
              <div key={`${m.url}-${i}`} className="border border-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.alt ?? ""} className="w-full aspect-square object-cover bg-stone-100" />
                <div className="flex justify-between items-center px-1 py-1 text-[10px]">
                  <span className={i === 0 ? "font-medium" : "text-stone-400"}>{i === 0 ? "Primary" : i + 1}</span>
                  <span className="flex gap-1">
                    <button
                      className="underline disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => {
                        setMedia((prev) => {
                          const next = [...prev];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          return next;
                        });
                        touch();
                      }}
                    >
                      ←
                    </button>
                    <button
                      className="underline disabled:opacity-30"
                      disabled={i === media.length - 1}
                      onClick={() => {
                        setMedia((prev) => {
                          const next = [...prev];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          return next;
                        });
                        touch();
                      }}
                    >
                      →
                    </button>
                    <button
                      className="underline text-red-600"
                      onClick={() => {
                        setMedia((prev) => prev.filter((_, idx) => idx !== i));
                        touch();
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              const url = window.prompt("Image URL");
              if (url?.trim()) {
                setMedia((prev) => [...prev, { url: url.trim(), alt: product.title }]);
                touch();
              }
            }}
          >
            Add image by URL
          </button>
          {media.length === 0 && <p className="text-xs text-stone-500 mt-3">This product has no images.</p>}
        </section>
      )}

      {tab === "Variants" && (
        <section>
          <div className="border border-stone-200 p-4 mb-4">
            <div className="flex flex-wrap items-end gap-6">
              <label className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Currency</span>
                <select
                  value={currency}
                  onChange={(e) => setProductCurrency(e.target.value)}
                  className="border border-stone-300 px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {/* Keep an existing non-listed currency selectable rather than silently switching it. */}
                  {!CURRENCIES.includes(currency) && <option value={currency}>{currency}</option>}
                </select>
              </label>
              <div className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Price range</span>
                <span className="font-medium">
                  {priceRange.min === priceRange.max
                    ? formatMoney(priceRange.min, currency)
                    : `${formatMoney(priceRange.min, currency)} – ${formatMoney(priceRange.max, currency)}`}
                </span>
              </div>
              <div className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Cost range</span>
                <span className="text-stone-600">
                  {costRange === null
                    ? "—"
                    : costRange.min === costRange.max
                      ? formatMoney(costRange.min, currency)
                      : `${formatMoney(costRange.min, currency)} – ${formatMoney(costRange.max, currency)}`}
                </span>
              </div>
              <div className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Margin</span>
                <span className={marginPercent === null ? "text-stone-400" : marginPercent < 0 ? "text-red-600" : "text-green-700"}>
                  {marginPercent === null ? "—" : `${marginPercent.toFixed(0)}%`}
                </span>
              </div>
            </div>
            {currency !== originalCurrency && (
              <p className="text-xs text-amber-700 mt-3">
                Changing the currency <span className="font-medium">relabels</span> these prices — it does not convert
                them. {formatMoney(priceRange.min, originalCurrency)} becomes{" "}
                {formatMoney(priceRange.min, currency)}. Adjust the amounts below if you meant to re-price.
              </p>
            )}
            {mixedCurrency && (
              <p className="text-xs text-red-600 mt-3">
                This product&rsquo;s variants are priced in more than one currency. A cart can only be charged in one,
                so checkout will refuse them — pick a currency above to bring them into line.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="py-2 pr-2">Options</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2">Cost</th>
                <th className="py-2 pr-2">Price</th>
                <th className="py-2 pr-2">Compare at</th>
                <th className="py-2 pr-2">Stock</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id} className="border-b border-stone-100 align-top">
                  <td className="py-2 pr-2 space-y-1">
                    {([1, 2, 3] as const).map((n) => {
                      const nameKey = `option${n}_name` as keyof VariantRow;
                      const valueKey = `option${n}_value` as keyof VariantRow;
                      const name = v[nameKey] as string | null;
                      const value = v[valueKey] as string | null;
                      if (!name && !value && n > 1) return null;
                      return (
                        <div key={n} className="flex gap-1">
                          <input
                            value={name ?? ""}
                            placeholder="Name"
                            onChange={(e) => updateVariant(v.id, { [nameKey]: e.target.value || null } as Partial<VariantRow>)}
                            className="w-24 border border-stone-300 px-2 py-1"
                          />
                          <input
                            value={value ?? ""}
                            placeholder="Value"
                            onChange={(e) => updateVariant(v.id, { [valueKey]: e.target.value || null } as Partial<VariantRow>)}
                            className="w-28 border border-stone-300 px-2 py-1"
                          />
                        </div>
                      );
                    })}
                  </td>
                  <td className="py-2 pr-2">
                    <input value={v.sku ?? ""} onChange={(e) => updateVariant(v.id, { sku: e.target.value || null })} className="w-28 border border-stone-300 px-2 py-1 font-mono" />
                  </td>
                  <td className="py-2 pr-2 text-stone-500">{centsToDollars(v.cost)}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={centsToDollars(v.price)}
                      onChange={(e) => updateVariant(v.id, { price: dollarsToCents(e.target.value) ?? 0 })}
                      className="w-20 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={centsToDollars(v.compare_at)}
                      onChange={(e) => updateVariant(v.id, { compare_at: dollarsToCents(e.target.value) })}
                      placeholder="—"
                      className="w-20 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      value={v.stock_on_hand}
                      onChange={(e) => updateVariant(v.id, { stock_on_hand: Number.parseInt(e.target.value, 10) || 0 })}
                      className="w-16 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <input type="checkbox" checked={v.is_active} onChange={(e) => updateVariant(v.id, { is_active: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-stone-500 mt-3">
            Option names label the storefront&rsquo;s variant picker — AliExpress often omits them, so they&rsquo;re
            inferred from the values on import and can be corrected here.
          </p>
          </div>
        </section>
      )}

      {tab === "Specifications" && (
        <section>
          <table className="w-full text-xs mb-4">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="py-2 pr-2">Group</th>
                <th className="py-2 pr-2">Label</th>
                <th className="py-2 pr-2">Value</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {specs.map((s, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-2 pr-2">
                    <input
                      value={s.group}
                      onChange={(e) => { setSpecs((prev) => prev.map((x, idx) => (idx === i ? { ...x, group: e.target.value } : x))); touch(); }}
                      className="w-32 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={s.label}
                      onChange={(e) => { setSpecs((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x))); touch(); }}
                      className="w-40 border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={s.value}
                      onChange={(e) => { setSpecs((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x))); touch(); }}
                      className="w-full border border-stone-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <button className="underline text-red-600" onClick={() => { setSpecs((prev) => prev.filter((_, idx) => idx !== i)); touch(); }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn-secondary text-xs"
            onClick={() => { setSpecs((prev) => [...prev, { group: "Specifications", label: "", value: "" }]); touch(); }}
          >
            Add specification
          </button>
          {specs.length === 0 && (
            <p className="text-xs text-stone-500 mt-3">
              No specifications. Products imported from AliExpress bring the supplier&rsquo;s spec table across
              automatically — re-confirm this product from staging to pull it in.
            </p>
          )}
        </section>
      )}

      {tab === "SEO" && (
        <section className="space-y-4">
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">SEO title ({(product.seo_title ?? "").length}/60)</span>
            <input value={product.seo_title ?? ""} onChange={(e) => update({ seo_title: e.target.value })} placeholder="Defaults to the product title" className="w-full border border-stone-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs text-stone-500 mb-1">SEO description ({(product.seo_desc ?? "").length}/160)</span>
            <textarea value={product.seo_desc ?? ""} onChange={(e) => update({ seo_desc: e.target.value })} rows={3} placeholder="Defaults to the short description" className="w-full border border-stone-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={product.is_indexable} onChange={(e) => update({ is_indexable: e.target.checked })} />
            <span>Allow search engines to index this product</span>
          </label>
        </section>
      )}
    </div>
  );
}
