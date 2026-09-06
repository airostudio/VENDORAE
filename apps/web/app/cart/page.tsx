"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/lib/cart";

interface ResolvedLine {
  variantId: string;
  handle: string;
  title: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  currency: string;
  purchasable: boolean;
  unavailableReason: string | null;
}

interface ResolvedCart {
  lines: ResolvedLine[];
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export default function CartPage() {
  const { lines, setQuantity, remove, ready } = useCart();
  const [cart, setCart] = useState<ResolvedCart | null>(null);
  const [loading, setLoading] = useState(true);

  // Prices always come from the server, so a stale or edited localStorage cart can never
  // show (or charge) the wrong amount.
  const price = useCallback(async () => {
    if (lines.length === 0) {
      setCart(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cart/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      setCart(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [lines]);

  useEffect(() => {
    if (ready) price();
  }, [ready, price]);

  const items = cart?.lines ?? [];

  return (
    <div className="container-page py-14">
      <h1 className="font-serif text-4xl mb-10">Shopping Cart</h1>

      {ready && lines.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-stone-500 mb-6">Your cart is empty.</p>
          <Link href="/shop" className="btn-primary">
            Continue Shopping
          </Link>
        </div>
      ) : loading && !cart ? (
        <p className="text-sm text-stone-500">Loading your cart…</p>
      ) : (
        <div className="grid lg:grid-cols-[1fr_360px] gap-12">
          <div className="divide-y divide-stone-200 border-t border-b border-stone-200">
            {items.map((line) => (
              <div key={line.variantId} className="flex gap-4 py-6">
                <div className="relative w-24 h-28 bg-stone-200 shrink-0">
                  {line.imageUrl && <Image src={line.imageUrl} alt={line.title} fill sizes="100px" className="object-cover" />}
                </div>
                <div className="flex-1">
                  <Link href={`/product/${line.handle}`} className="font-medium hover:underline">
                    {line.title}
                  </Link>
                  {line.variantTitle && <p className="text-sm text-stone-500">{line.variantTitle}</p>}
                  {!line.purchasable && <p className="text-sm text-red-600 mt-1">{line.unavailableReason}</p>}
                  <div className="flex items-center gap-4 mt-3">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => setQuantity(line.variantId, Math.max(1, Number(e.target.value)))}
                      className="w-20 border border-stone-300 px-3 py-1.5 text-sm"
                    />
                    <button onClick={() => remove(line.variantId)} className="text-xs underline text-stone-500">
                      Remove
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatMoney(line.lineTotalCents, line.currency)}</p>
                  {line.quantity > 1 && (
                    <p className="text-xs text-stone-500">{formatMoney(line.unitPriceCents, line.currency)} each</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <aside className="h-fit border border-stone-200 p-6">
            <h2 className="font-serif text-xl mb-4">Summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-500">Subtotal</dt>
                <dd>{formatMoney(cart?.subtotalCents ?? 0, cart?.currency ?? "USD")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Shipping</dt>
                <dd>{cart?.shippingCents ? formatMoney(cart.shippingCents, cart.currency) : "Free"}</dd>
              </div>
              {cart && cart.taxCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-stone-500">Tax</dt>
                  <dd>{formatMoney(cart.taxCents, cart.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-stone-200 pt-2 mt-2 font-medium">
                <dt>Total</dt>
                <dd>{formatMoney(cart?.totalCents ?? 0, cart?.currency ?? "USD")}</dd>
              </div>
            </dl>

            {items.some((l) => !l.purchasable) ? (
              <p className="text-sm text-red-600 mt-6">Remove the unavailable items above to continue.</p>
            ) : (
              <Link href="/checkout" className="btn-primary w-full text-center block mt-6">
                Checkout
              </Link>
            )}
            <Link href="/shop" className="text-xs underline text-stone-500 mt-4 inline-block">
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
