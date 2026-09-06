import Image from "next/image";
import Link from "next/link";

export default function CategoryCard({ href, name, imageUrl }: { href: string; name: string; imageUrl?: string }) {
  return (
    <Link href={href} className="group relative block aspect-[3/4] overflow-hidden bg-ink-900">
      {/* No image means the newest product in this category has no media yet. The card keeps its
          dark ground rather than borrowing a stock photo, which would show the customer something
          that isn't from this catalogue. */}
      {imageUrl && (
        <Image
          src={imageUrl}
          alt={name}
          fill
          sizes="(min-width: 1024px) 33vw, 50vw"
          className="object-cover opacity-90 transition-transform duration-700 ease-premium group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/70 via-transparent to-transparent" />
      <div className="absolute bottom-6 left-6 right-6">
        <p className="text-warm-50 font-serif text-2xl">{name}</p>
        <span className="text-xs tracking-widest2 uppercase text-stone-200 mt-2 inline-block border-b border-stone-200/60 group-hover:border-warm-50 transition-colors">
          Shop Now
        </span>
      </div>
    </Link>
  );
}
