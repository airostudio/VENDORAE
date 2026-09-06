"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CheckoutSettingsCard from "@/components/admin/CheckoutSettingsCard";

interface PaymentsStatus {
  stripe: {
    secretKeyConfigured: boolean;
    publishableKeyConfigured: boolean;
    webhookSecretConfigured: boolean;
    mode: "live" | "test" | null;
    modeMismatch: boolean;
  };
  sellingCurrency: string | null;
  storeCurrency: string | null;
  checkoutImplemented: boolean;
}

function StatusRow({ label, ok, envVar, detail }: { label: string; ok: boolean; envVar: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-stone-100 last:border-0">
      <span className={`text-sm mt-0.5 ${ok ? "text-green-700" : "text-red-600"}`}>{ok ? "✓" : "✕"}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {label} <span className={ok ? "text-green-700" : "text-red-600"}>{ok ? "configured" : "not set"}</span>
        </p>
        <p className="text-xs text-stone-500 mt-0.5">
          <code className="bg-stone-100 px-1">{envVar}</code> — {detail}
        </p>
      </div>
    </div>
  );
}

// Two-decimal currencies only — prices are integer cents throughout, so a zero-decimal
// currency (JPY, KRW) would be charged 100x under that model.
const CURRENCIES = ["USD", "AUD", "NZD", "GBP", "EUR", "CAD", "SGD"];

