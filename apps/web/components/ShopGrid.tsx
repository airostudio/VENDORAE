"use client";

import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import FilterSidebar, { useFilteredProducts } from "@/components/FilterSidebar";
import type { ProductSummary } from "@/lib/types";

interface Crumb {
  label: string;
  href?: string;
}

export default function ShopGrid({
  products,
  title,
  description,
  breadcrumb,
}: {
  products: ProductSummary[];
  title: string;
  description?: React.ReactNode;
  /** Parent trail for a subcategory page, e.g. Adult Toys > Vibrators. Omit for a top-level or Shop All page. */
  breadcrumb?: Crumb[];
}) {
  const { filters, setFilters, materials, filtered } = useFilteredProducts(products);

  return (
    <div className="container-page py-14">
      <div className="mb-10 max-w-2xl">
        {breadcrumb && (
          <nav className="text-xs text-stone-500 mb-3 flex flex-wrap items-center gap-1">
            <Link href="/shop" className="hover:text-ink-950">
              Shop
            </Link>
            {breadcrumb.map((crumb) => (
              <span key={crumb.label} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-ink-950">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-ink-800">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-serif text-4xl mb-3">{title}</h1>
        {typeof description === "string" ? <p className="text-stone-500">{description}</p> : description}
      </div>
      <div className="grid lg:grid-cols-[220px_1fr] gap-10">
        <FilterSidebar materials={materials} filters={filters} onChange={setFilters} />
        <div>
          <p className="text-xs text-stone-500 mb-6">{filtered.length} products</p>
          {filtered.length === 0 ? (
            <p className="text-sm text-stone-500">No products match those filters yet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
