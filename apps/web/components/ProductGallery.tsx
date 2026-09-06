"use client";

import Image from "next/image";
import { useState } from "react";

export default function ProductGallery({ images }: { images: { url: string; alt: string }[] }) {
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // Indexing images[active] on an empty list throws and takes the product page down with it. A
  // product with no usable imagery is a normal state — nothing uploaded yet, or the only files on
  // record are http and can't be displayed — so it gets an empty frame instead.
  if (images.length === 0) {
    return (
      <div className="relative w-full aspect-[4/5] bg-stone-200 flex items-center justify-center">
        <span className="text-xs tracking-widest2 uppercase text-stone-500">No image available</span>
      </div>
    );
  }

  return (
    <div>
      <button
        className="relative w-full aspect-[4/5] bg-stone-200 overflow-hidden block"
        onClick={() => setFullscreen(true)}
        aria-label="Open fullscreen gallery"
      >
        <Image src={images[active].url} alt={images[active].alt} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" priority />
      </button>
      <div className="mt-4 grid grid-cols-4 gap-3">
        {images.map((img, i) => (
          <button
            key={img.url}
            onClick={() => setActive(i)}
            className={`relative aspect-square bg-stone-200 overflow-hidden border ${i === active ? "border-ink-950" : "border-transparent"}`}
          >
            <Image src={img.url} alt={img.alt} fill sizes="150px" className="object-cover" />
          </button>
        ))}
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-[90] bg-ink-950/95 flex items-center justify-center p-6" onClick={() => setFullscreen(false)}>
          <div className="relative w-full max-w-3xl aspect-[4/5]">
            <Image src={images[active].url} alt={images[active].alt} fill sizes="100vw" className="object-contain" />
          </div>
          <button className="absolute top-6 right-6 text-warm-50 text-sm tracking-widest2 uppercase">Close</button>
        </div>
      )}
    </div>
  );
}
