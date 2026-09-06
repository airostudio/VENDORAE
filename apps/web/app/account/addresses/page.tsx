export default function AddressesPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-stone-500">Saved addresses</p>
        <button className="btn-secondary">Add Address</button>
      </div>
      <div className="border border-stone-200 p-6 text-sm text-stone-500">No saved addresses yet.</div>
    </div>
  );
}
