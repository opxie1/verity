import { getOrganizationPolicy, listEligibleApprovers, requirePermission } from '@verity/domain';
import type { ActionTypeValue } from '@verity/schemas';
import { Alert, Card, CardBody, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { enabledActionTypes } from '@/lib/env';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';
import { NewRequestForm } from './new-request-form';

export const metadata: Metadata = { title: 'New verification request' };

/**
 * Gmail source metadata arrives as query parameters from the extension. Only
 * these named fields are read, and the message body is never among them
 * (PRD 14.3, NFR-002).
 */
export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const { slug } = await params;
  const membership = await membershipForSlug(user, slug);

  try {
    requirePermission(membership, 'request:create');
  } catch {
    notFound();
  }

  const [approvers, policy] = await Promise.all([
    listEligibleApprovers(membership),
    getOrganizationPolicy(membership.organizationId),
  ]);

  const query = await searchParams;
  const single = (key: string) => {
    const value = query[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const sourceUrl = single('sourceUrl');
  const source = single('messageId')
    ? {
        type: 'GMAIL' as const,
        messageId: single('messageId'),
        threadId: single('threadId'),
        senderEmail: single('senderEmail'),
        subject: single('subject'),
        // Only https links are carried through; anything else is dropped
        // rather than rendered as a link the requester might follow.
        ...(sourceUrl && /^https:\/\//i.test(sourceUrl) ? { url: sourceUrl } : {}),
      }
    : undefined;

  return (
    <>
      <PageHeader
        title="New verification request"
        description="Ask the person who supposedly made this request to confirm the exact details with their passkey."
      />

      {source ? (
        <Alert tone="info" title="Started from a Gmail message" className="mb-6">
          <p>
            From <strong>{source.senderEmail ?? 'an unknown sender'}</strong>
            {source.subject ? (
              <>
                {' '}
                — <span className="italic">{source.subject}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1">
            Treat that message as unverified. Type the details below from the invoice or contract,
            not from the email, and let the approver confirm them.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardBody>
          <NewRequestForm
            organizationId={membership.organizationId}
            slug={slug}
            approvers={approvers}
            enabledActionTypes={enabledActionTypes as ActionTypeValue[]}
            defaultExpirationMinutes={policy.defaultExpirationMinutes}
            maximumExpirationMinutes={policy.maximumExpirationMinutes}
            thresholdMinor={
              policy.verificationRecommendedThresholdMinor === null
                ? null
                : Number(policy.verificationRecommendedThresholdMinor)
            }
            policyCurrency={policy.currency}
            {...(source ? { source } : {})}
          />
        </CardBody>
      </Card>
    </>
  );
}
