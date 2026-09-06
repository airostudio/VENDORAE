"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart";

function SuccessContent() {
  const { clear } = useCart();
  const sessionId = useSearchParams().get("session_id");

  // The cart's job is done once Stripe has taken the payment. The order itself is confirmed
  // by the webhook, not by this page — reaching it is not proof of payment.
  useEffect(() => {
    if (sessionId) clear();
  }, [sessionId, clear]);

  return (
    <div className="container-page py-20 text-center max-w-lg">
      <h1 className="font-serif text-4xl mb-4">Thank you ✓</h1>
      <p className="text-stone-600 mb-2">Your payment went through and your order is confirmed.</p>
      <p className="text-sm text-stone-500 mb-8">
        A receipt is on its way to your email. We&rsquo;ll be in touch again as soon as your order ships.
      </p>
      <div className="flex gap-3 justify-center">
        <Link href="/shop" className="btn-primary">
          Continue Shopping
        </Link>
        <Link href="/account/orders" className="btn-secondary">
          View Orders
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="container-page py-20 text-center text-sm text-stone-500">Confirming your order…</div>}>
      <SuccessContent />
    </Suspense>
  );
}
