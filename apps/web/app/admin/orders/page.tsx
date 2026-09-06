import Link from "next/link";
import { getAdminOrders } from "@/lib/data/admin";
import { aliexpressOrderUrl } from "@/lib/aliexpressOrderUrl";
import { formatMoney } from "@/lib/format";
import DeleteOrderButton from "@/components/admin/DeleteOrderButton";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  PENDING_PAYMENT: "text-amber-700",
  PAID: "text-green-700",
  FULFILLING: "text-blue-700",
  FULFILLED: "text-green-700",
  DELIVERED: "text-green-700",
  CANCELED: "text-stone-400",
  REFUNDED: "text-stone-500",
};

export default async function AdminOrdersPage() {
  const orders = await getAdminOrders();
  const pendingPayment = orders.filter((o) => o.status === "PENDING_PAYMENT").length;
  const awaitingFulfillment = orders.filter((o) => o.status === "PAID").length;

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <h1 className="font-serif text-3xl">Orders</h1>
        {orders.length > 0 && (
          <p className="text-xs text-stone-500 text-right">
            {awaitingFulfillment > 0 && (
              <>
                <span className="font-medium text-green-700">{awaitingFulfillment} paid</span> awaiting fulfillment
                <br />
              </>
            )}
            {pendingPayment > 0 && <>{pendingPayment} started checkout but never paid</>}
          </p>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="border border-stone-200 p-8 text-center">
          <p className="text-sm text-stone-600 mb-2">No orders yet.</p>
          <p className="text-xs text-stone-500">
            Orders appear here the moment a customer starts checkout, and turn{" "}
            <span className="font-medium">Paid</span> once Stripe confirms the payment.{" "}
            <Link href="/admin/payments" className="underline">
              Check payment configuration
            </Link>
            .
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500 border-b border-stone-200">
              <th className="py-2">Order</th>
              <th className="py-2">Placed</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Items</th>
              <th className="py-2">Status</th>
              <th className="py-2">Fulfillment</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-stone-100">
                <td className="py-2 font-mono text-xs">
                  <Link href={`/admin/orders/${o.id}`} className="underline">
                    {o.id.slice(0, 8)}
                  </Link>
                  {o.hasStockShortfall && (
                    <span
                      title="Paid for more than was in stock at the time — check availability before fulfilling."
                      className="ml-1 text-amber-600"
                    >
                      ⚠
                    </span>
                  )}
                </td>
                <td className="py-2 text-stone-500">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="py-2 text-stone-500">
                  {o.customerEmail || o.customerName ? (
                    // CSS-only hover card: the whole summary already carries the customer's details,
                    // so showing them costs no extra query and no client JS.
                    <span className="group relative inline-block">
                      <span className="underline decoration-dotted cursor-default">
                        {o.customerEmail ?? o.customerName}
                      </span>
                      <span className="hidden group-hover:block absolute z-20 left-0 top-full mt-1 w-64 border border-stone-200 bg-warm-50 shadow-lg p-3 text-xs text-stone-600 font-normal normal-case">
                        <span className="block font-medium text-ink-950">{o.customerName ?? "Name not given"}</span>
                        {o.customerEmail && <span className="block break-all">{o.customerEmail}</span>}
                        {o.customerPhone && <span className="block">{o.customerPhone}</span>}
                        {o.shippingAddress && (
                          <span className="block mt-2 pt-2 border-t border-stone-100">
                            {[o.shippingAddress.line1, o.shippingAddress.line2].filter(Boolean).join(", ") && (
                              <span className="block">
                                {[o.shippingAddress.line1, o.shippingAddress.line2].filter(Boolean).join(", ")}
                              </span>
                            )}
                            <span className="block">
                              {[o.shippingAddress.city, o.shippingAddress.region, o.shippingAddress.postalCode]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                            {o.shippingAddress.country && <span className="block">{o.shippingAddress.country}</span>}
                          </span>
                        )}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 text-stone-500">{o.itemCount}</td>
                <td className={`py-2 ${STATUS_STYLES[o.status] ?? "text-stone-500"}`}>{o.status.replace(/_/g, " ")}</td>
                <td className="py-2 text-stone-500">
                  {o.trackingNumber ? (
                    <span title={o.aliexpressOrderId ?? undefined}>{o.trackingNumber}</span>
                  ) : (
                    (o.fulfillmentStatus ?? "—").replace(/_/g, " ")
                  )}
                </td>
                <td className="py-2 text-right">{formatMoney(o.totalCents, o.currency)}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {o.aliexpressOrderId && (
                    <a
                      href={aliexpressOrderUrl(o.aliexpressOrderId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline mr-3"
                      title="Open this order in AliExpress"
                    >
                      AliExpress ↗
                    </a>
                  )}
                  <DeleteOrderButton orderId={o.id} status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
