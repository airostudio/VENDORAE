export default function AccountOverviewPage() {
  return (
    <div className="space-y-6 text-sm">
      <p className="text-stone-500">Welcome back. From here you can manage orders, owned products, wishlists, addresses and privacy preferences.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-6">
          <p className="eyebrow mb-2">Recent Orders</p>
          <p className="text-stone-500">No orders yet.</p>
        </div>
        <div className="card p-6">
          <p className="eyebrow mb-2">Owned Products</p>
          <p className="text-stone-500">Products you've purchased appear here with care instructions and warranty info.</p>
        </div>
      </div>
    </div>
  );
}
