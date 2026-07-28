import { prisma } from '@verity/database';
import {
  actionFieldsOf,
  getRequest,
  isDomainError,
  recordRequestViewed,
  requireMembership,
  type CanonicalObject,
} from '@verity/domain';
import { ACTION_TYPE_LABELS, requestIdSchema } from '@verity/schemas';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ProtectedFieldsTable } from '@/components/protected-fields-table';
import { RequestStatusBadge } from '@/components/request-status-badge';
import { generateCorrelationId } from '@verity/domain';
import { getSessionUser } from '@/lib/session';
import { DecisionPanel } from './decision-panel';

export const metadata: Metadata = { title: 'Approve or deny' };

/**
 * The approval page (PRD 23.3).
 *
 * Deliberately plain, and deliberately loaded from the server. The Gmail
 * extension never renders these details itself and no decision is taken inside
 * it, because an extension that had been tampered with could show one thing
 * while the approver authorized another (PRD 18.9).
 */
export default async function ApprovePage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const user = await getSessionUser();
  const { requestId } = await params;

  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    notFound();
  }

  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/approve/${parsed.data}`)}`);
  }

  // The request tells us which organization to check membership against; the
  // membership check then decides whether this person may see it at all.
  const stub = await prisma.verificationRequest.findUnique({
    where: { id: parsed.data },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  if (!stub) {
    notFound();
  }

  let membership;
  try {
    membership = await requireMembership(user, stub.organizationId);
  } catch {
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

  const passkeyCount = await prisma.passkeyCredential.count({
    where: { userId: user.id, revokedAt: null },
  });

  if (request.viewerIsApprover && request.status === 'PENDING') {
    await recordRequestViewed(membership, request.id, {
      correlationId: generateCorrelationId(),
      ipHash: null,
      userAgent: null,
    });
  }

  const fields = actionFieldsOf(request.protectedPayloadJson as CanonicalObject);

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-10">
      {/* 1. Whose organization is asking. */}
      <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
      <p className="mt-1 text-sm text-slate-600">{stub.organization.name}</p>

      {/* 2. What is being asked. */}
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">
        You are being asked to approve
      </h1>

      {/* 3. The action, in one plain sentence. */}
      <p className="mt-3 text-lg text-slate-900">{request.displaySummary}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <RequestStatusBadge status={request.status} />
        <span className="text-sm text-slate-600">
          {ACTION_TYPE_LABELS[request.actionType]}
        </span>
      </div>

      {/* 4. The structured detail, in full. */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Exactly what you are approving</CardTitle>
        </CardHeader>
        <CardBody>
          <ProtectedFieldsTable payload={fields} />
        </CardBody>
      </Card>

      {/* 5. Who asked, and where it came from. */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Who is asking</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-700">
          <p>
            <strong>{request.requester.name ?? request.requester.email}</strong> (
            {request.requester.email}) raised this on{' '}
            {request.createdAt.toLocaleString()}.
          </p>
          {request.sourceType === 'GMAIL' && request.sourceSenderEmail ? (
            <p className="text-slate-600">
              They started it from an email that appeared to come from{' '}
              <strong>{request.sourceSenderEmail}</strong>
              {request.sourceSubject ? <> — “{request.sourceSubject}”</> : null}. That message is
              not evidence of anything. Your decision is.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* 6. When it lapses. */}
      {request.status === 'PENDING' ? (
        <Alert tone="warning" className="mt-6">
          This request expires on {request.expiresAt.toLocaleString()}. After that it cannot be
          approved and would have to be raised again.
        </Alert>
      ) : null}

      {/* 7-10. The disclaimer, the buttons, and the passkey prompt. */}
      {!request.viewerIsApprover ? (
        <Alert tone="info" className="mt-6" title="This is not assigned to you">
          Only {request.approver.name ?? request.approver.email} can decide this request. Nobody
          can approve on another person&apos;s behalf.
        </Alert>
      ) : request.status !== 'PENDING' ? (
        <Alert tone="info" className="mt-6" title="This request has already been settled">
          <p>Its current state is {request.status.toLowerCase()}.</p>
          {request.receipt ? (
            <p className="mt-2">
              <Link href={`/receipts/${request.receipt.id}`} className="font-medium underline">
                View the receipt
              </Link>
            </p>
          ) : null}
        </Alert>
      ) : passkeyCount === 0 ? (
        <Alert tone="danger" className="mt-6" title="Register a passkey before you can decide">
          <p>
            A decision has to be signed by a passkey registered to you. That is what makes it
            impossible for somebody with access to your email to answer in your name.
          </p>
          <p className="mt-2">
            <Link href="/security" className="font-medium underline">
              Register a passkey
            </Link>
          </p>
        </Alert>
      ) : (
        <DecisionPanel
          organizationId={membership.organizationId}
          requestId={request.id}
          summary={request.displaySummary}
        />
      )}
    </main>
  );
}
