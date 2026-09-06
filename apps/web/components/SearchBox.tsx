"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A plain GET form to /search?q= — works without JS; the router.push on submit just avoids a full page reload when JS is available. */
export default function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <form action="/search" method="get" onSubmit={onSubmit} className="flex gap-2 max-w-md" role="search">
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products…"
        className="flex-1 border border-stone-300 px-3 py-2 text-sm"
        aria-label="Search products"
      />
      <button type="submit" className="btn-secondary">
        Search
      </button>
    </form>
  );
}
