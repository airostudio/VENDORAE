"use client";

import { useState } from "react";
import type { Plan } from "@/lib/platform/plans";

const inputClass = "w-full border border-stone-300 px-3 py-2 text-sm";

/**
 * One form instance per plan card (see apps/web/app/platform/page.tsx) — POSTs to
 * /api/platform/checkout with `planSlug` alongside storeName/email, and redirects on success. For
 * a paid plan that's Stripe Checkout's hosted page; for the free plan it's straight to
 * /platform/welcome, since that plan is provisioned synchronously with no Stripe session at all —
 * either way the response shape is the same `{ url }` and this component doesn't need to know
 * which happened.
 */
export default function PlatformCheckoutForm({ plan }: { plan: Plan }) {
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, email, planSlug: plan.slug }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.url) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="text-left">
      <label className="block mb-3">
        <span className="block text-xs font-medium mb-1">Store name</span>
        <input
          className={inputClass}
          value={storeName}
          onChange={(event) => setStoreName(event.target.value)}
          placeholder="Acme Goods"
          required
          maxLength={200}
        />
      </label>
      <label className="block mb-3">
        <span className="block text-xs font-medium mb-1">Email</span>
        <input
          type="email"
          className={inputClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
      </label>
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-stone-900 text-white py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Starting…" : plan.slug === "free" ? "Start selling free" : `Choose ${plan.name}`}
      </button>
    </form>
  );
}