export default function PaymentsSettingsPage() {
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencySavedAt, setCurrencySavedAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/payments").then((res) => res.json()),
      fetch("/api/admin/store-currency").then((res) => res.json()),
    ])
      .then(([paymentsData, currencyData]) => {
        if (paymentsData.error) return Promise.reject(new Error(paymentsData.error));
        setStatus(paymentsData);
        // The store's own setting, not the engine's — tenant_settings.base_currency defaults to
        // USD, so an unconfigured store reads as USD rather than inheriting an external default.
        setCurrency(currencyData.storeCurrency ?? "USD");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load payment settings"));
  }, []);

  /**
   * Saves the store's own selling currency, which the server then pushes to the dropship engine's
   * import target so future imports are quoted in it. An unreachable engine doesn't fail the save
   * — the local value is the source of truth — but it is reported, since imports would keep
   * arriving in the old currency until it syncs.
   */
  async function saveCurrency(next: string) {
    setCurrency(next);
    setSavingCurrency(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/store-currency", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save the currency");
      setStatus((prev) => (prev ? { ...prev, sellingCurrency: next } : prev));
      setCurrencySavedAt(new Date().toLocaleTimeString());
      if (!data.engineSynced) {
        setError(
          `Saved ${next} for this store, but the dropship engine didn't pick it up${data.engineError ? ` (${data.engineError})` : ""} — imported products will keep arriving in the old currency until it syncs.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the currency");
    } finally {
      setSavingCurrency(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!status) return <p className="text-sm text-stone-500">Checking payment configuration…</p>;

  const allSet =
    status.stripe.secretKeyConfigured && status.stripe.publishableKeyConfigured && status.stripe.webhookSecretConfigured;

  return (
    <div className="max-w-2xl">
      <p className="eyebrow mb-2">Payments</p>
      <h1 className="font-serif text-3xl mb-2">Stripe</h1>
      <p className="text-sm text-stone-600 mb-8">
        Stripe credentials are read from this deployment&rsquo;s environment variables, not stored in the database — a
        secret key in a table is one careless query away from leaking, and rotating it should be a deploy setting. This
        screen reports what is configured; set the values in Vercel → Settings → Environment Variables.
      </p>

      {!allSet ? (
        <div className="border border-amber-600 bg-amber-50 px-4 py-3 mb-6 text-sm">
          <p className="font-medium mb-1">Checkout can&rsquo;t take payments yet</p>
          <p className="text-xs text-stone-700">
            Checkout is wired to Stripe, but the credentials below are incomplete, so a customer reaching payment gets a
            &ldquo;payments are not configured&rdquo; error. Set the missing values in Vercel and redeploy.
          </p>
        </div>
      ) : (
        <div className="border border-green-700 bg-green-50 px-4 py-3 mb-6 text-sm">
          <p className="font-medium mb-1">Checkout is ready to take payments</p>
          <p className="text-xs text-stone-700">
            An order is created when a customer starts checkout and only becomes <span className="font-medium">Paid</span>{" "}
            once Stripe&rsquo;s webhook confirms the money moved. Watch them in{" "}
            <Link href="/admin/orders" className="underline">
              Orders
            </Link>
            .
          </p>
        </div>
      )}

      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-serif text-xl">Credentials</h2>
          {status.stripe.mode && (
            <span
              className={`text-xs px-2 py-1 ${status.stripe.mode === "live" ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-600"}`}
            >
              {status.stripe.mode === "live" ? "Live mode" : "Test mode"}
            </span>
          )}
        </div>

        <StatusRow
          label="Secret key"
          ok={status.stripe.secretKeyConfigured}
          envVar="STRIPE_SECRET_KEY"
          detail="server-side key used to create charges. Never expose this to the browser."
        />
        <StatusRow
          label="Publishable key"
          ok={status.stripe.publishableKeyConfigured}
          envVar="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
          detail="safe to send to the browser; used by Stripe's card fields."
        />
        <StatusRow
          label="Webhook signing secret"
          ok={status.stripe.webhookSecretConfigured}
          envVar="STRIPE_WEBHOOK_SECRET"
          detail="verifies Stripe's callbacks so an order is only marked paid on a genuine event."
        />

        {status.stripe.modeMismatch && (
          <p className="text-sm text-red-600 mt-4">
            Your secret and publishable keys are from different modes (one live, one test). Checkout will fail — use a
            matching pair.
          </p>
        )}

        {allSet && status.stripe.mode === "test" && (
          <p className="text-xs text-stone-500 mt-4">
            Test keys are in use, so no real money moves. Swap in live keys when you&rsquo;re ready to take orders.
          </p>
        )}
      </section>

      <section className="card p-6">
        <h2 className="font-serif text-xl mb-4">Currency</h2>
        <div className="flex flex-wrap items-end gap-6 mb-3">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Sell in currency</span>
            <select
              value={currency}
              onChange={(e) => saveCurrency(e.target.value)}
              disabled={savingCurrency}
              className="border border-stone-300 px-3 py-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {currency && !CURRENCIES.includes(currency) && <option value={currency}>{currency}</option>}
            </select>
          </label>
          <p className="text-xs text-stone-500 pb-2">
            {savingCurrency ? "Saving…" : currencySavedAt ? `Saved ${currencySavedAt}` : "Applied to products imported from now on."}
          </p>
        </div>
        <div className="text-sm space-y-2">
          {status.storeCurrency && (
            <p className="text-stone-600">
              Products already in the catalogue are priced in{" "}
              <span className="font-medium">{status.storeCurrency}</span>. Change one product&rsquo;s price or currency
              in its{" "}
              <Link href="/admin/products" className="underline">
                editor
              </Link>
              , or relabel the whole catalogue at once from that same screen.
            </p>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-3">
          New stores sell in USD until you change it here. Charge customers in the same currency your products are
          priced in: this setting decides what imported products are quoted in from now on — it does not re-price
          products already in the catalogue.
        </p>
        {currency && status.storeCurrency && currency !== status.storeCurrency && (
          <p className="text-sm text-amber-700 mt-3">
            Your selling currency ({currency}) differs from the currency existing products are priced in (
            {status.storeCurrency}). New imports will be priced in {currency}, leaving the catalogue mixed — and a cart
            can only be charged in one currency, so checkout refuses baskets that mix them.{" "}
            <Link href="/admin/products" className="underline">
              Fix the catalogue
            </Link>
            .
          </p>
        )}
      </section>

      <CheckoutSettingsCard />
    </div>
  );
}
