"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export interface HeroSlide {
  src: string;
  alt: string;
}

// Shown only if the tenant somehow has zero hero banner rows and their image URLs are all
// missing — should be unreachable once supabase/seed.sql's placeholder rows exist, but this is
// the last-resort fallback so the section never renders blank or throws.
const FALLBACK_SLIDE: HeroSlide = {
  src: "https://placehold.co/1600x900/1a1a1a/ffffff?text=Your+Store+Banner",
  alt: "Placeholder store banner",
};

const HOLD_MS = 6000;
const FADE_MS = 2000;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Crossfading hero slideshow. Slides come from the database (see lib/data/cms.ts) via the parent
 * server component — this component just animates whatever list it's given. Order is randomized
 * per page load (client-side only, so the server-rendered first paint stays deterministic and
 * hydration doesn't warn) — the slide list itself is fixed, just its order isn't.
 */
export default function HeroSlideshow({ slides }: { slides: HeroSlide[] }) {
  const baseSlides = slides.length > 0 ? slides : [FALLBACK_SLIDE];
  const [order, setOrder] = useState(baseSlides);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setOrder(shuffle(baseSlides));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % order.length);
    }, HOLD_MS);
    return () => clearInterval(timer);
  }, [order.length]);

  return (
    <div className="absolute inset-0">
      {order.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          fill
          priority={i === 0}
          sizes="100vw"
          className="object-cover transition-opacity ease-in-out"
          style={{ transitionDuration: `${FADE_MS}ms`, opacity: i === activeIndex ? 1 : 0 }}
        />
      ))}
    </div>
  );
}
