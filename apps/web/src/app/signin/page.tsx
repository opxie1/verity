import { Card, CardBody } from '@verity/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Auth.js reports failures as a code in the query string. A generic "try
 * again" is useless for the ones that will never succeed on retry — a refused
 * send or a missing setting — so those say what to go and look at instead.
 */
const ERROR_MESSAGES: Record<string, string> = {
  Verification: 'That sign-in link has already been used or has expired. Request a new one.',
  OAuthAccountNotLinked:
    'An account already exists with that email address. Sign in with the email link instead.',
  AccessDenied: 'That account is not allowed to sign in.',
  EmailSignin:
    'The sign-in link could not be sent. The email provider refused it — check the server logs for the reason. A test sender can usually only deliver to the address that owns the email account.',
  Configuration:
    'Sign-in is not configured correctly on the server. Check the server logs; the startup check names any missing setting.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const user = await getSessionUser();
  if (user) {
    redirect('/');
  }

  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? 'Sign in did not complete. Try again.')
    : undefined;

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <div className="w-full">
        <div className="mb-8">
          <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Verity confirms that a named, authorized person approved an exact action, so an email,
            a phone call or a video call is never the last word on a payment.
          </p>
        </div>

        <Card>
          <CardBody>
            <SignInForm errorMessage={errorMessage} />
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
