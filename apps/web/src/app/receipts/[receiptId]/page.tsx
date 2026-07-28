import {
  actionFieldsOf,
  isDomainError,
  listAuditEventsForTarget,
  recordReceiptViewed,
  requireMembership,
  verifyReceipt,
  generateCorrelationId,
  type CanonicalObject,
} from '@verity/domain';
import { prisma } from '@verity/database';
import { ACTION_TYPE_LABELS, receiptIdSchema } from '@verity/schemas';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ProtectedFieldsTable } from '@/components/protected-fields-table';
import { RequestStatusBadge } from '@/components/request-status-badge';
import { AuditTimeline } from '@/app/o/[slug]/requests/[requestId]/audit-timeline';
import { receiptSigningConfig } from '@/lib/receipts';
import { getSessionUser } from '@/lib/session';
import { CopyVerificationLink } from './copy-verification-link';

export const metadata: Metadata = { title: 'Receipt' };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const user = await getSessionUser();
  const { receiptId } = await params;

  const parsed = receiptIdSchema.safeParse(receiptId);
  if (!parsed.success) {
    notFound();
  }

  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/receipts/${parsed.data}`)}`);
  }

  const stub = await prisma.receipt.findUnique({
    where: { id: parsed.data },
    select: { request: { select: { organizationId: true } } },
  });
  if (!stub) {
    notFound();
  }

  let membership;
  try {
    membership = await requireMembership(user, stub.request.organizationId);
  } catch {
    notFound();
  }

  let result;
  try {
    result = await verifyReceipt(membership, parsed.data, receiptSigningConfig);
  } catch (error) {
    if (isDomainError(error)) {
      notFound();
    }
    throw error;
  }

  await recordReceiptViewed(membership, parsed.data, {
    correlationId: generateCorrelationId(),
    ipHash: null,
    userAgent: null,
  });

  const { receipt } = result;
  const request = receipt.request;
  const body = receipt.receiptPayloadJson as Record<string, unknown>;
  const fields = actionFieldsOf(request.protectedPayloadJson as CanonicalObject);
  const timeline = await listAuditEventsForTarget(
    membership.organizationId,
    'VerificationRequest',
    request.id,
  );

  const decision = String(body.decision ?? '');

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Approval receipt</h1>
      <p className="mt-1 font-mono text-sm text-slate-500">{receipt.id}</p>

      <div className="mt-6">
        {!result.signatureValid ? (
          <Alert tone="danger" title="This receipt does not verify">
            The signature on this record does not match its contents. Treat it as worthless and tell
            an administrator, quoting the receipt ID above.
          </Alert>
        ) : result.revoked ? (
          <Alert tone="danger" title="This approval was revoked">
            <p>
              It was valid when it was issued, and the original decision is still recorded below,
              but the approver has since withdrawn it. Do not act on it.
            </p>
            {request.revocation ? (
              <p className="mt-2">
                Revoked on {request.revocation.createdAt.toLocaleString()}. Reason given:{' '}
                {request.revocation.reason}
              </p>
            ) : null}
          </Alert>
        ) : !result.payloadMatchesRequest ? (
          <Alert tone="danger" title="Details do not match approved request">
            The request this receipt refers to no longer hashes to the value that was approved. Do
            not act on it.
          </Alert>
        ) : decision === 'DENIED' ? (
          <Alert tone="danger" title="This request was denied">
            {request.approver.name ?? request.approver.email} refused this on{' '}
            {receipt.createdAt.toLocaleString()}. Do not act on it.
          </Alert>
        ) : result.currentlyValid ? (
          <Alert tone="success" title="Valid approval">
            {request.approver.name ?? request.approver.email} approved exactly the details below on{' '}
            {receipt.createdAt.toLocaleString()}, confirmed with their registered passkey.
          </Alert>
        ) : (
          <Alert tone="warning" title="This approval is not currently in force">
            Its state is {result.status.toLowerCase()}. See the history below.
          </Alert>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What was approved</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-slate-700">{request.displaySummary}</p>
          <ProtectedFieldsTable payload={fields} />
        </CardBody>
      </Card>

      {result.currentlyValid ? (
        <Alert tone="warning" className="mt-6" title="Before you act on this">
          Check that the details you are about to enter elsewhere match the table above exactly,
          character for character. This approval covers those details and nothing else. If the
          account number you were given differs from the one here, stop.
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Record</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label="Organization" value={String(body.organizationId ?? '')} mono />
            <Row label="Action" value={ACTION_TYPE_LABELS[request.actionType]} />
            <Row
              label="Requested by"
              value={`${request.requester.name ?? request.requester.email} (${request.requester.email})`}
            />
            <Row
              label="Decided by"
              value={`${request.approver.name ?? request.approver.email} (${request.approver.email})`}
            />
            <Row label="Decision" value={decision} />
            <Row label="Signed at" value={receipt.createdAt.toLocaleString()} />
            <Row label="Credential" value={String(body.credentialId ?? '')} mono />
            <Row label="Signing key version" value={String(receipt.signingKeyVersion)} />
            <div>
              <p className="font-medium text-slate-600">Current state</p>
              <div className="mt-1">
                <RequestStatusBadge status={result.status as never} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cryptographic detail</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-slate-600">Payload fingerprint</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-700">
                {String(body.payloadHash ?? '')}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-600">Server signature</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-700">
                {receipt.serverSignature}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              The signature proves this record was issued by Verity and has not been altered since.
              It does not certify that the approved action was correct, lawful, or safe.
            </p>
            <CopyVerificationLink receiptId={receipt.id} />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
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

      <p className="mt-6 text-sm">
        <Link href={`/r/${request.id}`} className="text-sky-700 underline">
          Open the full request
        </Link>
      </p>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="font-medium text-slate-600">{label}</p>
      <p className={mono ? 'break-all font-mono text-xs text-slate-700' : 'text-slate-900'}>
        {value}
      </p>
    </div>
  );
}
