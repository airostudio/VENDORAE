"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DeterministicRecommendationProvider, type FinderProductFacts } from "@trend/core";
import ProductCard from "@/components/ProductCard";
import type { ProductSummary } from "@/lib/types";

const questions = [
  {
    key: "shopping_for",
    label: "What are you shopping for?",
    options: [
      { value: "standard", label: "Apparel" },
      { value: "accessory", label: "An accessory" },
      { value: "care_product", label: "A care product" },
    ],
  },
  {
    key: "price_range",
    label: "Preferred price range",
    options: [
      { value: "0-50", label: "Under $50" },
      { value: "50-100", label: "$50–$100" },
      { value: "100-250", label: "$100+" },
    ],
  },
  {
    key: "readiness",
    label: "Ready-to-ship or made to order?",
    options: [
      { value: "ready_to_ship", label: "Ready to ship" },
      { value: "made_to_order", label: "Happy to wait for something made to order" },
    ],
  },
] as const;

export default function ProductFinderClient({ products }: { products: ProductSummary[] }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<string[] | null>(null);

  const provider = useMemo(() => {
    const catalog: FinderProductFacts[] = products.map((p) => ({
      productId: p.id,
      priceCents: p.priceCents,
      category: p.productType,
      material: p.material,
      readyToShip: Boolean(p.readyToShip),
      tags: p.tags,
    }));
    return new DeterministicRecommendationProvider(catalog);
  }, [products]);

  const question = questions[step];

  async function selectAnswer(value: string) {
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    if (step < questions.length - 1) {
      setStep(step + 1);
      return;
    }
    const recs = await provider.recommend({
      answers: Object.entries(next).map(([questionKey, v]) => ({ questionKey, value: v })),
      candidateProductIds: products.map((p) => p.id),
    });
    setResults(recs.filter((r) => r.score > 0).map((r) => r.productId));
  }

  const recommended = useMemo(() => products.filter((p) => results?.includes(p.id)), [products, results]);

  return (
    <div className="container-page py-14 max-w-3xl">
      <p className="eyebrow mb-3">Product Finder</p>
      <h1 className="font-serif text-4xl mb-3">Let's find the right fit</h1>
      <p className="text-stone-500 text-sm mb-10">
        A few quick, non-invasive questions. Your answers are processed entirely on our server and are never sent to a third party.
      </p>

      {!results ? (
        <div>
          <p className="text-xs text-stone-500 mb-4">
            Question {step + 1} of {questions.length}
          </p>
          <h2 className="font-serif text-2xl mb-6">{question.label}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {question.options.map((opt) => (
              <button key={opt.value} onClick={() => selectAnswer(opt.value)} className="border border-stone-300 px-4 py-3 text-sm text-left hover:border-ink-950">
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <h2 className="font-serif text-2xl mb-6">Recommended for you</h2>
          {recommended.length === 0 ? (
            <p className="text-sm text-stone-500">
              No strong matches yet — browse the full <Link href="/shop" className="underline">catalogue</Link> instead.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-10">
              {recommended.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
          <button
            className="btn-ghost mt-8"
            onClick={() => {
              setResults(null);
              setAnswers({});
              setStep(0);
            }}
          >
            Start Over
          </button>
        </div>
      )}
    </div>
  );
}
