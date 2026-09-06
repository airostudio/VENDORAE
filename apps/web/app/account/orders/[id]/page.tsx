import Link from "next/link";

// Deliberately does NOT look up the real order by id: without a signed-in customer to check
// ownership against, doing so would let anyone who knows or guesses an order id see another
// customer's name, address and order total — an IDOR, not a feature. This stays an honest stub
// until account sign-in exists (see README "What's stubbed") and can check who's asking.
export default function OrderDetailPage() {
  return (
    <div>
      <Link href="/account/orders" className="text-xs text-stone-500 underline">
        ← Back to Orders
      </Link>
      <p className="text-sm text-stone-500 border border-stone-200 p-6 mt-4">
        Sign in to see this order&rsquo;s details and delivery status. Account sign-in isn&rsquo;t connected yet — see
        the README for what&rsquo;s still stubbed.
      </p>
    </div>
  );
}
