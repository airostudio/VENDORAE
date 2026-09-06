import Image from "next/image";
import Link from "next/link";
import CategoryCard from "@/components/CategoryCard";
import HeroSlideshow from "@/components/HeroSlideshow";
import ProductCard from "@/components/ProductCard";
import { getFeatureCategories } from "@/lib/data/categories";
import { getProductsByCategory } from "@/lib/data/products";
import { getHeroBanner } from "@/lib/data/cms";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Built from the database, not a fixed handle list, so a category added in admin — or one that
  // just got its first product — appears here without a code change.
  const [featureCategories, newArrivals, bestSellers, heroBanner] = await Promise.all([
    getFeatureCategories(),
    getProductsByCategory("new-arrivals"),
    getProductsByCategory("best-sellers"),
    getHeroBanner(),
  ]);

  return (
    <div>
      <section className="relative h-[85vh] min-h-[560px] flex items-end overflow-hidden">
        <HeroSlideshow />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-transparent" />
        <div className="container-page relative pb-16 sm:pb-24 text-warm-50">
          <p className="eyebrow text-stone-300 mb-4">Beach Footprints</p>
          <h1 className="font-serif text-5xl sm:text-7xl leading-[1.05] max-w-2xl">{heroBanner.headline}</h1>
          <p className="mt-6 max-w-lg text-stone-200 text-base leading-relaxed">{heroBanner.body}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href={heroBanner.primaryCta.href} className="btn-primary bg-warm-50 text-ink-950 hover:bg-stone-200">
              {heroBanner.primaryCta.label}
            </Link>
            {heroBanner.secondaryCta && (
              <Link href={heroBanner.secondaryCta.href} className="btn-secondary border-warm-50 text-warm-50 hover:bg-warm-50 hover:text-ink-950">
                {heroBanner.secondaryCta.label}
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="container-page py-20 sm:py-28">
        <div className="flex items-end justify-between mb-10">
          <h2 className="font-serif text-3xl">Shop by Category</h2>
          <Link href="/shop" className="btn-ghost hidden sm:inline-flex">View All</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {featureCategories.map((c) => (
            <CategoryCard key={c.handle} href={`/shop/${c.handle}`} name={c.name} imageUrl={c.imageUrl} />
          ))}
        </div>
      </section>

      <section className="container-page pb-20 sm:pb-28">
        <div className="flex items-end justify-between mb-10">
          <h2 className="font-serif text-3xl">New Arrivals</h2>
          <Link href="/shop/new-arrivals" className="btn-ghost">View All</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          {newArrivals.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="bg-ink-950 text-warm-50 py-24">
        <div className="container-page grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="eyebrow text-stone-400 mb-4">The Journal</p>
            <h2 className="font-serif text-4xl mb-6 leading-tight">Slow mornings, sun-warmed fabric, salt in the air.</h2>
            <p className="text-stone-300 leading-relaxed mb-8 max-w-md">
              Style guides, care tips and packing lists for a boho, barefoot life — read the latest from the Beach Footprints journal.
            </p>
            <Link href="/guides" className="btn-primary bg-warm-50 text-ink-950 hover:bg-stone-200">
              Read the Guides
            </Link>
          </div>
          <div className="relative aspect-[4/3] bg-ink-900">
            <Image src="https://picsum.photos/seed/beach-journal/1000/750" alt="Beach Footprints lookbook" fill className="object-cover" />
          </div>
        </div>
      </section>

      <section className="container-page py-20 sm:py-28">
        <div className="flex items-end justify-between mb-10">
          <h2 className="font-serif text-3xl">Best Sellers</h2>
          <Link href="/shop/best-sellers" className="btn-ghost">View All</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          {bestSellers.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="border-t border-stone-200 py-16">
        <div className="container-page grid sm:grid-cols-3 gap-10 text-center">
          <div>
            <p className="eyebrow mb-2">Woven by Hand</p>
            <p className="text-sm text-stone-500">Natural fibres and hand-dyed pieces across the catalogue.</p>
          </div>
          <div>
            <p className="eyebrow mb-2">Made to Wander</p>
            <p className="text-sm text-stone-500">Built for sand, salt air and long days outdoors.</p>
          </div>
          <div>
            <p className="eyebrow mb-2">Easy Returns</p>
            <p className="text-sm text-stone-500">Simple, no-hassle returns on unworn pieces.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
