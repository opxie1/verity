import { getOrganization, requirePermission } from '@verity/domain';
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';
import { OrganizationSettingsForm } from './organization-settings-form';
import { PolicySettingsForm } from './policy-settings-form';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireSessionUser();
  const { slug } = await params;
  const membership = await membershipForSlug(user, slug);

  try {
    requirePermission(membership, 'org:policy:update');
  } catch {
    notFound();
  }

  const organization = await getOrganization(membership);
  const policy = organization.policy;
  if (!policy) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization details and the approval policy applied to new requests."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardBody>
            <OrganizationSettingsForm
              organizationId={organization.id}
              name={organization.name}
              domain={organization.domain}
            />
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Approval policy</CardTitle>
          </CardHeader>
          <CardBody>
            <PolicySettingsForm
              organizationId={organization.id}
              policy={{
                allowSelfApproval: policy.allowSelfApproval,
                defaultExpirationMinutes: policy.defaultExpirationMinutes,
                maximumExpirationMinutes: policy.maximumExpirationMinutes,
                requirePasskeyEnrollment: policy.requirePasskeyEnrollment,
                verificationRecommendedThresholdMinor:
                  policy.verificationRecommendedThresholdMinor === null
                    ? null
                    : Number(policy.verificationRecommendedThresholdMinor),
                currency: policy.currency,
              }}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
