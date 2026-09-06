// Shared cross-provider types. Money is always integer minor units (cents).

export interface Money {
  amount: number;
  currency: string;
}

export interface Address {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string; // ISO 3166-1 alpha-2
  phone?: string;
}

export type PaymentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded";

export interface PaymentRequest {
  orderId: string;
  amount: Money;
  customerEmail?: string;
  descriptor?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntent {
  id: string;
  provider: string;
  clientSecret?: string;
  redirectUrl?: string;
  status: PaymentStatus;
}

export interface PaymentAuthorizationRequest {
  paymentIntentId: string;
  paymentMethodToken: string;
}

export interface PaymentResult {
  id: string;
  status: PaymentStatus;
  raw?: unknown;
}

export interface RefundResult {
  id: string;
  amount: Money;
  status: PaymentStatus;
}

export interface ShippableItem {
  productId: string;
  variantId: string;
  quantity: number;
  weightGrams?: number;
  shippingClass: "standard" | "heavy" | "oversized" | "freight" | "special";
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
}

export interface ShippingRateRequest {
  destination: Address;
  items: ShippableItem[];
  subtotal: Money;
}

export interface ShippingRate {
  methodId: string;
  name: string;
  price: Money;
  etaDaysMin?: number;
  etaDaysMax?: number;
}

export interface ShipmentRequest {
  orderId: string;
  destination: Address;
  items: ShippableItem[];
  methodId: string;
}

export interface Shipment {
  id: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  status: "pending" | "in_transit" | "delivered" | "canceled";
}

export interface TransactionalEmail {
  to: string;
  templateKey: string;
  subject?: string;
  data: Record<string, unknown>;
  fromOverride?: string;
}

export interface AIProductAnswer {
  questionKey: string;
  value: string | string[] | number;
}

export interface AIRecommendationRequest {
  answers: AIProductAnswer[];
  candidateProductIds: string[];
}

export interface AIRecommendation {
  productId: string;
  score: number;
  reasons: string[];
}
