"use client";

import { useMemo, useState } from "react";
import type { ProductSummary } from "@/lib/types";

export interface Filters {
  materials: string[];
  readyToShipOnly: boolean;
  maxPriceCents: number | null;
}

const emptyFilters: Filters = { materials: [], readyToShipOnly: false, maxPriceCents: null };

export function useFilteredProducts(products: ProductSummary[]) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  const materials = useMemo(
    () => [...new Set(products.map((p) => p.material).filter((m): m is string => Boolean(m)))],
    [products],
  );

  const filtered = products.filter((p) => {
    if (filters.materials.length && (!p.material || !filters.materials.includes(p.material))) return false;
    if (filters.readyToShipOnly && !p.readyToShip) return false;
    if (filters.maxPriceCents !== null && p.priceCents > filters.maxPriceCents) return false;
    return true;
  });

  return { filters, setFilters, materials, filtered };
}

export default function FilterSidebar({
  materials,
  filters,
  onChange,
}: {
  materials: string[];
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  return (
    <aside className="space-y-8">
      <div>
        <p className="eyebrow mb-3">Price</p>
        <input
          type="range"
          min={0}
          max={200000}
          step={5000}
          value={filters.maxPriceCents ?? 200000}
          onChange={(e) => onChange({ ...filters, maxPriceCents: Number(e.target.value) })}
          className="w-full accent-ink-950"
        />
        <p className="text-xs text-stone-500 mt-1">
          Up to {((filters.maxPriceCents ?? 200000) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
        </p>
      </div>

      {materials.length > 0 && (
        <div>
          <p className="eyebrow mb-3">Material</p>
          <div className="space-y-2">
            {materials.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.materials.includes(m)}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      materials: e.target.checked ? [...filters.materials, m] : filters.materials.filter((x) => x !== m),
                    })
                  }
                />
                {m}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="eyebrow mb-3">Availability</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.readyToShipOnly}
              onChange={(e) => onChange({ ...filters, readyToShipOnly: e.target.checked })}
            />
            Ready to ship
          </label>
        </div>
      </div>
    </aside>
  );
}
