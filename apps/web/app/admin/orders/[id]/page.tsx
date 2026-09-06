import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminOrder } from "@/lib/data/admin";
import { aliexpressOrderUrl } from "@/lib/aliexpressOrderUrl";
import { formatMoney } from "@/lib/format";
import DeleteOrderButton from "@/components/admin/DeleteOrderButton";
import PlaceAliExpressOrderButton from "@/components/admin/PlaceAliExpressOrderButton";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-stone-100 last:border-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const order = await getAdminOrder(params.id);
  if (!order) notFound();

  const address = order.shippingAddress;

  return (
    <div className="max-w-4xl">
      <Link href="/admin/orders" className="text-xs text-stone-500 underline">
        ← Back to Orders
      </Link>

      <div className="flex flex-wrap justify-between items-start gap-4 mt-4 mb-2">
        <div>
          <p className="eyebrow mb-2">Order</p>
          <h1 className="font-serif text-3xl font-mono">{order.id.slice(0, 8)}</h1>
          <p className="text-xs text-stone-500 mt-1 font-mono">{order.id}</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {order.aliexpressOrderId ? (
            <a
              href={aliexpressOrderUrl(order.aliexpressOrderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              View on AliExpress ↗
            </a>
          ) : (
            <PlaceAliExpressOrderButton orderId={order.id} />
          )}
          <DeleteOrderButton
            orderId={order.id}
            status={order.status}
            returnTo="list"
            className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
          />
        </div>
      </div>

      <p className="text-sm mb-8">
        <span className={STATUS_STYLES[order.status] ?? "text-stone-500"}>{order.status.replace(/_/g, " ")}</span>
        <span className="text-stone-400"> · </span>
        <span className="text-stone-500">{(order.fulfillmentStatus ?? "unfulfilled").replace(/_/g, " ")}</span>
        <span className="text-stone-400"> · placed {new Date(order.createdAt).toLocaleString()}</span>
      </p>

      {order.hasStockShortfall && (
        <p className="border border-amber-600 bg-amber-50 px-4 py-3 mb-6 text-xs">
          This order was paid for in full but there wasn&rsquo;t enough stock on hand at the time. Check availability
          before fulfilling it.
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <section className="card p-5">
          <h2 className="font-serif text-lg mb-3">Customer</h2>
          <dl className="text-sm">
            <Row label="Name">{order.customerName ?? "—"}</Row>
            <Row label="Email">
              {order.customerEmail ? <a href={`mailto:${order.customerEmail}`} className="underline">{order.customerEmail}</a> : "—"}
            </Row>
            <Row label="Phone">{order.customerPhone ?? "—"}</Row>
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="font-serif text-lg mb-3">Shipping to</h2>
          {address ? (
            <address className="text-sm not-italic leading-relaxed text-stone-600">
              {address.fullName && <div>{address.fullName}</div>}
              {address.line1 && <div>{address.line1}</div>}
              {address.line2 && <div>{address.line2}</div>}
              <div>{[address.city, address.region, address.postalCode].filter(Boolean).join(", ")}</div>
              {address.country && <div>{address.country}</div>}
            </address>
          ) : (
            <p className="text-sm text-stone-500">No address on file for this order.</p>
          )}
        </section>
      </div>

      <section className="card p-5 mb-8">
        <h2 className="font-serif text-lg mb-3">Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500 border-b border-stone-200">
              <th className="py-2">Item</th>
              <th className="py-2">SKU</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={`${item.sku ?? item.title}-${i}`} className="border-b border-stone-100">
                <td className="py-2">{item.title}</td>
                <td className="py-2 text-stone-500 font-mono text-xs">{item.sku ?? "—"}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatMoney(item.unitPriceCents, order.currency)}</td>
                <td className="py-2 text-right">{formatMoney(item.lineTotalCents, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="text-sm mt-4 ml-auto max-w-xs">
          <Row label="Subtotal">{formatMoney(order.subtotalCents, order.currency)}</Row>
          <Row label="Shipping">{formatMoney(order.shippingCents, order.currency)}</Row>
          {order.taxCents > 0 && <Row label="Tax">{formatMoney(order.taxCents, order.currency)}</Row>}
          {order.discountCents > 0 && <Row label="Discount">−{formatMoney(order.discountCents, order.currency)}</Row>}
          <Row label="Total">
            <span className="font-medium">{formatMoney(order.totalCents, order.currency)}</span>
          </Row>
        </dl>
      </section>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <section className="card p-5">
          <h2 className="font-serif text-lg mb-3">Fulfillment</h2>
          <dl className="text-sm">
            <Row label="AliExpress order">
              {order.aliexpressOrderId ? (
                <a
                  href={aliexpressOrderUrl(order.aliexpressOrderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-mono text-xs"
                >
                  {order.aliexpressOrderId} ↗
                </a>
              ) : (
                "Not placed"
              )}
            </Row>
            <Row label="Tracking">
              {order.trackingNumber ? <span className="font-mono text-xs">{order.trackingNumber}</span> : "—"}
            </Row>
            <Row label="Carrier">{order.carrier ?? "—"}</Row>
            <Row label="Placed">{order.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : "—"}</Row>
            <Row label="Shipped">{order.shippedAt ? new Date(order.shippedAt).toLocaleString() : "—"}</Row>
          </dl>
          {order.aliexpressOrderId && (
            <p className="text-xs text-stone-500 mt-3">
              Opens in the AliExpress account the dropship engine placed the order under — you&rsquo;ll need to be
              signed into that account to see it.
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-serif text-lg mb-3">Payments</h2>
          {order.payments.length === 0 ? (
            <p className="text-sm text-stone-500">No payment recorded yet.</p>
          ) : (
            <ul className="text-sm space-y-3">
              {order.payments.map((payment) => (
                <li key={payment.providerRef}>
                  <div className="flex justify-between gap-3">
                    <span className={payment.status === "SUCCEEDED" ? "text-green-700" : "text-stone-600"}>
                      {payment.status}
                    </span>
                    <span>{formatMoney(payment.amountCents, order.currency)}</span>
                  </div>
                  <p className="text-xs text-stone-400 font-mono break-all">
                    {payment.provider} · {payment.providerRef}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {order.events.length > 0 && (
        <section className="card p-5">
          <h2 className="font-serif text-lg mb-3">Fulfillment log</h2>
          <ul className="text-xs space-y-2">
            {order.events.map((event, i) => (
              <li key={`${event.event}-${i}`} className="flex gap-3">
                <span className="text-stone-400 whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</span>
                <span className="font-medium">{event.event.replace(/_/g, " ")}</span>
                {event.detail != null && (
                  <span className="text-stone-500 break-all">{JSON.stringify(event.detail)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
