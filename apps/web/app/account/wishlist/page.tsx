"use client";

import { useState } from "react";

// Wishlists are per-customer (see wishlists/wishlist_items in supabase/schema.sql)
// and need a signed-in customer to scope the query — Supabase Auth isn't wired
// up yet (see README "What's stubbed"), so this is an honest empty state
// rather than showing someone else's — or fabricated — saved products.
export default function WishlistPage() {
  const [pinEnabled, setPinEnabled] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-stone-500">My Wishlist</p>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input type="checkbox" checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)} />
          Protect this wishlist with a PIN
        </label>
      </div>
      {pinEnabled && (
        <input type="password" maxLength={6} placeholder="Set a 4–6 digit PIN" className="mb-6 border border-stone-300 px-3 py-2 text-sm w-48" />
      )}
      <p className="text-sm text-stone-500 border border-stone-200 p-6">
        Sign in to see items you've saved. Account sign-in isn't connected yet — see the README for what's still stubbed.
      </p>
    </div>
  );
}
