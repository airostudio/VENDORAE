import type { EmailProvider } from "../email";
import type { TransactionalEmail } from "../../types";

/** Dev-only email provider that logs instead of sending. Swap for a Resend/Postmark adapter in production. */
export class ConsoleEmailProvider implements EmailProvider {
  id = "console";
  displayName = "Console (dev only)";

  async sendTransactionalEmail(email: TransactionalEmail): Promise<{ id: string }> {
    // eslint-disable-next-line no-console
    console.log(`[email:${email.templateKey}] -> ${email.to}`, email.data);
    return { id: `email_${Math.random().toString(36).slice(2, 12)}` };
  }
}
