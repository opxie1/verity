import { listOrganizationsForUser } from '@verity/domain';
import { Alert, Card, CardBody } from '@verity/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { CreateOrganizationForm } from './create-organization-form';

export const metadata: Metadata = { title: 'Create your organization' };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/signin');
  }

  const organizations = await listOrganizationsForUser(user.id);
  if (organizations.length > 0) {
    redirect(`/o/${organizations[0]!.slug}`);
  }

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16">
      <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Create your organization</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your organization is the boundary for everything in Verity. Requests, receipts and audit
        records belong to it, and nobody outside it can see them.
      </p>

      {!user.emailVerifiedAt ? (
        <Alert tone="warning" className="mt-6" title="Verify your email address first">
          Sign in through the emailed link so we know the address belongs to you. Invitations and
          approval notices are sent by email, so an unverified address cannot start an organization.
        </Alert>
      ) : null}

      <Card className="mt-6">
        <CardBody>
          <CreateOrganizationForm
            defaultAdministratorName={user.displayName ?? ''}
            disabled={!user.emailVerifiedAt}
          />
        </CardBody>
      </Card>
    </main>
  );
}
