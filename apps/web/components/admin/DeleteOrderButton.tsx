"use client";

import { useFormStatus } from "react-dom";
import { deleteOrder } from "@/app/admin/orders/actions";

function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

/**
 * Deleting an order destroys the store's own record of a sale — and for a paid one, the only
 * local trace of money that moved — so the confirmation spells out what's being lost rather than
 * asking a generic "are you sure?". It never refunds anything, which is exactly the thing an
 * admin might otherwise assume, so the paid case says so outright.
 */
export default function DeleteOrderButton({
  orderId,
  status,
  returnTo,
  className = "text-xs underline text-red-600",
}: {
  orderId: string;
  status: string;
  returnTo?: "list";
  className?: string;
}) {
  const isPaid = !["PENDING_PAYMENT", "CANCELED"].includes(status);
  const reference = orderId.slice(0, 8);

  function confirmDelete(event: React.FormEvent<HTMLFormElement>) {
    const message = isPaid
      ? `Delete order ${reference}?\n\nThis order is ${status}. Deleting it removes its items, payment record and fulfillment history from this store permanently. It does NOT refund the customer — do that in Stripe.`
      : `Delete order ${reference}?\n\nThis removes it and its items permanently. It never completed payment, so no money is involved.`;
    if (!window.confirm(message)) event.preventDefault();
  }

  return (
    <form action={deleteOrder} onSubmit={confirmDelete} className="inline">
      <input type="hidden" name="orderId" value={orderId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <SubmitButton className={className} />
    </form>
  );
}
