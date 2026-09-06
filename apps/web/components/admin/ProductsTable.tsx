"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import {
  deleteProducts,
  publishProduct,
  setProductsMainCategory,
  setProductsStatus,
} from "@/app/admin/products/actions";
import type { AdminProductSummary } from "@/lib/data/products";

export interface CategoryChoice {
  id: string;
  name: string;
}

export default function ProductsTable({
  products,
  storeCurrency,
  categories,
}: {
  products: AdminProductSummary[];
  storeCurrency: string;
  categories: CategoryChoice[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // The page's labels, which disambiguate two categories that share a name — worth using here
  // too, so the column and the dropdown agree on what a category is called.
  const labelById = new Map(categories.map((c) => [c.id, c.name]));
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      setSelected(new Set());
      router.refresh();
    });
  }

  function confirmDelete() {
    const count = selected.size;
    const ok = window.confirm(
      `Delete ${count} product${count === 1 ? "" : "s"}?\n\nThis removes them, their variants, images and stock permanently. ` +
        "Products that appear in past orders can't be deleted and will be listed instead — archive those.",
    );
    if (ok) run(() => deleteProducts([...selected]));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3 min-h-[34px]">
        {someSelected ? (
          <>
            <span className="text-xs text-stone-600">
              {selected.size} selected
            </span>
            <button className="btn-secondary text-xs px-3 py-1.5" disabled={pending} onClick={() => run(() => setProductsStatus([...selected], "PUBLISHED"))}>
              Publish
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" disabled={pending} onClick={() => run(() => setProductsStatus([...selected], "DRAFT"))}>
              Move to Draft
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" disabled={pending} onClick={() => run(() => setProductsStatus([...selected], "ARCHIVED"))}>
              Archive
            </button>
            {/* Moves rather than adds: whatever category the products were in is replaced, so this
                is the one control that answers "these are all in the wrong section". */}
            <select
              className="text-xs border border-stone-300 px-2 py-1.5 bg-white"
              disabled={pending || categories.length === 0}
              value=""
              aria-label="Move selected products to a category"
              onChange={(e) => {
                const categoryId = e.target.value;
                if (!categoryId) return;
                const ids = [...selected];
                e.target.value = "";
                run(() => setProductsMainCategory(ids, categoryId));
              }}
            >
              <option value="">
                {categories.length === 0 ? "No categories yet" : "Move to category…"}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="text-xs px-3 py-1.5 text-red-600 border border-red-200 hover:bg-red-50"
              disabled={pending}
              onClick={confirmDelete}
            >
              Delete
            </button>
            <button className="text-xs underline text-stone-500" disabled={pending} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            {pending && <span className="text-xs text-stone-500">Working…</span>}
          </>
        ) : (
          <span className="text-xs text-stone-400">Tick products to publish, archive, delete or re-categorise them together.</span>
        )}
      </div>

      {message && (
        <p className={`text-xs mb-3 ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="py-2 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={products.length === 0}
                aria-label="Select all products"
              />
            </th>
            <th className="py-2">Title</th>
            <th className="py-2">Category</th>
            <th className="py-2">Type</th>
            <th className="py-2">Price</th>
            <th className="py-2">Currency</th>
            <th className="py-2">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={`border-b border-stone-100 ${selected.has(p.id) ? "bg-warm-100" : ""}`}>
              <td className="py-2">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  aria-label={`Select ${p.title}`}
                />
              </td>
              <td className="py-2">
                {/* The name is the way into the editor — underlined so it reads as a link rather
                    than only revealing itself on hover. */}
                <Link href={`/admin/products/${p.id}`} className="underline decoration-stone-300 hover:decoration-ink-950">
                  {p.title}
                </Link>
              </td>
              <td className="py-2 text-stone-500">
                {p.mainCategories.length > 0 ? (
                  p.mainCategories.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      {/* A subcategory's parent shown here was never assigned directly — it's the
                          parent page's rollup made visible, not a second, real link. Muted so it
                          doesn't read as an assignment the admin needs to double check. */}
                      <span
                        className={c.implied ? "text-stone-400" : undefined}
                        title={c.implied ? "Shown because a subcategory is assigned below it — not a direct assignment" : undefined}
                      >
                        {labelById.get(c.id) ?? c.name}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-amber-700" title="Only reachable by direct link — no category to browse it from">
                    none
                  </span>
                )}
              </td>
              <td className="py-2 text-stone-500">{p.productType}</td>
              <td className="py-2">
                {p.priceCents > 0 ? formatMoney(p.priceCents, p.currency) : <span className="text-red-600">no price</span>}
              </td>
              <td className={`py-2 ${p.currency === storeCurrency ? "text-stone-500" : "text-red-600 font-medium"}`}>
                {p.currency}
              </td>
              <td className="py-2 text-stone-500">{p.status}</td>
              <td className="py-2">
                <div className="flex gap-3 items-center">
                  <Link href={`/admin/products/${p.id}`} className="text-xs underline">
                    Edit
                  </Link>
                  {p.status !== "PUBLISHED" && (
                    <form action={publishProduct.bind(null, p.id)}>
                      <button type="submit" className="text-xs underline">
                        Publish
                      </button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
