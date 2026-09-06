import { getAllProductsForAdmin } from "@/lib/data/products";
import { getDashboardKpis } from "@/lib/data/admin";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [kpis, products] = await Promise.all([getDashboardKpis(), getAllProductsForAdmin()]);

  const kpiCards = [
    { label: "Revenue (30d)", value: formatMoney(kpis.revenueCents30d, kpis.currency) },
    { label: "Orders (30d)", value: String(kpis.orders30d) },
    { label: "Average Order Value", value: formatMoney(kpis.avgOrderValueCents, kpis.currency) },
    { label: "Pending Orders", value: String(kpis.pendingOrders) },
    { label: "Production Orders", value: String(kpis.fulfillingOrders) },
    { label: "Low Stock Items", value: String(kpis.lowStockItems) },
  ];

  return (
    <div>
      <h1 className="font-serif text-3xl mb-8">Dashboard</h1>
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {kpiCards.map((k) => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-stone-500">{k.label}</p>
            <p className="text-xl font-medium mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      <h2 className="font-serif text-2xl mb-4">Products</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="py-2">Product</th>
            <th className="py-2">Type</th>
            <th className="py-2">Price</th>
            <th className="py-2">Rating</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b border-stone-100">
              <td className="py-2">{p.title}</td>
              <td className="py-2 text-stone-500">{p.productType}</td>
              <td className="py-2">{formatMoney(p.priceCents, p.currency)}</td>
              <td className="py-2">{p.rating ? p.rating.toFixed(1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
