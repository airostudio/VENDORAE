// Orders are scoped to a customer (see the orders table's customer_id in supabase/schema.sql)
// and need a signed-in customer to know whose orders to query — Supabase Auth isn't wired up
// yet (see README "What's stubbed"), so this is an honest empty state rather than showing
// fabricated orders that don't belong to whoever is looking at this page.
export default function OrdersPage() {
  return (
    <p className="text-sm text-stone-500 border border-stone-200 p-6">
      Sign in to see your orders. Account sign-in isn&rsquo;t connected yet — see the README for what&rsquo;s still
      stubbed. Placed an order? Check the confirmation email from checkout, or contact support with your order
      reference.
    </p>
  );
}
