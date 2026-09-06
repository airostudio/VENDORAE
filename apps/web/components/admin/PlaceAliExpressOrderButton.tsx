"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Manual retry for supplier placement. Orders normally place themselves the moment Stripe confirms
 * payment (see the stripe webhook), so this only matters when that failed — a missing phone
 * number, an unreachable engine — and the fulfillment log on this page says which.
 */
export default function PlaceAliExpressOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function place() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/place-aliexpress`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not place this order");
      if (data.skipped) setError("Nothing to place — this order has no dropship-engine items.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place this order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button className="btn-secondary" onClick={place} disabled={busy}>
        {busy ? "Placing…" : "Place with AliExpress"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
