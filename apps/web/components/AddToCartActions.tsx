"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/lib/cart";
import type { ProductVariantSummary } from "@/lib/types";

export default function AddToCartActions({
  priceCents,
  currency,
  variants,
}: {
  priceCents: number;
  currency: string;
  variants: ProductVariantSummary[];
}) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [selectedId, setSelectedId] = useState(variants.find((v) => v.inStock)?.id ?? variants[0]?.id ?? "");
  const [added, setAdded] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);

  const selected = variants.find((v) => v.id === selectedId);
  const canBuy = Boolean(selected?.inStock);

  function addToCart() {
    if (!selected) return;
    add(selected.id, qty);
    setAdded(true);
  }

  return (
    <div className="mt-8 space-y-4">
      {variants.length > 1 && (
        <label className="block text-sm">
          <span className="block text-xs text-stone-500 mb-1">
            {selected?.options[0]?.name ?? "Option"}
          </span>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setAdded(false);
            }}
            className="w-full border border-stone-300 px-3 py-2 text-sm"
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.inStock}>
                {v.options.map((o) => o.value).join(" / ") || v.title || v.sku || "Standard"}
                {" — "}
                {formatMoney(v.priceCents, v.currency)}
                {v.inStock ? "" : " (out of stock)"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="qty" className="text-sm text-stone-500">
          Quantity
        </label>
        <input
          id="qty"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          className="w-20 border border-stone-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="btn-primary flex-1 min-w-[180px]" onClick={addToCart} disabled={!canBuy}>
          {!canBuy ? "Out of Stock" : added ? "Added ✓" : "Add to Cart"}
        </button>
        {added ? (
          <Link href="/cart" className="btn-secondary flex-1 min-w-[140px] text-center">
            View Cart
          </Link>
        ) : (
          <Link href="/cart" className="btn-secondary flex-1 min-w-[140px] text-center" onClick={addToCart}>
            Buy Now
          </Link>
        )}
      </div>

      <div className="flex gap-6 text-xs tracking-widest2 uppercase text-stone-500">
        <button onClick={() => setWishlisted((v) => !v)} className={wishlisted ? "text-ink-950" : ""}>
          {wishlisted ? "Wishlisted ✓" : "Add to Wishlist"}
        </button>
        <button>Compare</button>
      </div>

      <p className="text-xs text-stone-500">
        {formatMoney(selected?.priceCents ?? priceCents, selected?.currency ?? currency)} · Ships in simple, unmarked packaging.
      </p>
    </div>
  );
}
