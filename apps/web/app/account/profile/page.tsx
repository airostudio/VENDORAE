export default function ProfilePage() {
  return (
    <form className="max-w-md space-y-4 text-sm">
      <div>
        <label className="block mb-1">Full name</label>
        <input className="w-full border border-stone-300 px-3 py-2" />
      </div>
      <div>
        <label className="block mb-1">Email</label>
        <input className="w-full border border-stone-300 px-3 py-2" />
      </div>
      <div>
        <label className="block mb-1">Phone</label>
        <input className="w-full border border-stone-300 px-3 py-2" />
      </div>
      <button type="button" className="btn-primary">
        Save Changes
      </button>
    </form>
  );
}
