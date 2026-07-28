import { isDomainError, peekInvitation } from '@verity/domain';
import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS, invitationTokenSchema } from '@verity/schemas';
import { Alert, Card, CardBody } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '@/lib/session';
import { AcceptInvitationForm } from './accept-invitation-form';

export const metadata: Metadata = { title: 'Invitation' };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16">
      <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
      <div className="mt-6">{children}</div>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;

  const parsedToken = invitationTokenSchema.safeParse(decodeURIComponent(rawToken));
  if (!parsedToken.success) {
    return (
      <Shell>
        <Alert tone="danger" title="This invitation link is not valid">
          Ask an administrator at the organization to send you a new invitation.
        </Alert>
      </Shell>
    );
  }
  const token = parsedToken.data;

  let invitation;
  try {
    invitation = await peekInvitation(token);
  } catch (error) {
    const message = isDomainError(error)
      ? error.message
      : 'This invitation link is not valid.';
    return (
      <Shell>
        <Alert tone="danger" title="This invitation cannot be used">
          {message}
        </Alert>
      </Shell>
    );
  }

  if (invitation.status !== 'PENDING') {
    const explanation = {
      ACCEPTED: 'This invitation has already been used.',
      REVOKED: 'This invitation was revoked by an administrator.',
      EXPIRED: 'This invitation has expired.',
      PENDING: '',
    }[invitation.status];

    return (
      <Shell>
        <Alert tone="warning" title="This invitation cannot be used">
          {explanation} Ask an administrator at {invitation.organizationName} to send a new one.
        </Alert>
      </Shell>
    );
  }

  const user = await getSessionUser();

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-slate-900">
        Join {invitation.organizationName}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        You have been invited as <strong>{ORG_ROLE_LABELS[invitation.role]}</strong>.{' '}
        {ORG_ROLE_DESCRIPTIONS[invitation.role]}
      </p>

      <Card className="mt-6">
        <CardBody>
          {!user ? (
            <div className="space-y-4">
              <Alert tone="info" title={`This invitation is for ${invitation.email}`}>
                Sign in with that address to accept it. Holding the link is not enough.
              </Alert>
              <Link
                href={`/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                Sign in to continue
              </Link>
            </div>
          ) : user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
            <Alert tone="warning" title="You are signed in with a different address">
              This invitation was sent to <strong>{invitation.email}</strong>, but you are signed in
              as <strong>{user.email}</strong>. Sign out and sign in with the invited address.
            </Alert>
          ) : (
            <AcceptInvitationForm
              token={token}
              organizationName={invitation.organizationName}
              needsDisplayName={!user.displayName}
            />
          )}
        </CardBody>
      </Card>
    </Shell>
  );
}
