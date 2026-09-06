"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

interface Banner {
  id: string;
  placement: string;
  headline: string;
  body: string | null;
  cta_label: string | null;
  cta_href: string | null;
  secondary_cta_label: string | null;
  secondary_cta_href: string | null;
  media_url: string | null;
  media_type: string;
  position: number;
  is_active: boolean;
}

const PLACEMENTS = ["homepage_hero", "promo_strip"] as const;

const emptyDraft = {
  headline: "",
  body: "",
  placement: "homepage_hero" as (typeof PLACEMENTS)[number],
  ctaLabel: "",
  ctaHref: "",
  secondaryCtaLabel: "",
  secondaryCtaHref: "",
  mediaUrl: "",
  position: 0,
  isActive: true,
};

interface EditDraft {
  headline?: string;
  body?: string;
  placement?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  mediaUrl?: string;
  position?: number;
  isActive?: boolean;
}

function BannerImagePicker({
  mediaUrl,
  onChange,
  uploading,
  onUpload,
}: {
  mediaUrl: string;
  onChange: (url: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <span className="block text-xs text-stone-500">Image</span>
      {mediaUrl && (
        <div className="relative w-full max-w-xs aspect-video bg-stone-100 border border-stone-200">
          <Image src={mediaUrl} alt="Banner preview" fill className="object-cover" unoptimized />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={mediaUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://... or upload a file"
          className="flex-1 min-w-[16rem] border border-stone-300 px-3 py-2 text-sm"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn-secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload image"}
        </button>
      </div>
    </div>
  );
}

/**
 * Full CRUD editor for the `banners` table — the homepage hero slideshow (placement
 * "homepage_hero") and any promo-strip banners are managed here. Mirrors the categories admin
 * page's inline-edit conventions. Images can be set either by pasting a `media_url` directly or
 * by uploading a file through /api/admin/banners/upload, which returns a URL without requiring
 * the banner row to exist yet.
 */
export default function BannerManager() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingNew, setUploadingNew] = useState(false);
  const [uploadingEditId, setUploadingEditId] = useState<string | null>(null);

  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/banners");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load banners");
      setBanners(data.banners ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load banners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/banners/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not upload the image");
      return data.mediaUrl as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the image");
      return null;
    }
  }

  async function uploadForNew(file: File) {
    setUploadingNew(true);
    setError(null);
    const url = await uploadImage(file);
    if (url) setDraft((d) => ({ ...d, mediaUrl: url }));
    setUploadingNew(false);
  }

  async function uploadForEdit(file: File) {
    if (!editingId) return;
    setUploadingEditId(editingId);
    setError(null);
    const url = await uploadImage(file);
    if (url) setEditDraft((d) => ({ ...d, mediaUrl: url }));
    setUploadingEditId(null);
  }

  async function create() {
    if (!draft.headline.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: draft.headline.trim(),
          body: draft.body || null,
          placement: draft.placement,
          ctaLabel: draft.ctaLabel || null,
          ctaHref: draft.ctaHref || null,
          secondaryCtaLabel: draft.secondaryCtaLabel || null,
          secondaryCtaHref: draft.secondaryCtaHref || null,
          mediaUrl: draft.mediaUrl || null,
          position: draft.position,
          isActive: draft.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create banner");
      setDraft(emptyDraft);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create banner");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(b: Banner) {
    setEditingId(b.id);
    setEditDraft({
      headline: b.headline,
      body: b.body ?? "",
      placement: b.placement,
      ctaLabel: b.cta_label ?? "",
      ctaHref: b.cta_href ?? "",
      secondaryCtaLabel: b.secondary_cta_label ?? "",
      secondaryCtaHref: b.secondary_cta_href ?? "",
      mediaUrl: b.media_url ?? "",
      position: b.position,
      isActive: b.is_active,
    });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/banners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: editDraft.headline,
          body: editDraft.body || null,
          placement: editDraft.placement,
          ctaLabel: editDraft.ctaLabel || null,
          ctaHref: editDraft.ctaHref || null,
          secondaryCtaLabel: editDraft.secondaryCtaLabel || null,
          secondaryCtaHref: editDraft.secondaryCtaHref || null,
          mediaUrl: editDraft.mediaUrl || null,
          position: editDraft.position,
          isActive: editDraft.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save banner");
      setEditingId(null);
      setEditDraft({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save banner");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/banners/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not delete banner");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete banner");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-stone-500 mb-6">
        Banners with placement <code className="bg-stone-100 px-1">homepage_hero</code> drive the homepage hero
        slideshow — the first one by position supplies the headline, body and buttons, and every active one
        contributes an image to the crossfade.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="card p-4 mb-6 space-y-3">
        <p className="text-sm font-medium">New banner</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Headline</span>
            <input
              value={draft.headline}
              onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Placement</span>
            <select
              value={draft.placement}
              onChange={(e) => setDraft((d) => ({ ...d, placement: e.target.value as (typeof PLACEMENTS)[number] }))}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            >
              {PLACEMENTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-sm block">
          <span className="block text-xs text-stone-500 mb-1">Body</span>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={2}
            className="w-full border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">CTA label</span>
            <input
              value={draft.ctaLabel}
              onChange={(e) => setDraft((d) => ({ ...d, ctaLabel: e.target.value }))}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">CTA link</span>
            <input
              value={draft.ctaHref}
              onChange={(e) => setDraft((d) => ({ ...d, ctaHref: e.target.value }))}
              placeholder="/shop"
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Secondary CTA label</span>
            <input
              value={draft.secondaryCtaLabel}
              onChange={(e) => setDraft((d) => ({ ...d, secondaryCtaLabel: e.target.value }))}
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Secondary CTA link</span>
            <input
              value={draft.secondaryCtaHref}
              onChange={(e) => setDraft((d) => ({ ...d, secondaryCtaHref: e.target.value }))}
              placeholder="/shop"
              className="w-full border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <BannerImagePicker
          mediaUrl={draft.mediaUrl}
          onChange={(url) => setDraft((d) => ({ ...d, mediaUrl: url }))}
          uploading={uploadingNew}
          onUpload={uploadForNew}
        />

        <div className="flex items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Position</span>
            <input
              type="number"
              value={draft.position}
              onChange={(e) => setDraft((d) => ({ ...d, position: Number(e.target.value) || 0 }))}
              className="w-24 border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
            <span>Active</span>
          </label>
          <button className="btn-primary ml-auto" disabled={busy || !draft.headline.trim()} onClick={create}>
            Add banner
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-stone-500">Loading banners…</p>}

      <div className="space-y-3">
        {banners.map((b) => (
          <div key={b.id} className="border border-stone-200">
            {editingId === b.id ? (
              <div className="p-4 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Headline</span>
                    <input
                      value={editDraft.headline ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, headline: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Placement</span>
                    <select
                      value={editDraft.placement ?? "homepage_hero"}
                      onChange={(e) => setEditDraft((d) => ({ ...d, placement: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    >
                      {PLACEMENTS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="text-sm block">
                  <span className="block text-xs text-stone-500 mb-1">Body</span>
                  <textarea
                    value={editDraft.body ?? ""}
                    onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))}
                    rows={2}
                    className="w-full border border-stone-300 px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">CTA label</span>
                    <input
                      value={editDraft.ctaLabel ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, ctaLabel: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">CTA link</span>
                    <input
                      value={editDraft.ctaHref ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, ctaHref: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Secondary CTA label</span>
                    <input
                      value={editDraft.secondaryCtaLabel ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, secondaryCtaLabel: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Secondary CTA link</span>
                    <input
                      value={editDraft.secondaryCtaHref ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, secondaryCtaHref: e.target.value }))}
                      className="w-full border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <BannerImagePicker
                  mediaUrl={editDraft.mediaUrl ?? ""}
                  onChange={(url) => setEditDraft((d) => ({ ...d, mediaUrl: url }))}
                  uploading={uploadingEditId === b.id}
                  onUpload={uploadForEdit}
                />

                <div className="flex items-end gap-4">
                  <label className="text-sm">
                    <span className="block text-xs text-stone-500 mb-1">Position</span>
                    <input
                      type="number"
                      value={editDraft.position ?? 0}
                      onChange={(e) => setEditDraft((d) => ({ ...d, position: Number(e.target.value) || 0 }))}
                      className="w-24 border border-stone-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input
                      type="checkbox"
                      checked={editDraft.isActive ?? false}
                      onChange={(e) => setEditDraft((d) => ({ ...d, isActive: e.target.checked }))}
                    />
                    <span>Active</span>
                  </label>
                  <div className="ml-auto flex gap-2">
                    <button className="btn-primary" disabled={busy} onClick={() => saveEdit(b.id)}>
                      Save
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft({});
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 flex items-start gap-4">
                {b.media_url && (
                  <div className="relative w-24 h-16 flex-shrink-0 bg-stone-100">
                    <Image src={b.media_url} alt={b.headline} fill className="object-cover" unoptimized />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {b.headline}
                    {!b.is_active && <span className="text-xs text-stone-400 ml-2">inactive</span>}
                  </p>
                  <p className="text-xs text-stone-500 font-mono">
                    {b.placement} · position {b.position}
                  </p>
                  {b.body && <p className="text-xs text-stone-500 mt-1">{b.body}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button className="text-xs underline" onClick={() => startEdit(b)}>
                    Edit
                  </button>
                  <button className="text-xs underline text-red-600" disabled={busy} onClick={() => remove(b.id)}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {!loading && banners.length === 0 && <p className="text-sm text-stone-500">No banners yet — add one above.</p>}
    </div>
  );
}
