"use client";

import Link from "next/link";
import { useState } from "react";

export interface NavCategory {
  handle: string;
  name: string;
  children?: { handle: string; name: string }[];
}

const iconLinks = [
  { label: "Search", href: "/search" },
  { label: "Wishlist", href: "/account/wishlist" },
  { label: "Account", href: "/account" },
  { label: "Cart", href: "/cart" },
];

/**
 * Category links come from the layout, which reads the categories that actually have published
 * products — so an empty category never appears in the menu, and a new one appears as soon as its
 * first product is published, without this list being edited. A category with children (e.g.
 * Adult Toys -> Vibrators) renders as a dropdown on desktop and an expandable group on mobile,
 * rather than flattening the subcategory into the top-level list or dropping it entirely.
 */
export default function Header({ categories }: { categories: NavCategory[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-40 bg-warm-50/95 backdrop-blur border-b border-stone-200">
      <div className="container-page flex h-16 items-center justify-between">
        <button
          className="lg:hidden text-sm tracking-widest2 uppercase"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label="Toggle menu"
        >
          Menu
        </button>

        <Link href="/" className="relative z-10 shrink-0 flex items-center" aria-label="Beach Footprints home">
          <span className="font-serif text-2xl tracking-wide text-ink-950">Beach Footprints</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-7">
          <Link href="/shop" className="text-sm tracking-wide text-ink-800 hover:text-ink-950 transition-colors">
            Shop
          </Link>
          {categories.map((c) => (
            <div key={c.handle} className="group relative">
              <Link href={`/shop/${c.handle}`} className="text-sm tracking-wide text-ink-800 hover:text-ink-950 transition-colors py-2">
                {c.name}
              </Link>
              {c.children && c.children.length > 0 && (
                <div className="absolute left-0 top-full hidden group-hover:block group-focus-within:block pt-1">
                  <div className="min-w-[10rem] bg-warm-50 border border-stone-200 shadow-sm py-2">
                    {c.children.map((child) => (
                      <Link
                        key={child.handle}
                        href={`/shop/${child.handle}`}
                        className="block px-4 py-1.5 text-sm text-ink-700 hover:text-ink-950 hover:bg-warm-100 whitespace-nowrap"
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <Link href="/guides" className="text-sm tracking-wide text-ink-800 hover:text-ink-950 transition-colors">
            Guides
          </Link>
        </nav>

        <div className="flex items-center gap-5">
          {iconLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden sm:inline text-xs tracking-widest2 uppercase text-ink-700 hover:text-ink-950 transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <Link href="/cart" className="sm:hidden text-xs uppercase tracking-widest2">
            Cart
          </Link>
        </div>
      </div>

      {mobileOpen && (
        <nav className="lg:hidden border-t border-stone-200 bg-warm-50">
          <div className="container-page py-4 flex flex-col gap-1">
            <Link href="/shop" className="text-sm py-2" onClick={() => setMobileOpen(false)}>
              Shop
            </Link>
            {categories.map((c) =>
              c.children && c.children.length > 0 ? (
                <div key={c.handle}>
                  <div className="flex items-center justify-between">
                    <Link href={`/shop/${c.handle}`} className="text-sm py-2 flex-1" onClick={() => setMobileOpen(false)}>
                      {c.name}
                    </Link>
                    <button
                      className="text-xs text-stone-500 px-2 py-2"
                      onClick={() => setOpenMobileGroup((cur) => (cur === c.handle ? null : c.handle))}
                      aria-expanded={openMobileGroup === c.handle}
                      aria-label={`Toggle ${c.name} subcategories`}
                    >
                      {openMobileGroup === c.handle ? "−" : "+"}
                    </button>
                  </div>
                  {openMobileGroup === c.handle && (
                    <div className="pl-4 flex flex-col gap-1 pb-1">
                      {c.children.map((child) => (
                        <Link
                          key={child.handle}
                          href={`/shop/${child.handle}`}
                          className="text-sm text-stone-600 py-1.5"
                          onClick={() => setMobileOpen(false)}
                        >
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link key={c.handle} href={`/shop/${c.handle}`} className="text-sm py-2" onClick={() => setMobileOpen(false)}>
                  {c.name}
                </Link>
              ),
            )}
            <Link href="/guides" className="text-sm py-2" onClick={() => setMobileOpen(false)}>
              Guides
            </Link>
            {iconLinks.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm py-2" onClick={() => setMobileOpen(false)}>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
