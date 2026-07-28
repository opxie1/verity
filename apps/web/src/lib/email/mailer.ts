import 'server-only';
import { isProduction, serverEnv } from '../env';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends one transactional email.
 *
 * With no `RESEND_API_KEY` configured the message is written to the server log
 * instead of being delivered, so local development needs no email account. The
 * environment schema refuses to start in production without a key, so this
 * fallback cannot silently swallow a real approver notification.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (!serverEnv.RESEND_API_KEY) {
    if (isProduction && serverEnv.DEMO_MODE !== 'true') {
      throw new Error('Refusing to log an email instead of sending it in production.');
    }
    console.info(
      [
        '',
        '─── verity: outbound email (not sent — no RESEND_API_KEY) ───',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '─────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serverEnv.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: serverEnv.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    // The provider's own reason is included because without it a delivery
    // failure is indistinguishable from a misconfigured key, and the most
    // common cause — a test sender that may only write to its own account's
    // address — is invisible otherwise. This is a server log, not a response.
    const reason = await response.text().catch(() => '');
    throw new Error(
      `Email delivery failed with status ${response.status}: ${reason.slice(0, 400)}`,
    );
  }
}
