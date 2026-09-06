"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { ProductSummary } from "@/lib/types";

const comparableRows: { label: string; get: (p: ProductSummary) => string }[] = [
  { label: "Price", get: (p) => formatMoney(p.priceCents, p.currency) },
  { label: "Material", get: (p) => p.material ?? "—" },
  { label: "Ready to ship", get: (p) => (p.readyToShip ? "Yes" : "Made to order") },
  { label: "Rating", get: (p) => (p.rating ? `${p.rating.toFixed(1)} ★ (${p.reviewCount})` : "—") },
];

export default function CompareClient({ products }: { products: ProductSummary[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(products.slice(0, 2).map((p) => p.id));

  const selected = products.filter((p) => selectedIds.includes(p.id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  return (
    <div className="container-page py-14">
      <h1 className="font-serif text-4xl mb-3">Compare Products</h1>
      <p className="text-stone-500 mb-8 text-sm">Select up to 3 products.</p>

      {products.length === 0 ? (
        <p className="text-sm text-stone-500">No products in the catalogue yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-10">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`text-xs px-3 py-2 border ${selectedIds.includes(p.id) ? "border-ink-950 bg-ink-950 text-warm-50" : "border-stone-300"}`}
              >
                {p.title}
              </button>
            ))}
          </div>

          {selected.length === 0 ? (
            <p className="text-sm text-stone-500">Select products above to compare.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[600px]">
                <thead>
                  <tr>
                    <th className="text-left py-3 border-b border-stone-200 w-40" />
                    {selected.map((p) => (
                      <th key={p.id} className="text-left py-3 border-b border-stone-200 px-4 font-medium">
                        {p.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparableRows.map((row) => (
                    <tr key={row.label}>
                      <td className="py-3 border-b border-stone-100 text-stone-500">{row.label}</td>
                      {selected.map((p) => (
                        <td key={p.id} className="py-3 border-b border-stone-100 px-4">
                          {row.get(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
