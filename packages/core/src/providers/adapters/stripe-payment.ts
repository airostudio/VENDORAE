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

export interface StripeClientLike {
  paymentIntents: {
    create(params: Record<string, unknown>): Promise<{ id: string; client_secret: string | null; status: string }>;
    confirm(id: string, params: Record<string, unknown>): Promise<{ id: string; status: string }>;
    capture(id: string): Promise<{ id: string; status: string }>;
    retrieve(id: string): Promise<{ id: string; status: string }>;
  };
  refunds: {
    create(params: Record<string, unknown>): Promise<{ id: string; amount: number; currency: string; status: string }>;
  };
}

function mapStatus(status: string): PaymentStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return "requires_action";
    case "processing":
      return "processing";
    case "canceled":
      return "failed";
    default:
      return "processing";
  }
}

/**
 * Adapter around the Stripe SDK. Only card-not-present tokenized flows are
 * used — this adapter never sees or stores raw card numbers. Enable only
 * once the merchant has an approved Stripe account permitting the products
 * being sold; do not attempt to route restricted goods through a processor
 * that disallows them.
 */
export class StripePaymentProvider implements PaymentProvider {
  id = "stripe";
  displayName = "Stripe";
  supportedMethods = ["card", "apple_pay", "google_pay"];

  constructor(
    private readonly client: StripeClientLike,
    private readonly statementDescriptor?: string,
  ) {}

  async createPaymentIntent(data: PaymentRequest): Promise<PaymentIntent> {
    const intent = await this.client.paymentIntents.create({
      amount: data.amount.amount,
      currency: data.amount.currency.toLowerCase(),
      receipt_email: data.customerEmail,
      statement_descriptor_suffix: data.descriptor ?? this.statementDescriptor,
      metadata: { orderId: data.orderId, ...data.metadata },
      automatic_payment_methods: { enabled: true },
    });
    return {
      id: intent.id,
      provider: this.id,
      clientSecret: intent.client_secret ?? undefined,
      status: mapStatus(intent.status),
    };
  }

  async authorize(data: PaymentAuthorizationRequest): Promise<PaymentResult> {
    const intent = await this.client.paymentIntents.confirm(data.paymentIntentId, {
      payment_method: data.paymentMethodToken,
    });
    return { id: intent.id, status: mapStatus(intent.status), raw: intent };
  }

  async capture(paymentId: string): Promise<PaymentResult> {
    const intent = await this.client.paymentIntents.capture(paymentId);
    return { id: intent.id, status: mapStatus(intent.status), raw: intent };
  }

  async refund(paymentId: string, amount?: Money): Promise<RefundResult> {
    const refund = await this.client.refunds.create({
      payment_intent: paymentId,
      amount: amount?.amount,
    });
    return {
      id: refund.id,
      amount: { amount: refund.amount, currency: refund.currency.toUpperCase() },
      status: refund.status === "succeeded" ? "refunded" : "processing",
    };
  }

  async getStatus(paymentId: string): Promise<PaymentStatus> {
    const intent = await this.client.paymentIntents.retrieve(paymentId);
    return mapStatus(intent.status);
  }
}
