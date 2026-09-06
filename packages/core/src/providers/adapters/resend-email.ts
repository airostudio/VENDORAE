import type { EmailProvider } from "../email";
import type { TransactionalEmail } from "../../types";

/** Minimal HTML per known template — good enough for a transactional receipt, not a design system. */
function renderBody(email: TransactionalEmail): { subject: string; html: string } {
  const data = email.data as Record<string, unknown>;
  switch (email.templateKey) {
    case "order-confirmation": {
      const items = Array.isArray(data.items) ? (data.items as Array<{ name: string; quantity: number }>) : [];
      const rows = items.map((item) => `<li>${item.quantity} × ${item.name}</li>`).join("");
      return {
        subject: email.subject ?? "Your Beach Footprints order is confirmed",
        html: `<p>Thanks for your order! We've received your payment for order <strong>${data.orderId}</strong>.</p>${rows ? `<ul>${rows}</ul>` : ""}<p>Total: ${data.total}</p><p>We'll email you again once it ships.</p>`,
      };
    }
    case "order-shipped": {
      const trackingUrl = typeof data.trackingUrl === "string" ? data.trackingUrl : undefined;
      const tracking = trackingUrl
        ? `<a href="${trackingUrl}">${data.trackingNumber}</a>`
        : String(data.trackingNumber ?? "");
      return {
        subject: email.subject ?? "Your Beach Footprints order has shipped",
        html: `<p>Your order <strong>${data.orderId}</strong> has shipped via ${data.carrier}.</p><p>Tracking: ${tracking}</p>`,
      };
    }
    default:
      return { subject: email.subject ?? email.templateKey, html: `<pre>${JSON.stringify(data, null, 2)}</pre>` };
  }
}

/**
 * Resend adapter, talking to its REST API directly (no SDK dependency — Resend's API is a single
 * POST). Constructed with the deployment's API key and default From address so this stays
 * injectable/testable like the other adapters, rather than reading env vars itself.
 */
export class ResendEmailProvider implements EmailProvider {
  id = "resend";
  displayName = "Resend";

  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendTransactionalEmail(email: TransactionalEmail): Promise<{ id: string }> {
    const { subject, html } = renderBody(email);
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: email.fromOverride ?? this.defaultFrom,
        to: email.to,
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend rejected email (${response.status}): ${body || response.statusText}`);
    }
    const result = (await response.json()) as { id: string };
    return { id: result.id };
  }
}
