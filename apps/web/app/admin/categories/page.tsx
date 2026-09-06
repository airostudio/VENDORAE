"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  handle: string;
  description: string | null;
  position: number;
  is_hidden: boolean;
  productCount: number;
  publishedCount: number;
}

interface CategoryProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Category>>({});

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [productsByCategory, setProductsByCategory] = useState<Record<string, CategoryProduct[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/categories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load categories");
      setCategories(data.categories ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), parentId: newParentId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create category");
      setNewName("");
      setNewParentId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create category");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          handle: draft.handle,
          description: draft.description ?? null,
          parentId: draft.parent_id ?? null,
          isHidden: draft.is_hidden,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save category");
      setEditingId(null);
      setDraft({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save category");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not delete category");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete category");
    } finally {
      setBusy(false);
    }
  }

  async function toggleProducts(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!productsByCategory[id]) {
      const res = await fetch(`/api/admin/categories/${id}/products`);
      const data = await res.json();
      setProductsByCategory((prev) => ({ ...prev, [id]: data.products ?? [] }));
    }
  }

  async function removeFromCategory(categoryId: string, productId: string) {
    setError(null);
    const res = await fetch(`/api/admin/categories/${categoryId}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, action: "remove" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not remove the product from this category");
      return;
    }
    setProductsByCategory((prev) => ({ ...prev, [categoryId]: (prev[categoryId] ?? []).filter((p) => p.id !== productId) }));
    await load();
  }

  const parents = categories.filter((c) => !c.parent_id);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="max-w-4xl">
      <h1 className="font-serif text-3xl mb-6">Categories</h1>

      <div className="card p-4 mb-6 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New category name"
          className="flex-1 border border-stone-300 px-3 py-2 text-sm"
        />
        {/* A subcategory (e.g. Vibrators under Adult Toys) can be created directly under its
            parent here, rather than creating it top-level and re-parenting it afterwards. */}
        <select
          value={newParentId}
          onChange={(e) => setNewParentId(e.target.value)}
          className="border border-stone-300 px-3 py-2 text-sm text-stone-600"
          aria-label="Parent category"
        >
          <option value="">No parent (top level)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              Under {p.name}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={busy || !newName.trim()} onClick={create}>
          Add category
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Loading categories…</p>}

      <div className="space-y-3">
        {categories.map((c) => (
          <div key={c.id} className="border border-stone-200">
            {editingId === c.id ? (
              <div className="p-4 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Name</span>
                    <input
                      value={draft.name ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">URL handle</span>
                    <input
                      value={draft.handle ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, handle: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm font-mono"
                    />
                  </label>
                </div>
                <label className="text-sm block">
                  <span className="block text-xs text-stone-500 mb-1">Description</span>
                  <textarea
                    value={draft.description ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    rows={2}
                    className="w-full border border-stone-300 px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Parent category</span>
                    <select
                      value={draft.parent_id ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, parent_id: e.target.value || null }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    >
                      <option value="">None (top level)</option>
                      {parents
                        .filter((p) => p.id !== c.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex items-end gap-2 text-sm pb-2">
                    <input
                      type="checkbox"
                      checked={draft.is_hidden ?? false}
                      onChange={(e) => setDraft((d) => ({ ...d, is_hidden: e.target.checked }))}
                    />
                    <span>Hidden from the storefront</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => saveEdit(c.id)}>
                    Save
                  </button>
                  <button className="btn-secondary" disabled={busy} onClick={() => { setEditingId(null); setDraft({}); }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {c.name}
                    {c.is_hidden && <span className="text-xs text-stone-400 ml-2">hidden</span>}
                  </p>
                  <p className="text-xs text-stone-500 font-mono">/{c.handle}</p>
                  {c.parent_id && <p className="text-xs text-stone-400 mt-1">under {nameById.get(c.parent_id) ?? "—"}</p>}
                  {c.description && <p className="text-xs text-stone-500 mt-1">{c.description}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Both numbers, because they fail differently: a category the storefront shows as
                      empty is a publishing problem if the links are there, and an assignment that
                      never landed if they aren't. The storefront lists the published count. */}
                  <button className="text-xs underline text-left" onClick={() => toggleProducts(c.id)}>
                    {c.publishedCount} live
                    {c.productCount !== c.publishedCount && (
                      <span className="text-stone-400"> of {c.productCount} assigned</span>
                    )}
                  </button>
                  <button
                    className="text-xs underline"
                    onClick={() => {
                      setEditingId(c.id);
                      setDraft(c);
                    }}
                  >
                    Edit
                  </button>
                  <button className="text-xs underline text-red-600" disabled={busy} onClick={() => remove(c.id)}>
                    Delete
                  </button>
                </div>
              </div>
            )}

            {expandedId === c.id && (
              <div className="border-t border-stone-100 bg-stone-50 px-4 py-3">
                {(productsByCategory[c.id] ?? []).length === 0 ? (
                  <p className="text-xs text-stone-500">No products in this category yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {(productsByCategory[c.id] ?? []).map((p) => (
                      <li key={p.id} className="flex items-center justify-between text-xs">
                        <Link href={`/admin/products/${p.id}`} className="underline">
                          {p.title}
                        </Link>
                        <span className="flex items-center gap-3">
                          <span className="text-stone-400">{p.status}</span>
                          <button className="underline text-stone-500" onClick={() => removeFromCategory(c.id, p.id)}>
                            Remove
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {!loading && categories.length === 0 && (
        <p className="text-sm text-stone-500">No categories yet — add one above.</p>
      )}
    </div>
  );
}
