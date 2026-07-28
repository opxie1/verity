import 'server-only';
import { prisma } from '@verity/database';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { isProduction, serverEnv } from './env';

/**
 * Demo mode (`DEMO_MODE=true`).
 *
 * Lets someone evaluate Verity without an email account, without an
 * invitation, and without a second person. Every visitor gets a private
 * organization containing both sides of the story, so one person can raise a
 * request as Alex, switch to Jane, and approve it with a real passkey.
 *
 * This is an authentication bypass, so it is fenced in three ways:
 *
 *   1. It does nothing unless `DEMO_MODE` is explicitly `true`.
 *   2. It can only ever sign somebody in as an account under
 *      `@demo.verity.invalid`. `.invalid` is reserved by RFC 2606 and can
 *      never be a real address, so this cannot be pointed at a real user.
 *   3. Each visitor's organization is separate, and the ordinary membership
 *      checks still apply to it — a demo visitor cannot see another visitor's
 *      requests any more than one customer can see another's.
 *
 * What it does not weaken: approving still requires a real WebAuthn assertion
 * from a passkey the visitor registers on their own device. That is the claim
 * the product makes, so faking it here would make the demo worthless.
 */

/** RFC 2606 reserved. No real mailbox can exist under it. */
export const DEMO_EMAIL_DOMAIN = 'demo.verity.invalid';

export const isDemoEnabled = serverEnv.DEMO_MODE === 'true';

export type DemoPersona = 'requester' | 'approver';

export const DEMO_PERSONAS: Record<
  DemoPersona,
  { name: string; role: 'REQUESTER' | 'ORG_ADMIN'; title: string; blurb: string }
> = {
  requester: {
    name: 'Alex Rivera',
    role: 'REQUESTER',
    title: 'Finance manager',
    blurb: 'Receives the payment request and asks for it to be confirmed.',
  },
  approver: {
    // Administrator rather than plain approver. A chief executive would be one
    // anyway, and a sandbox with no administrator would hide the audit log and
    // the member list — the parts that show the decision was recorded and not
    // merely made.
    name: 'Jane Okonkwo',
    role: 'ORG_ADMIN',
    title: 'Chief executive',
    blurb: 'The person the request claims to come from. Decides with a passkey.',
  },
};

/** Which persona a membership role corresponds to inside a sandbox. */
export function personaForRole(role: string): DemoPersona {
  return role === 'ORG_ADMIN' ? 'approver' : 'requester';
}

export function assertDemoEnabled(): void {
  if (!isDemoEnabled) {
    // Deliberately terse. In a normal deployment these routes should look like
    // they do not exist.
    throw new Error('Demo mode is not enabled.');
  }
}

export function isDemoUser(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

const SESSION_COOKIE = isProduction ? '__Secure-verity.session' : 'verity.session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Signs a demo persona in by writing the same session record the Auth.js
 * adapter would, then setting the same cookie.
 *
 * Done directly rather than through a credentials provider because Auth.js
 * credentials require JWT sessions, and switching away from database sessions
 * would cost the property that disabling a member takes effect on their next
 * request.
 */
export async function startDemoSession(userId: string): Promise<void> {
  assertDemoEnabled();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  if (!isDemoUser(user.email)) {
    throw new Error('Refusing to open a demo session for a non-demo account.');
  }

  const sessionToken = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({ data: { sessionToken, userId, expires } });

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    expires,
  });
}

/** Ends the caller's session, used when switching persona. */
export async function endCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { sessionToken: token } });
    store.delete(SESSION_COOKIE);
  }
}
