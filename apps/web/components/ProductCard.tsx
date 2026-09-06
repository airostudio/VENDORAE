import Image from "next/image";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { ProductSummary } from "@/lib/types";

export default function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-stone-200">
        {/* A product can legitimately have no usable image — none uploaded, or the only ones on
            file are http and can't be displayed. Passing "" to next/image errors the whole page,
            so the empty ground stands in for it. */}
        {product.imageUrl && (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt}
            fill
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="object-cover transition-transform duration-700 ease-premium group-hover:scale-105"
          />
        )}
        <div className="absolute top-3 left-3 flex gap-2">
          {product.isNew && <span className="bg-ink-950 text-warm-50 text-[10px] tracking-widest2 uppercase px-2 py-1">New</span>}
          {product.onSale && <span className="bg-accent text-ink-950 text-[10px] tracking-widest2 uppercase px-2 py-1">Sale</span>}
          {product.readyToShip && <span className="bg-warm-50 text-ink-950 text-[10px] tracking-widest2 uppercase px-2 py-1 border border-stone-300">Ready to Ship</span>}
        </div>
      </div>
      <div className="pt-4">
        <p className="text-sm text-ink-900 group-hover:text-accent-dark transition-colors">{product.title}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm font-medium">{formatMoney(product.priceCents, product.currency)}</span>
          {product.compareAtCents && (
            <span className="text-xs text-stone-500 line-through">{formatMoney(product.compareAtCents, product.currency)}</span>
          )}
        </div>
        {product.rating && (
          <p className="text-xs text-stone-500 mt-1">
            {product.rating.toFixed(1)} ★ ({product.reviewCount})
          </p>
        )}
      </div>
    </Link>
  );
}
