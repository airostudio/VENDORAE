import type {
  Money,
  PaymentAuthorizationRequest,
  PaymentIntent,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
  RefundResult,
} from "../types";

/**
 * A payment processor adapter. The storefront and checkout flow depend only
 * on this interface, never on a concrete provider, so gateways can be swapped
 * or run side-by-side (e.g. per region) via configuration.
 */
export interface PaymentProvider {
  id: string;
  displayName: string;
  supportedMethods: string[]; // e.g. ["card", "apple_pay", "ach"]

  createPaymentIntent(data: PaymentRequest): Promise<PaymentIntent>;
  authorize(data: PaymentAuthorizationRequest): Promise<PaymentResult>;
  capture(paymentId: string): Promise<PaymentResult>;
  refund(paymentId: string, amount?: Money): Promise<RefundResult>;
  getStatus(paymentId: string): Promise<PaymentStatus>;
}

export class PaymentProviderRegistry {
  private providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): PaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown payment provider: ${id}`);
    return provider;
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
