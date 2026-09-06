import "server-only";
import { ConsoleEmailProvider, ResendEmailProvider, type EmailProvider } from "@trend/core";

let cached: EmailProvider | null = null;

/**
 * Resolves the transactional email provider for this deployment: Resend when configured, the
 * dev-only console logger otherwise — so a deployment without RESEND_API_KEY still builds and
 * completes checkout, it just doesn't send real email (same shape as the Stripe client getter).
 */
export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (apiKey && from) {
    cached = new ResendEmailProvider(apiKey, from);
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
