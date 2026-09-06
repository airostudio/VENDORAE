"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "bf.cart.v1";

/**
 * A cart line holds only what the customer chose — a variant and a quantity. Every price is
 * resolved server-side from the database at render and again at checkout, so a tampered
 * localStorage payload can't buy a $500 item for $5.
 */
export interface CartLine {
  variantId: string;
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  add: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  /** False until localStorage has been read, so a server-rendered empty cart doesn't flash a wrong count. */
  ready: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);

function readStored(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((line): line is CartLine => {
        const l = line as CartLine;
        return typeof l?.variantId === "string" && Number.isFinite(l?.quantity) && l.quantity > 0;
      })
      .map((l) => ({ variantId: l.variantId, quantity: Math.min(99, Math.max(1, Math.floor(l.quantity))) }));
  } catch {
    // Private browsing, disabled storage, or corrupt JSON — an empty cart is the right fallback.
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(readStored());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Nothing to do if storage is unavailable; the cart still works for this page view.
    }
  }, [lines, ready]);

  const add = useCallback((variantId: string, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === variantId);
      if (existing) {
        return prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l));
      }
      return [...prev, { variantId, quantity: Math.min(99, Math.max(1, quantity)) }];
    });
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.variantId !== variantId)
        : prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(99, quantity) } : l)),
    );
  }, []);

  const remove = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(
    () => ({ lines, itemCount: lines.reduce((sum, l) => sum + l.quantity, 0), add, setQuantity, remove, clear, ready }),
    [lines, add, setQuantity, remove, clear, ready],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside a CartProvider");
  return ctx;
}
