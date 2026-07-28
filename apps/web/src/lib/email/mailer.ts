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
    if (isProduction) {
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
    // The body may echo the recipient address, so it is not included here.
    throw new Error(`Email delivery failed with status ${response.status}`);
  }
}
