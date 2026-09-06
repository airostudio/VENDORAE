import type { PaymentProvider } from "../payment";
import type {
  Money,
  PaymentAuthorizationRequest,
  PaymentIntent,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
  RefundResult,
} from "../../types";

/**
 * Deterministic in-memory payment provider used for local development and
 * tests. Never use in production — it does not talk to a real processor and
 * never touches raw card data (no real implementation should either; always
 * use the provider's tokenized client SDK).
 */
export class MockPaymentProvider implements PaymentProvider {
  id = "mock";
  displayName = "Mock Payments (dev only)";
  supportedMethods = ["card"];

  private intents = new Map<string, PaymentIntent>();

  async createPaymentIntent(data: PaymentRequest): Promise<PaymentIntent> {
    const intent: PaymentIntent = {
      id: `pi_mock_${Math.random().toString(36).slice(2, 12)}`,
      provider: this.id,
      clientSecret: "mock_secret",
      status: "requires_action",
    };
    this.intents.set(intent.id, intent);
    return intent;
  }

  async authorize(data: PaymentAuthorizationRequest): Promise<PaymentResult> {
    const intent = this.intents.get(data.paymentIntentId);
    if (!intent) throw new Error("Unknown payment intent");
    intent.status = "succeeded";
    return { id: intent.id, status: "succeeded" };
  }

  async capture(paymentId: string): Promise<PaymentResult> {
    return { id: paymentId, status: "succeeded" };
  }

  async refund(paymentId: string, amount?: Money): Promise<RefundResult> {
    return {
      id: `re_mock_${Math.random().toString(36).slice(2, 12)}`,
      amount: amount ?? { amount: 0, currency: "USD" },
      status: "refunded",
    };
  }

  async getStatus(paymentId: string): Promise<PaymentStatus> {
    return this.intents.get(paymentId)?.status ?? "processing";
  }
}
