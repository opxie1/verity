import { listOrganizationsForUser, listPasskeys } from '@verity/domain';
import { Alert, Card, CardBody, CardHeader, CardTitle, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { PasskeyManager } from './passkey-manager';

export const metadata: Metadata = { title: 'Passkeys' };

export default async function SecurityPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/signin');
  }

  const [passkeys, organizations] = await Promise.all([
    listPasskeys(user.id),
    listOrganizationsForUser(user.id),
  ]);

  const backHref = organizations[0] ? `/o/${organizations[0].slug}` : '/';

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href={backHref} className="text-sm font-semibold tracking-wide text-slate-500">
            VERITY
          </Link>
          <span className="text-sm text-slate-600">{user.displayName ?? user.email}</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader
          title="Passkeys"
          description="A passkey is what proves a decision came from you. Approving and denying requests requires one."
        />

        {passkeys.length === 0 ? (
          <Alert tone="warning" title="You cannot approve requests yet" className="mb-6">
            Register a passkey to approve or deny requests. It lives on this device or your security
            key and never leaves it.
          </Alert>
        ) : passkeys.length === 1 ? (
          <Alert tone="info" title="Register a backup passkey" className="mb-6">
            You have one passkey. If you lose that device you will need an administrator to help you
            back in. Registering a second one on another device avoids that.
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Your passkeys</CardTitle>
          </CardHeader>
          <CardBody>
            <PasskeyManager
              initialPasskeys={passkeys.map((passkey) => ({
                ...passkey,
                createdAt: passkey.createdAt.toISOString(),
                lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
              }))}
            />
          </CardBody>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>What Verity stores</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p>
              A passkey is a key pair. The private half is created by your device or security key
              and never leaves it. Verity only ever receives the public half, which is useless for
              impersonating you.
            </p>
            <p>
              Your fingerprint or face is checked by your own device. That information is never sent
              to Verity, and Verity has no way to request it. All the server learns is that your
              device confirmed it was you.
            </p>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
