import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductGallery from "@/components/ProductGallery";
import ProductTabs from "@/components/ProductTabs";
import AddToCartActions from "@/components/AddToCartActions";
import ProductCard from "@/components/ProductCard";
import ProductReviews from "@/components/ProductReviews";
import { formatMoney } from "@/lib/format";
import { getProductBySlug, getProductsBySlugs } from "@/lib/data/products";
import { getApprovedReviews } from "@/lib/data/reviews";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProductBySlug(params.slug);
  if (!product) return {};
  return {
    title: product.title,
    description: product.shortDescription,
    openGraph: { images: product.isIndexable !== false ? [product.imageUrl] : [] },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProductBySlug(params.slug);
  if (!product) notFound();

  const [compatible, related, reviews] = await Promise.all([
    getProductsBySlugs(product.compatibleAccessorySlugs),
    getProductsBySlugs(product.relatedSlugs),
    getApprovedReviews(product.id),
  ]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.shortDescription,
    sku: product.id,
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency,
      price: (product.priceCents / 100).toFixed(2),
      availability: product.readyToShip ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
    },
    ...(product.rating && {
      aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviewCount },
    }),
  };

  return (
    <div className="container-page py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="text-xs text-stone-500 mb-8 flex gap-2">
        <Link href="/shop">Shop</Link>
        <span>/</span>
        <span className="text-ink-900">{product.title}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-12">
        <ProductGallery images={product.gallery} />

        <div>
          <p className="eyebrow mb-2">{product.categoryHandles[0]}</p>
          <h1 className="font-serif text-4xl mb-3">{product.title}</h1>
          {product.rating && (
            <p className="text-sm text-stone-500 mb-4">
              {product.rating.toFixed(1)} ★ ({product.reviewCount} reviews) · SKU {product.id}
            </p>
          )}
          <p className="text-2xl font-medium mb-2">
            {formatMoney(product.priceCents, product.currency)}
            {product.compareAtCents && (
              <span className="ml-3 text-base text-stone-400 line-through">{formatMoney(product.compareAtCents, product.currency)}</span>
            )}
          </p>
          <p className="text-sm text-stone-600 leading-relaxed mb-2">{product.shortDescription}</p>
          <p className="text-xs text-stone-500">{product.readyToShip ? "Ready to ship" : "Made to order"}</p>

          <AddToCartActions priceCents={product.priceCents} currency={product.currency} variants={product.variants} />

          <ProductTabs product={product} />
        </div>
      </div>

      <ProductReviews productId={product.id} reviews={reviews} />

      {compatible.length > 0 && (
        <section className="mt-24">
          <h2 className="font-serif text-3xl mb-8">Complete the Setup</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            {compatible.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="font-serif text-3xl mb-8">You May Also Like</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
