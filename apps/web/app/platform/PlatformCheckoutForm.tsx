"use client";

import { useState } from "react";

const inputClass = "w-full border border-stone-300 px-3 py-2 text-sm";

/**
 * POSTs to /api/platform/checkout and redirects to Stripe Checkout on success — the standard
 * Stripe Checkout redirect pattern (session URL back, full-page navigation, no Stripe.js needed).
 */
export default function PlatformCheckoutForm() {
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
        body: JSON.stringify({ storeName, email }),
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
    <form onSubmit={handleSubmit} className="max-w-sm mx-auto text-left">
      <label className="block mb-4">
        <span className="block text-sm font-medium mb-1">Store name</span>
        <input
          className={inputClass}
          value={storeName}
          onChange={(event) => setStoreName(event.target.value)}
          placeholder="Acme Goods"
          required
          maxLength={200}
        />
        <span className="block text-xs text-stone-500 mt-1">This becomes your store&rsquo;s subdomain — you can change the display name later.</span>
      </label>
      <label className="block mb-6">
        <span className="block text-sm font-medium mb-1">Email</span>
        <input
          type="email"
          className={inputClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
      </label>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Starting checkout…" : "Continue to payment"}
      </button>
    </form>
  );
}
