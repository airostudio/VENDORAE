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

const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const LIVE_BASE_URL = "https://api-m.paypal.com";

function mapStatus(status: string): PaymentStatus {
  switch (status) {
    case "COMPLETED":
      return "succeeded";
    case "APPROVED":
      return "requires_action"; // approved by the payer, still needs a capture call
    case "PAYER_ACTION_REQUIRED":
      return "requires_action";
    case "VOIDED":
      return "failed";
    default:
      return "processing";
  }
}

/**
 * Adapter around PayPal's REST Orders API (v2), following the same shape as StripePaymentProvider
 * so the checkout flow can treat either as a PaymentProvider. Sandbox vs live is selected by the
 * `mode` constructor argument, which mirrors tenant_settings.paypal_mode (see
 * apps/web/lib/config/paymentCredentials.ts) — a wizard-saved "sandbox" store never accidentally
 * hits PayPal's live API.
 *
 * NOTE: this adapter implements the PaymentProvider interface (order create/capture/refund/status)
 * against a real, documented PayPal API shape, but is not yet wired into the checkout page's UI —
 * see apps/web/app/checkout/page.tsx and the TODO in apps/web/app/api/admin/payments/route.ts.
 * Only Stripe is live in checkout today; this exists so PayPal credentials collected by the setup
 * wizard have a real implementation to eventually call, not a stub.
 */
export class PayPalPaymentProvider implements PaymentProvider {
  id = "paypal";
  displayName = "PayPal";
  supportedMethods = ["paypal"];

  private readonly baseUrl: string;
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    mode: "sandbox" | "live" = "sandbox",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = mode === "live" ? LIVE_BASE_URL : SANDBOX_BASE_URL;
  }

  /** OAuth2 client-credentials token, cached until shortly before it expires. */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.token;

    // btoa rather than Buffer: this package has no Node types dependency and runs equally in
    // Node and edge/browser-like runtimes (see other adapters' use of the global fetch).
    const basicAuth = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`PayPal rejected the OAuth request (${response.status}): ${body || response.statusText}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    // Refresh a minute early so a request never races an about-to-expire token.
    this.accessToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.accessToken.token;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`PayPal request to ${path} failed (${response.status}): ${body || response.statusText}`);
    }
    return (await response.json()) as T;
  }

  /** PayPal has no separate "intent" step — creating an order is the intent. */
  async createPaymentIntent(data: PaymentRequest): Promise<PaymentIntent> {
    const order = await this.request<{ id: string; status: string }>("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: data.orderId,
            amount: { currency_code: data.amount.currency, value: (data.amount.amount / 100).toFixed(2) },
          },
        ],
      }),
    });
    return { id: order.id, provider: this.id, status: mapStatus(order.status) };
  }

  /** The buyer approves the order in PayPal's UI (not here); this authorizes/captures once they have. */
  async authorize(data: PaymentAuthorizationRequest): Promise<PaymentResult> {
    return this.capture(data.paymentIntentId);
  }

  async capture(paymentId: string): Promise<PaymentResult> {
    const result = await this.request<{ id: string; status: string }>(`/v2/checkout/orders/${paymentId}/capture`, {
      method: "POST",
    });
    return { id: result.id, status: mapStatus(result.status), raw: result };
  }

  async refund(paymentId: string, amount?: Money): Promise<RefundResult> {
    // paymentId here is expected to be the capture id (from the capture() response), per PayPal's API.
    const result = await this.request<{ id: string; status: string; amount?: { currency_code: string; value: string } }>(
      `/v2/payments/captures/${paymentId}/refund`,
      { method: "POST", body: JSON.stringify(amount ? { amount: { currency_code: amount.currency, value: (amount.amount / 100).toFixed(2) } } : {}) },
    );
    return {
      id: result.id,
      amount: result.amount
        ? { amount: Math.round(parseFloat(result.amount.value) * 100), currency: result.amount.currency_code }
        : (amount ?? { amount: 0, currency: "USD" }),
      status: result.status === "COMPLETED" ? "refunded" : "processing",
    };
  }

  async getStatus(paymentId: string): Promise<PaymentStatus> {
    const order = await this.request<{ status: string }>(`/v2/checkout/orders/${paymentId}`, { method: "GET" });
    return mapStatus(order.status);
  }
}
