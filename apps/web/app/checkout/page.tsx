"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/lib/cart";

const checkoutSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  phone: z.string().optional(),
  fullName: z.string().min(2, "Enter your full name"),
  line1: z.string().min(3, "Enter your street address"),
  line2: z.string().optional(),
  city: z.string().min(1, "Enter a city"),
  region: z.string().optional(),
  postalCode: z.string().min(1, "Enter a postal code"),
  country: z.string().length(2, "Use a 2-letter country code, e.g. US"),
});

type CheckoutForm = z.infer<typeof checkoutSchema>;

const steps = ["Customer", "Delivery", "Review"] as const;

interface ResolvedCart {
  lines: Array<{
    variantId: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    lineTotalCents: number;
    purchasable: boolean;
    unavailableReason: string | null;
  }>;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

function CheckoutFlow() {
  const { lines, ready } = useCart();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled") === "1";

  const [stepIndex, setStepIndex] = useState(0);
  const [cart, setCart] = useState<ResolvedCart | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<CheckoutForm>({ resolver: zodResolver(checkoutSchema), mode: "onBlur", defaultValues: { country: "US" } });

  const price = useCallback(async () => {
    if (lines.length === 0) return;
    const res = await fetch("/api/cart/lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    if (res.ok) setCart(await res.json());
  }, [lines]);

  useEffect(() => {
    if (ready) price();
  }, [ready, price]);

  async function goNext() {
    if (stepIndex === 0 && !(await trigger(["email", "phone"]))) return;
    if (stepIndex === 1 && !(await trigger(["fullName", "line1", "city", "postalCode", "country"]))) return;
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }

  /** Hands off to Stripe. The order is created server-side first; nothing is charged here. */
  async function startPayment(values: CheckoutForm) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, country: values.country.toUpperCase(), lines }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start payment");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
      setSubmitting(false);
    }
  }

  if (ready && lines.length === 0) {
    return (
      <div className="container-page py-14 max-w-4xl text-center">
        <h1 className="font-serif text-4xl mb-4">Checkout</h1>
        <p className="text-stone-500 mb-6">Your cart is empty.</p>
        <Link href="/shop" className="btn-primary">
          Continue Shopping
        </Link>
      </div>
    );
  }

  const unavailable = cart?.lines.filter((l) => !l.purchasable) ?? [];

  return (
    <div className="container-page py-14 max-w-4xl">
      <h1 className="font-serif text-4xl mb-3">Checkout</h1>
      <p className="text-xs text-stone-500 mb-10">Guest checkout — no account required.</p>

      {canceled && (
        <div className="border border-stone-300 bg-stone-50 px-4 py-3 mb-6 text-sm">
          Payment was cancelled — nothing has been charged. Your cart is still here whenever you&rsquo;re ready.
        </div>
      )}

      <div className="flex gap-2 mb-10">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`text-xs tracking-widest2 uppercase px-3 py-1.5 border ${i === stepIndex ? "border-ink-950 bg-ink-950 text-warm-50" : "border-stone-300 text-stone-500"}`}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>

      <form onSubmit={handleSubmit(startPayment)}>
        {stepIndex === 0 && (
          <div className="space-y-4 max-w-md">
            <div>
              <label className="text-sm block mb-1">Email</label>
              <input {...register("email")} className="w-full border border-stone-300 px-3 py-2 text-sm" />
              {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="text-sm block mb-1">Phone (optional)</label>
              <input {...register("phone")} className="w-full border border-stone-300 px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="space-y-4 max-w-md">
            {[
              { name: "fullName" as const, label: "Full name" },
              { name: "line1" as const, label: "Address line 1" },
              { name: "line2" as const, label: "Address line 2 (optional)" },
              { name: "city" as const, label: "City" },
              { name: "region" as const, label: "State / Region (optional)" },
              { name: "postalCode" as const, label: "Postal code" },
              { name: "country" as const, label: "Country (2-letter code, e.g. US)" },
            ].map((f) => (
              <div key={f.name}>
                <label className="text-sm block mb-1">{f.label}</label>
                <input {...register(f.name)} className="w-full border border-stone-300 px-3 py-2 text-sm" />
                {errors[f.name] && <p className="text-xs text-red-600 mt-1">{errors[f.name]?.message}</p>}
              </div>
            ))}
            <p className="text-xs text-stone-500">Estimated delivery: 5–12 business days via Standard Shipping.</p>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="max-w-md">
            <ul className="text-sm border-t border-stone-200 divide-y divide-stone-100">
              {(cart?.lines ?? []).map((l) => (
                <li key={l.variantId} className="flex justify-between py-2">
                  <span>
                    {l.title}
                    {l.variantTitle ? ` — ${l.variantTitle}` : ""} × {l.quantity}
                  </span>
                  <span>{formatMoney(l.lineTotalCents, cart?.currency ?? "USD")}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 text-sm border-b border-stone-200 py-4">
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
              <div className="flex justify-between font-medium pt-2">
                <dt>Total</dt>
                <dd>{formatMoney(cart?.totalCents ?? 0, cart?.currency ?? "USD")}</dd>
              </div>
            </dl>

            {unavailable.length > 0 && (
              <p className="text-sm text-red-600 mt-4">
                Some items are no longer available: {unavailable.map((l) => l.title).join(", ")}.{" "}
                <Link href="/cart" className="underline">
                  Update your cart
                </Link>
                .
              </p>
            )}

            <p className="text-xs text-stone-500 mt-4">
              You&rsquo;ll be taken to Stripe&rsquo;s secure payment page to enter your card details. Beach Footprints
              never sees or stores your card number.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-6">{error}</p>}

        <div className="flex gap-3 mt-10">
          {stepIndex > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setStepIndex((i) => i - 1)} disabled={submitting}>
              Back
            </button>
          )}
          {stepIndex < steps.length - 1 ? (
            <button type="button" className="btn-primary" onClick={goNext}>
              Continue
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={submitting || unavailable.length > 0 || !cart}>
              {submitting ? "Redirecting to payment…" : `Pay ${formatMoney(cart?.totalCents ?? 0, cart?.currency ?? "USD")}`}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="container-page py-14 max-w-4xl text-sm text-stone-500">Loading checkout…</div>}>
      <CheckoutFlow />
    </Suspense>
  );
}
