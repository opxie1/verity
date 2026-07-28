import { Card, CardBody } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Check your email' };

export default function CheckEmailPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardBody>
          <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
          <p className="mt-3 text-sm text-slate-600">
            We sent you a sign-in link. It works once and expires in 15 minutes.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            If it does not arrive, check your spam folder, then{' '}
            <Link href="/signin" className="font-medium text-sky-700 underline">
              request another link
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
