"use client";

import { useState } from "react";
import type { ProductDetail } from "@/lib/types";

export default function ProductTabs({ product }: { product: ProductDetail }) {
  const tabs = [
    { key: "description", label: "Description" },
    { key: "specs", label: "Specifications" },
    { key: "included", label: "What's Included" },
    { key: "care", label: "Care" },
    { key: "delivery", label: "Delivery" },
    { key: "warranty", label: "Warranty" },
    { key: "faq", label: "FAQ" },
  ] as const;

  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("description");

  return (
    <div className="mt-16">
      <div className="flex flex-wrap gap-6 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`pb-4 text-sm tracking-wide uppercase transition-colors ${
              active === tab.key ? "text-ink-950 border-b-2 border-ink-950" : "text-stone-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="py-8 max-w-3xl text-sm leading-relaxed text-ink-800">
        {active === "description" && <p>{product.description}</p>}

        {active === "specs" && (
          <div className="space-y-6">
            {product.specGroups.map((g) => (
              <div key={g.group}>
                <p className="eyebrow mb-2">{g.group}</p>
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  {g.items.map((item) => (
                    <div key={item.label} className="contents">
                      <dt className="text-stone-500">{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}

        {active === "included" && (
          <ul className="list-disc pl-5 space-y-1">
            {product.whatsIncluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

        {active === "care" && <p>{product.careSummary}</p>}
        {active === "delivery" && <p>{product.deliverySummary}</p>}
        {active === "warranty" && <p>{product.warrantySummary}</p>}

        {active === "faq" && (
          <div className="space-y-6">
            {product.faqs.map((f) => (
              <div key={f.q}>
                <p className="font-medium mb-1">{f.q}</p>
                <p className="text-stone-600">{f.a}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
