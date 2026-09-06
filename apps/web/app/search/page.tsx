import type { Metadata } from "next";
import ShopGrid from "@/components/ShopGrid";
import SearchBox from "@/components/SearchBox";
import { searchProducts } from "@/lib/data/products";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { q?: string };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = searchParams.q?.trim();
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = searchParams.q?.trim() ?? "";
  const products = q ? await searchProducts(q) : [];

  if (q && products.length > 0) {
    return <ShopGrid products={products} title={`Results for "${q}"`} description={<SearchBox initialQuery={q} />} />;
  }

  return (
    <div className="container-page py-14">
      <div className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl mb-3">Search</h1>
        <SearchBox initialQuery={q} />
      </div>

      {q && (
        <p className="text-sm text-stone-500">
          No products matched &ldquo;{q}&rdquo;. Try a different word, or browse the{" "}
          <a href="/shop" className="underline">
            full catalogue
          </a>
          .
        </p>
      )}
    </div>
  );
}
