import type { AIProvider } from "../ai";
import type { AIRecommendation, AIRecommendationRequest, AIProductAnswer } from "../../types";

export interface FinderProductFacts {
  productId: string;
  priceCents: number;
  category: string; // "standard" | "accessory" | "care_product" | "bundle" | ...
  material?: string;
  readyToShip: boolean;
  tags: string[];
}

function answerValue(answers: AIProductAnswer[], key: string): string | string[] | number | undefined {
  return answers.find((a) => a.questionKey === key)?.value;
}

/**
 * Deterministic, fully local scoring engine for the product finder. No
 * customer answers ever leave the server. An LLM-backed AIProvider can be
 * registered under a different id and swapped in via config — only with
 * explicit customer consent — without changing the calling code.
 */
export class DeterministicRecommendationProvider implements AIProvider {
  id = "deterministic";
  displayName = "Deterministic Recommendations";
  sendsDataExternally = false;

  constructor(private readonly catalog: FinderProductFacts[]) {}

  async recommend(request: AIRecommendationRequest): Promise<AIRecommendation[]> {
    const { answers } = request;
    const candidates = this.catalog.filter((p) => request.candidateProductIds.includes(p.productId));

    const shoppingFor = answerValue(answers, "shopping_for");
    const priceRange = answerValue(answers, "price_range") as string | undefined;
    const materialPref = answerValue(answers, "material") as string | undefined;
    const readiness = answerValue(answers, "readiness") as string | undefined;
    const priorities = (answerValue(answers, "priorities") as string[] | undefined) ?? [];

    const [minPrice, maxPrice] = parsePriceRange(priceRange);

    const scored: AIRecommendation[] = candidates.map((p) => {
      let score = 0;
      const reasons: string[] = [];

      if (shoppingFor && p.category === shoppingFor) {
        score += 30;
        reasons.push("Matches what you're shopping for");
      }
      if (p.priceCents >= minPrice && p.priceCents <= maxPrice) {
        score += 20;
        reasons.push("Within your price range");
      }
      if (materialPref && p.material === materialPref) {
        score += 15;
        reasons.push("Preferred material");
      }
      if (readiness === "ready_to_ship" && p.readyToShip) {
        score += 15;
        reasons.push("Ready to ship");
      }
      for (const priority of priorities) {
        if (p.tags.includes(priority)) {
          score += 5;
          reasons.push(`Matches priority: ${priority}`);
        }
      }

      return { productId: p.productId, score, reasons };
    });

    return scored.sort((a, b) => b.score - a.score);
  }
}

function parsePriceRange(range?: string): [number, number] {
  if (!range) return [0, Number.MAX_SAFE_INTEGER];
  const [minStr, maxStr] = range.split("-");
  const min = Number(minStr) * 100 || 0;
  const max = maxStr ? Number(maxStr) * 100 : Number.MAX_SAFE_INTEGER;
  return [min, max];
}
