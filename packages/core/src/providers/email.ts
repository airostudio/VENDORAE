import type { TransactionalEmail } from "../types";

/**
 * Transactional email adapter. Sender identity/wording is resolved by the
 * provider implementation from merchant-configured settings, never
 * hardcoded in the calling code.
 */
export interface EmailProvider {
  id: string;
  displayName: string;

  sendTransactionalEmail(email: TransactionalEmail): Promise<{ id: string }>;
}

export class EmailProviderRegistry {
  private providers = new Map<string, EmailProvider>();

  register(provider: EmailProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): EmailProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown email provider: ${id}`);
    return provider;
  }
}
