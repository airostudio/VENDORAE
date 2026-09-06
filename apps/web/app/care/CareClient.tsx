"use client";

import { useState } from "react";
import type { ProductSummary } from "@/lib/types";

const careTopics = [
  { title: "Washing", body: "Hand wash or use a gentle machine cycle in cool water with a mild, fragrance-free detergent. Avoid bleach and harsh wringing." },
  { title: "Drying", body: "Line dry out of direct sunlight where possible — sun and heat fade natural dyes and weathered fibres over time." },
  { title: "Storage", body: "Store folded in a cool, dry place away from direct sunlight. Woven and straw pieces do best with a breathable dust bag." },
  { title: "Salt & sand", body: "Rinse swimwear and woven accessories in fresh water after ocean use, and let sand dry fully before brushing it off." },
];

export default function CareClient({ products }: { products: ProductSummary[] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId);

  return (
    <div className="container-page py-14 max-w-3xl">
      <p className="eyebrow mb-3">Care Assistant</p>
      <h1 className="font-serif text-4xl mb-6">Product Care</h1>

      {products.length === 0 ? (
        <p className="text-sm text-stone-500">No products in the catalogue yet.</p>
      ) : (
        <>
          <label className="text-sm block mb-2">Choose a product you own</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="border border-stone-300 px-3 py-2 text-sm mb-10">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          {product && (
            <div className="space-y-8">
              {careTopics.map((topic) => (
                <div key={topic.title}>
                  <h2 className="font-serif text-xl mb-2">{topic.title}</h2>
                  <p className="text-sm text-stone-600 leading-relaxed">{topic.body}</p>
                </div>
              ))}
              <div className="border-t border-stone-200 pt-6">
                <p className="text-xs text-stone-500">
                  This guidance is general. For product-specific instructions and warranty terms, see the Care and Warranty tabs on the{" "}
                  {product.title} product page.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
