"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// Real lookbook photography lives in public/hero/ (see public/hero/README.md).
// Add more slides here as more photos come in.
const SLIDES = [
  { src: "/hero/beach-hero1.jpg", alt: "Woman in a white boho maxi dress walking along the shoreline at golden hour" },
  { src: "/hero/beach-hero2.jpg", alt: "White lace maxi dress hanging on a rattan peacock chair at the water's edge" },
  { src: "/hero/beach-hero3.jpg", alt: "Woman in a floral boho maxi dress sitting in a rattan peacock chair on the shoreline" },
];

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
 * Crossfading hero slideshow. Order is randomized per page load (client-side
 * only, so the server-rendered first paint stays deterministic and hydration
 * doesn't warn) — the slide list itself is fixed, just its order isn't.
 */
export default function HeroSlideshow() {
  const [order, setOrder] = useState(SLIDES);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setOrder(shuffle(SLIDES));
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
