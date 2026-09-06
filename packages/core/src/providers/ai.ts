import type { AIRecommendation, AIRecommendationRequest } from "../types";

/**
 * Product-finder recommendation engine abstraction. The default
 * implementation must be deterministic (no external calls, no data leaves
 * the server) so the product finder works with zero configuration and
 * without transmitting sensitive answers anywhere. An LLM-backed provider
 * can be registered later and swapped in via configuration; it must only be
 * enabled where the merchant has configured explicit customer consent for
 * sending answers to a third-party AI API.
 */
export interface AIProvider {
  id: string;
  displayName: string;
  sendsDataExternally: boolean;

  recommend(request: AIRecommendationRequest): Promise<AIRecommendation[]>;
}
