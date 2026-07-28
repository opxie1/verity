import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@verity/database';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { isProduction, serverEnv } from './env';
import { sendMagicLinkEmail } from './email/templates';

/**
 * Account authentication (PRD FR-001).
 *
 * This establishes *who is signed in*. It never establishes that someone
 * approved anything: every decision additionally requires a WebAuthn assertion
 * from a registered passkey, which is what makes a stolen session or a
 * compromised mailbox insufficient (PRD 18.2, 18.6).
 */

const providers: NextAuthConfig['providers'] = [
  Resend({
    // Delivery is handled by our own mailer, which routes through Resend in
    // production and to the server log in development. The provider's own key
    // is therefore unused, but the field is required by its config type.
    apiKey: serverEnv.RESEND_API_KEY || 'unused-delivery-is-overridden',
    from: serverEnv.EMAIL_FROM,
    maxAge: 15 * 60,
    async sendVerificationRequest({ identifier, url }) {
      await sendMagicLinkEmail({ to: identifier, url });
    },
  }),
];

if (serverEnv.AUTH_GOOGLE_ID && serverEnv.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: serverEnv.AUTH_GOOGLE_ID,
      clientSecret: serverEnv.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),

  // Database sessions rather than JWTs: disabling a member must take effect on
  // their very next request, which a self-contained token cannot guarantee
  // (PRD FR-004).
  session: {
    strategy: 'database',
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },

  secret: serverEnv.AUTH_SECRET,
  trustHost: true,

  providers,

  pages: {
    signIn: '/signin',
    verifyRequest: '/signin/check-email',
    error: '/signin',
  },

  cookies: {
    sessionToken: {
      name: isProduction ? '__Secure-verity.session' : 'verity.session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProduction,
      },
    },
  },

  callbacks: {
    session({ session, user }) {
      // Expose the user ID so server code can look up the authoritative record.
      // Nothing here is trusted for authorization on its own.
      session.user.id = user.id;
      return session;
    },
  },

  events: {
    async signIn({ user, account, profile }) {
      // The email-link flow marks the address verified through the adapter,
      // because completing it proves control of the mailbox. Google does not:
      // it only counts when Google itself asserts the address is verified, so
      // an unverified Google account cannot start an organization.
      const googleVerified =
        account?.provider === 'google' &&
        (profile as { email_verified?: boolean } | undefined)?.email_verified === true;

      if (user.id && googleVerified) {
        await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null },
          data: { emailVerified: new Date() },
        });
      }
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
