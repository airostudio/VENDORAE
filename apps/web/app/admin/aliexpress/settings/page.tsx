"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RoundingMode = "none" | "up-95" | "up-99" | "up-00";
type PricingRule =
  | { type: "percent_margin"; marginRate: number; rounding: RoundingMode }
  | { type: "fixed_markup"; markupCents: number; rounding: RoundingMode }
  | { type: "tiered_margin"; tiers: Array<{ maxCostCents?: number; marginRate: number }>; rounding: RoundingMode };

interface StoreSettings {
  pricing: {
    minPriceCents?: number;
    maxPriceCents?: number;
    ignorePriceChangeBelowPercent?: number;
    compareAtRule?: PricingRule;
    rule?: PricingRule;
  };
  import: { defaultStatus: "draft" | "published"; targetCurrency?: string; shipToCountry?: string };
  stock: { outOfStockBehavior: "mark_unavailable" | "keep_visible"; ignoreStockChangeBelowUnits?: number };
  shipping: { preferredLogisticsService?: string };
  notifications: {
    priceChanged: boolean;
    outOfStock: boolean;
    restocked: boolean;
    orderShipped: boolean;
    orderDelivered: boolean;
    fulfillmentFailed: boolean;
  };
}

// Two-decimal currencies only. Prices are held as integer cents throughout, and a zero-decimal
// currency (JPY, KRW) would be charged 100x under that model — so it is not offered here.
const CURRENCIES = ["USD", "AUD", "NZD", "GBP", "EUR", "CAD", "SGD"];
const SHIP_TO_COUNTRIES: Array<[string, string]> = [
  ["US", "United States"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["SG", "Singapore"],
];

const DEFAULT_MARKUP_RULE: PricingRule = { type: "percent_margin", marginRate: 0.35, rounding: "up-95" };

const ROUNDING_LABELS: Record<RoundingMode, string> = { none: "No rounding", "up-95": "Round up to .95", "up-99": "Round up to .99", "up-00": "Round up to whole dollar" };

function dollarsToCents(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

function centsToDollars(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toString();
}

export default function DropshipSettingsPage() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [compareAtEnabled, setCompareAtEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSettings(data.settings);
        setCompareAtEnabled(Boolean(data.settings?.pricing?.compareAtRule));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load settings"));
  }, []);

  const markupRule: PricingRule = settings?.pricing.rule ?? DEFAULT_MARKUP_RULE;

  /** Mirrors the engine's applyRounding, so the worked example matches what an import actually produces. */
  function applyRounding(cents: number, mode: RoundingMode): number {
    if (cents <= 0) return 0;
    if (mode === "none") return Math.round(cents);
    const ending = mode === "up-95" ? 95 : mode === "up-99" ? 99 : 0;
    const dollars = Math.floor(cents / 100);
    if (mode === "up-00") return cents % 100 === 0 ? cents : (dollars + 1) * 100;
    const target = dollars * 100 + ending;
    return cents <= target ? target : (dollars + 1) * 100 + ending;
  }

  const EXAMPLE_COST_CENTS = 1000;

  function formatMoney(cents: number): string {
    const currency = settings?.import.targetCurrency ?? "USD";
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  }

  function formatExampleCost(): string {
    return formatMoney(EXAMPLE_COST_CENTS);
  }

  function formatExamplePrice(): string {
    const raw =
      markupRule.type === "fixed_markup"
        ? EXAMPLE_COST_CENTS + markupRule.markupCents
        : markupRule.type === "percent_margin"
          ? EXAMPLE_COST_CENTS * (1 + markupRule.marginRate)
          : EXAMPLE_COST_CENTS;
    return formatMoney(applyRounding(raw, markupRule.rounding));
  }

  function update<K extends keyof StoreSettings>(section: K, patch: Partial<StoreSettings[K]>) {
    setSettings((prev) => (prev ? { ...prev, [section]: { ...prev[section], ...patch } } : prev));
  }

  async function save() {
    if (!settings) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const payload: Partial<StoreSettings> = {
        ...settings,
        pricing: { ...settings.pricing, compareAtRule: compareAtEnabled ? settings.pricing.compareAtRule ?? { type: "percent_margin", marginRate: 0.6, rounding: "up-99" } : undefined },
      };
      const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save settings");
      setSettings(data.settings);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <p className="eyebrow mb-2">AliExpress</p>
        <h1 className="font-serif text-3xl mb-6">Dropship Settings</h1>
        <div className="card p-6">
          <p className="text-sm text-red-600 mb-3">{loadError}</p>
          <Link href="/admin/aliexpress" className="underline text-sm">
            Check your AliExpress connection
          </Link>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl">
        <p className="eyebrow mb-2">AliExpress</p>
        <h1 className="font-serif text-3xl mb-6">Dropship Settings</h1>
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <p className="eyebrow mb-2">AliExpress</p>
      <h1 className="font-serif text-3xl mb-2">Dropship Settings</h1>
      <p className="text-sm text-stone-600 mb-8">
        Controls how every AliExpress product this store imports gets priced, synced, shipped, and reported on. Changes
        apply going forward — they don&rsquo;t retroactively touch products already imported.
      </p>

      {/* Pricing */}
      <section className="card p-6 mb-6">
        <h2 className="font-serif text-xl mb-4">Pricing</h2>

        <div className="border-b border-stone-200 pb-5 mb-5">
          <p className="text-xs font-medium mb-1">Markup on imported products</p>
          <p className="text-xs text-stone-500 mb-3">
            How every imported variant&rsquo;s price is calculated from what the supplier charges. This is the number
            that decides your margin.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-stone-500 mb-1">Method</span>
              <select
                className="w-full border border-stone-300 px-3 py-2 text-sm"
                value={markupRule.type}
                onChange={(e) =>
                  update("pricing", {
                    rule:
                      e.target.value === "fixed_markup"
                        ? { type: "fixed_markup", markupCents: 1000, rounding: markupRule.rounding }
                        : { type: "percent_margin", marginRate: 0.35, rounding: markupRule.rounding },
                  })
                }
              >
                <option value="percent_margin">Percentage of cost</option>
                <option value="fixed_markup">Fixed amount per item</option>
              </select>
            </label>

            {markupRule.type === "percent_margin" ? (
              <label className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Markup (%)</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="w-full border border-stone-300 px-3 py-2 text-sm"
                  value={Math.round(markupRule.marginRate * 100)}
                  onChange={(e) =>
                    update("pricing", {
                      rule: { type: "percent_margin", marginRate: (Number(e.target.value) || 0) / 100, rounding: markupRule.rounding },
                    })
                  }
                />
              </label>
            ) : (
              <label className="text-sm">
                <span className="block text-xs text-stone-500 mb-1">Markup ($ per item)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full border border-stone-300 px-3 py-2 text-sm"
                  value={centsToDollars(markupRule.type === "fixed_markup" ? markupRule.markupCents : undefined)}
                  onChange={(e) =>
                    update("pricing", {
                      rule: { type: "fixed_markup", markupCents: dollarsToCents(e.target.value) ?? 0, rounding: markupRule.rounding },
                    })
                  }
                />
              </label>
            )}

            <label className="text-sm">
              <span className="block text-xs text-stone-500 mb-1">Rounding</span>
              <select
                className="w-full border border-stone-300 px-3 py-2 text-sm"
                value={markupRule.rounding}
                onChange={(e) => update("pricing", { rule: { ...markupRule, rounding: e.target.value as RoundingMode } })}
              >
                {(Object.keys(ROUNDING_LABELS) as RoundingMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {ROUNDING_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-stone-500 mt-2">
            Example: a {formatExampleCost()} item sells for <span className="font-medium">{formatExamplePrice()}</span>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Minimum price ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border border-stone-300 px-3 py-2 text-sm"
              value={centsToDollars(settings.pricing.minPriceCents)}
              onChange={(e) => update("pricing", { minPriceCents: dollarsToCents(e.target.value) })}
              placeholder="No floor"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Maximum price ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border border-stone-300 px-3 py-2 text-sm"
              value={centsToDollars(settings.pricing.maxPriceCents)}
              onChange={(e) => update("pricing", { maxPriceCents: dollarsToCents(e.target.value) })}
              placeholder="No ceiling"
            />
          </label>
        </div>
        <p className="text-xs text-stone-500 mb-4">
          Whatever your pricing rule computes, the final price is clamped to stay within these bounds — a safety rail
          against a rule producing something absurdly cheap or expensive.
        </p>

        <label className="text-sm block mb-4">
          <span className="block text-xs text-stone-500 mb-1">Ignore price-sync changes smaller than (%)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={settings.pricing.ignorePriceChangeBelowPercent ?? ""}
            onChange={(e) => update("pricing", { ignorePriceChangeBelowPercent: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="e.g. 2 — every change triggers a sync by default"
          />
        </label>
        <p className="text-xs text-stone-500 mb-4">
          Suppliers' prices drift by a few cents constantly. This filters those out of your price-change log and
          webhook notifications — the price still updates, you just aren&rsquo;t alerted for noise.
        </p>

        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input type="checkbox" checked={compareAtEnabled} onChange={(e) => setCompareAtEnabled(e.target.checked)} />
          <span>Show a strikethrough compare-at price</span>
        </label>
        {compareAtEnabled && (
          <div className="pl-6 border-l-2 border-stone-200 mb-2">
            <label className="text-sm block mb-2">
              <span className="block text-xs text-stone-500 mb-1">Compare-at margin (e.g. 0.6 = cost + 60%)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full border border-stone-300 px-3 py-2 text-sm"
                value={settings.pricing.compareAtRule?.type === "percent_margin" ? settings.pricing.compareAtRule.marginRate : ""}
                onChange={(e) =>
                  update("pricing", { compareAtRule: { type: "percent_margin", marginRate: Number(e.target.value) || 0, rounding: "up-99" } })
                }
              />
            </label>
            <p className="text-xs text-stone-500">Computed the same way as your main price, usually at a higher margin, and shown as the crossed-out "was" price.</p>
          </div>
        )}
      </section>

      {/* Import */}
      <section className="card p-6 mb-6">
        <h2 className="font-serif text-xl mb-4">Import</h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Sell in currency</span>
            <select
              className="w-full border border-stone-300 px-3 py-2 text-sm"
              value={settings.import.targetCurrency ?? "USD"}
              onChange={(e) => update("import", { targetCurrency: e.target.value })}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Price for delivery to</span>
            <select
              className="w-full border border-stone-300 px-3 py-2 text-sm"
              value={settings.import.shipToCountry ?? "US"}
              onChange={(e) => update("import", { shipToCountry: e.target.value })}
            >
              {SHIP_TO_COUNTRIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-stone-500 mb-4">
          AliExpress quotes supplier costs in this currency for this destination, so your markup is calculated on what
          you actually pay to ship to your customers — and imported prices are already in the currency you charge in.
        </p>

        <label className="text-sm block">
          <span className="block text-xs text-stone-500 mb-1">New imports land as</span>
          <select
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={settings.import.defaultStatus}
            onChange={(e) => update("import", { defaultStatus: e.target.value as StoreSettings["import"]["defaultStatus"] })}
          >
            <option value="draft">Draft — review before publishing</option>
            <option value="published">Published — live immediately</option>
          </select>
        </label>
      </section>

      {/* Stock & Sync */}
      <section className="card p-6 mb-6">
        <h2 className="font-serif text-xl mb-4">Stock &amp; Sync</h2>
        <label className="text-sm block mb-4">
          <span className="block text-xs text-stone-500 mb-1">When AliExpress reports a listing out of stock</span>
          <select
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={settings.stock.outOfStockBehavior}
            onChange={(e) => update("stock", { outOfStockBehavior: e.target.value as StoreSettings["stock"]["outOfStockBehavior"] })}
          >
            <option value="mark_unavailable">Hide it from customers</option>
            <option value="keep_visible">Keep it visible (reconcile manually)</option>
          </select>
        </label>
        <label className="text-sm block">
          <span className="block text-xs text-stone-500 mb-1">Only restock once available units reach</span>
          <input
            type="number"
            step="1"
            min="0"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={settings.stock.ignoreStockChangeBelowUnits ?? ""}
            onChange={(e) => update("stock", { ignoreStockChangeBelowUnits: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="e.g. 5 — any stock above 0 restocks by default"
          />
        </label>
        <p className="text-xs text-stone-500 mt-2">Filters a supplier's momentary 1-2 unit blips from flapping a listing live and then sold-out again.</p>
      </section>

      {/* Shipping */}
      <section className="card p-6 mb-6">
        <h2 className="font-serif text-xl mb-4">Shipping</h2>
        <label className="text-sm block">
          <span className="block text-xs text-stone-500 mb-1">Preferred AliExpress logistics service</span>
          <input
            type="text"
            className="w-full border border-stone-300 px-3 py-2 text-sm"
            value={settings.shipping.preferredLogisticsService ?? ""}
            onChange={(e) => update("shipping", { preferredLogisticsService: e.target.value || undefined })}
            placeholder="e.g. CAINIAO_STANDARD, EPACKET (engine default if left blank)"
          />
        </label>
      </section>

      {/* Notifications */}
      <section className="card p-6 mb-6">
        <h2 className="font-serif text-xl mb-4">Notifications</h2>
        <p className="text-xs text-stone-500 mb-4">Which webhook events the engine sends to this store. Turning one off doesn&rsquo;t stop the underlying sync — it just stops the alert.</p>
        {(
          [
            ["priceChanged", "Price changed"],
            ["outOfStock", "Out of stock"],
            ["restocked", "Restocked"],
            ["orderShipped", "Order shipped"],
            ["orderDelivered", "Order delivered"],
            ["fulfillmentFailed", "Fulfillment failed"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifications[key]}
              onChange={(e) => update("notifications", { [key]: e.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
      </section>

      <button className="btn-primary" disabled={saveState === "saving"} onClick={save}>
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save settings"}
      </button>
      {saveState === "error" && <p className="text-sm text-red-600 mt-3">{saveError}</p>}
    </div>
  );
}
