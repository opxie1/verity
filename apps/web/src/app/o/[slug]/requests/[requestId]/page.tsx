import {
  actionFieldsOf,
  getRequest,
  isDomainError,
  listAuditEventsForTarget,
  type CanonicalObject,
} from '@verity/domain';
import { ACTION_TYPE_LABELS, requestIdSchema } from '@verity/schemas';
import { Alert, Card, CardBody, CardHeader, CardTitle, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProtectedFieldsTable } from '@/components/protected-fields-table';
import { RequestStatusBadge } from '@/components/request-status-badge';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';
import { AuditTimeline } from './audit-timeline';
import { CancelRequestButton } from './cancel-request-button';
import { RevokeApproval } from './revoke-approval';

export const metadata: Metadata = { title: 'Request' };

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ slug: string; requestId: string }>;
}) {
  const user = await requireSessionUser();
  const { slug, requestId } = await params;
  const membership = await membershipForSlug(user, slug);

  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    notFound();
  }

  let request;
  try {
    request = await getRequest(membership, parsed.data);
  } catch (error) {
    if (isDomainError(error)) {
      notFound();
    }
    throw error;
  }

  const payload = request.protectedPayloadJson as CanonicalObject;
  const fields = actionFieldsOf(payload);
  const timeline = await listAuditEventsForTarget(
    membership.organizationId,
    'VerificationRequest',
    request.id,
  );

  return (
    <>
      <PageHeader
        title={request.displayTitle}
        description={ACTION_TYPE_LABELS[request.actionType]}
        actions={<RequestStatusBadge status={request.status} />}
      />

      {request.status === 'PENDING' && request.viewerIsApprover ? (
        <Alert tone="warning" title="This is waiting for your decision" className="mb-6">
          <p>
            Review the details below and decide with your passkey. Approving confirms that you
            authorize the exact action shown.
          </p>
          <p className="mt-2">
            <Link href={`/approve/${request.id}`} className="font-medium underline">
              Review and decide
            </Link>
          </p>
        </Alert>
      ) : null}

      {request.status === 'REVOKED' && request.revocation ? (
        <Alert tone="danger" title="This approval was revoked" className="mb-6">
          Revoked on {request.revocation.createdAt.toLocaleString()}. Reason given:{' '}
          {request.revocation.reason}. Do not act on the earlier approval.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What was requested</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-4 text-sm text-slate-700">{request.displaySummary}</p>
              <ProtectedFieldsTable payload={fields} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardBody>
              <AuditTimeline
                events={timeline.map((event) => ({
                  id: event.id,
                  eventType: event.eventType,
                  createdAt: event.createdAt.toISOString(),
                  actorName: event.actor?.name ?? event.actor?.email ?? null,
                  previousState: event.previousState,
                  newState: event.newState,
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Detail label="Raised by" value={request.requester.name ?? request.requester.email} />
              <Detail label="Approver" value={request.approver.name ?? request.approver.email} />
              <Detail label="Created" value={request.createdAt.toLocaleString()} />
              <Detail
                label={request.status === 'PENDING' ? 'Expires' : 'Expired'}
                value={request.expiresAt.toLocaleString()}
              />
              {request.approvedAt ? (
                <Detail label="Approved" value={request.approvedAt.toLocaleString()} />
              ) : null}
              {request.deniedAt ? (
                <Detail label="Denied" value={request.deniedAt.toLocaleString()} />
              ) : null}

              <div>
                <p className="font-medium text-slate-600">Payload fingerprint</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">
                  {request.payloadHash}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  A digest of the exact details above. If any of them change, this changes.
                </p>
              </div>

              {request.receipt ? (
                <Link
                  href={`/receipts/${request.receipt.id}`}
                  className="inline-block font-medium text-sky-700 underline"
                >
                  View receipt
                </Link>
              ) : null}
            </CardBody>
          </Card>

          {request.sourceType === 'GMAIL' ? (
            <Card>
              <CardHeader>
                <CardTitle>Where it came from</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <Detail label="Sender" value={request.sourceSenderEmail ?? 'Unknown'} />
                <Detail label="Subject" value={request.sourceSubject ?? 'Unknown'} />
                <p className="text-xs text-slate-500">
                  Recorded for context only. The message is not evidence that the request is
                  genuine — that is what the approval is for.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {request.status === 'PENDING' && request.viewerIsRequester ? (
            <Card>
              <CardBody>
                <CancelRequestButton
                  organizationId={membership.organizationId}
                  requestId={request.id}
                />
              </CardBody>
            </Card>
          ) : null}

          {request.status === 'APPROVED' &&
          (request.viewerIsApprover || membership.role === 'ORG_ADMIN') ? (
            <Card>
              <CardBody>
                <RevokeApproval
                  organizationId={membership.organizationId}
                  requestId={request.id}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-slate-600">{label}</p>
      <p className="text-slate-900">{value}</p>
    </div>
  );
}
