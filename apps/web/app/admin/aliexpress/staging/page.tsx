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
  categoryId: string | null;
  suggestedCategoryId: string | null;
  publish: boolean;
  currencyCode: string;
  imageUrls: string[];
  skus: StagedSku[];
  createdAt: string;
}

interface CategoryOption {
  id: string;
  handle: string;
  name: string;
}

interface ConfirmOutcome {
  stagedId: string;
  ok: boolean;
  handle?: string;
  status?: "DRAFT" | "PUBLISHED";
  error?: string;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function priceRange(skus: StagedSku[], currency: string): string {
  if (skus.length === 0) return "—";
  const prices = skus.map((s) => s.retailPriceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

export default function AliExpressStagingPage() {
  const [staged, setStaged] = useState<StagedProduct[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConfirmOutcome[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stagedRes, categoriesRes] = await Promise.all([
        fetch("/api/admin/products/aliexpress/staged"),
        fetch("/api/admin/categories"),
      ]);
      const stagedData = await stagedRes.json();
      if (!stagedRes.ok) throw new Error(stagedData.error ?? "Could not load the staging queue");
      const categoriesData = await categoriesRes.json().catch(() => ({ categories: [] }));
      setStaged(stagedData.staged ?? []);
      setCategories(categoriesData.categories ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the staging queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmable = staged.filter((s) => s.status === "ready");
  const allSelected = confirmable.length > 0 && confirmable.every((s) => selected.has(s.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(confirmable.map((s) => s.id)));
  }

  async function confirmSelected() {
    await confirmIds(confirmable.filter((s) => selected.has(s.id)).map((s) => s.id));
  }

  async function confirmIds(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setOutcomes(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/products/aliexpress/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagedIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not confirm these products");
      setOutcomes(data.results ?? []);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm these products");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/aliexpress/staged/${id}`, { method: "DELETE" });
      // A discard that failed used to look identical to one that worked — the row simply
      // reappeared on the next load with nothing to say why.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not remove this staged product");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setCategory(id: string, categoryId: string | null) {
    setStaged((prev) => prev.map((s) => (s.id === id ? { ...s, categoryId } : s)));
    await fetch(`/api/admin/products/aliexpress/staged/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/products/import" className="text-xs text-stone-500 underline">
          ← Back to Import
        </Link>
      </div>

      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="eyebrow mb-2">AliExpress</p>
          <h1 className="font-serif text-3xl">Staging</h1>
        </div>
        <Link href="/admin/products/import" className="btn-secondary">
          Add more products
        </Link>
      </div>
      <p className="text-sm text-stone-600 mb-8 max-w-2xl">
        Products fetched from AliExpress with pricing applied, copy rewritten for SEO and a category
        suggested. None of them exist in the store yet — open one to adjust anything, then confirm to
        create it.
      </p>

      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {outcomes && (
        <div className="border border-stone-200 p-4 mb-6 text-sm">
          <p className="font-medium mb-2">
            {outcomes.filter((o) => o.ok).length} added to the store
            {outcomes.some((o) => !o.ok) && ` · ${outcomes.filter((o) => !o.ok).length} failed`}
          </p>
          <ul className="text-xs text-stone-600 space-y-1">
            {outcomes.map((o) => (
              <li key={o.stagedId}>
                {o.ok ? (
                  <>
                    ✓ <span className="font-medium">{o.handle}</span>
                    {o.status === "DRAFT" ? (
                      <span className="text-amber-700"> — created as Draft, so it is not on the storefront yet</span>
                    ) : (
                      <span className="text-green-700"> — published and live</span>
                    )}
                  </>
                ) : (
                  <span className="text-red-600">✕ {o.error}</span>
                )}
              </li>
            ))}
          </ul>
          {outcomes.some((o) => o.ok && o.status === "DRAFT") && (
            <p className="text-xs text-stone-500 mt-2">
              Draft products appear in Products (newest first) but stay off the storefront until published — use
              &ldquo;Publish All Drafts&rdquo; there, or set the status before confirming.
            </p>
          )}
          <Link href="/admin/products" className="text-xs underline mt-3 inline-block">
            View them in Products →
          </Link>
        </div>
      )}

      {loading && <p className="text-sm text-stone-500">Loading the staging queue…</p>}

      {!loading && staged.length === 0 && (
        <div className="border border-stone-200 p-8 text-center">
          <p className="text-sm text-stone-600 mb-4">Nothing staged yet.</p>
          <Link href="/admin/products/import" className="btn-primary inline-block">
            Paste AliExpress links
          </Link>
        </div>
      )}

      {!loading && staged.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-stone-200">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={confirmable.length === 0} />
              Select all ({confirmable.length})
            </label>
            <button className="btn-primary" disabled={busy || selected.size === 0} onClick={confirmSelected}>
              {busy ? "Confirming…" : selected.size === 0 ? "Confirm selected" : `Confirm ${selected.size} selected`}
            </button>
            {selected.size === 0 && !busy && (
              <span className="text-xs text-stone-400">tick products above, or use Confirm on a card</span>
            )}
            <span className="text-xs text-stone-500 ml-auto">
              {staged.length} staged{staged.some((s) => s.status === "failed") && " · some failed to fetch"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {staged.map((item) => (
              <div key={item.id} className="border border-stone-200 flex flex-col">
                <div className="relative">
                  <Link href={`/admin/aliexpress/staging/${item.id}`}>
                    {item.imageUrls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrls[0]} alt="" className="w-full aspect-square object-cover bg-stone-100" />
                    ) : (
                      <div className="w-full aspect-square bg-stone-100 flex items-center justify-center text-xs text-stone-400">
                        No image
                      </div>
                    )}
                  </Link>
                  {item.status === "ready" && (
                    <input
                      type="checkbox"
                      className="absolute top-2 left-2 w-4 h-4"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  )}
                  {item.imageUrls.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-ink-950/80 text-warm-50 text-[10px] px-1.5 py-0.5">
                      {item.imageUrls.length} images
                    </span>
                  )}
                </div>

                <div className="p-3 flex-1 flex flex-col">
                  {item.status === "failed" ? (
                    <>
                      <p className="text-xs text-red-600 mb-1">Could not fetch this product</p>
                      <p className="text-xs text-stone-500 flex-1">{item.error}</p>
                      <p className="text-[10px] text-stone-400 mt-2">{item.aliexpressProductId}</p>
                    </>
                  ) : (
                    <>
                      <Link href={`/admin/aliexpress/staging/${item.id}`} className="text-sm font-medium line-clamp-2 hover:underline">
                        {item.title}
                      </Link>
                      <p className="text-xs text-stone-500 mt-1">
                        {priceRange(item.skus, item.currencyCode)} · {item.skus.length} variant
                        {item.skus.length === 1 ? "" : "s"}
                      </p>
                      <div className="mt-2 flex-1">
                        <select
                          className="w-full border border-stone-300 text-xs px-2 py-1"
                          value={item.categoryId ?? ""}
                          onChange={(e) => setCategory(item.id, e.target.value || null)}
                        >
                          <option value="">No category</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {item.categoryId && item.categoryId === item.suggestedCategoryId && (
                          <p className="text-[10px] text-stone-400 mt-1">auto-suggested</p>
                        )}
                      </div>
                    </>
                  )}

                  <div className="flex gap-3 items-center mt-3 pt-3 border-t border-stone-100">
                    {item.status === "ready" && (
                      <>
                        <button className="btn-primary text-xs py-1 px-3" disabled={busy} onClick={() => confirmIds([item.id])}>
                          Confirm
                        </button>
                        <Link href={`/admin/aliexpress/staging/${item.id}`} className="text-xs underline">
                          Open &amp; edit
                        </Link>
                      </>
                    )}
                    <button className="text-xs underline text-stone-500 ml-auto" disabled={busy} onClick={() => remove(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
