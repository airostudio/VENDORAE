"use client";

import { useEffect, useState } from "react";

interface CheckoutSettings {
  shippingFlatRateCents: number;
  freeShippingThresholdCents: number;
  taxRatePercent: number;
}

/** cents <-> a plain dollar string for a text input, without floating-point surprises. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
function inputToCents(value: string): number {
  const n = Math.round(Number(value) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default function CheckoutSettingsCard() {
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/checkout-settings")
      .then((res) => res.json())
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load shipping & tax settings"));
  }, []);

  async function save(next: CheckoutSettings) {
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/checkout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save shipping & tax settings");
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save shipping & tax settings");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <section className="card p-6"><p className="text-sm text-red-600">{error}</p></section>;
  if (!settings) return <section className="card p-6"><p className="text-sm text-stone-500">Loading shipping & tax settings…</p></section>;

  return (
    <section className="card p-6">
      <h2 className="font-serif text-xl mb-2">Shipping & Tax</h2>
      <p className="text-sm text-stone-600 mb-6">
        Applied to every order at checkout. There is no live carrier-rate or tax-jurisdiction integration — this is a
        flat rate and a single flat tax percentage, set by you, not calculated from destination or product.
      </p>

      <div className="grid sm:grid-cols-2 gap-6 mb-4">
        <label className="text-sm">
          <span className="block text-xs text-stone-500 mb-1">Flat shipping rate</span>
          <input
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToInput(settings.shippingFlatRateCents)}
            onBlur={(e) => save({ ...settings, shippingFlatRateCents: inputToCents(e.target.value) })}
            className="w-full border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-stone-500 mb-1">Free shipping over</span>
          <input
            type="number"
            min={0}
            step={0.01}
            defaultValue={centsToInput(settings.freeShippingThresholdCents)}
            onBlur={(e) => save({ ...settings, freeShippingThresholdCents: inputToCents(e.target.value) })}
            className="w-full border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-stone-500 mb-1">Tax rate (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={settings.taxRatePercent}
            onBlur={(e) => {
              const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
              save({ ...settings, taxRatePercent: pct });
            }}
            className="w-full border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-xs text-stone-500">{saving ? "Saving…" : savedAt ? `Saved ${savedAt}` : "Changes save when you leave a field."}</p>
    </section>
  );
}
