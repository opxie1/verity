import { prisma, type DbClient, type Prisma } from '@verity/database';
import { recordAuditEvent } from '../audit/audit-service';
import type { MembershipContext, RequestContext } from '../context';
import { DomainError } from '../errors';
import { canonicalize, computePayloadHash, type CanonicalObject } from '../requests/normalization';
import { effectiveStatus } from '../requests/state-machine';
import {
  signReceiptBody,
  verifyReceiptSignature,
  type ReceiptSigningConfig,
} from './signing';

export const RECEIPT_SCHEMA_VERSION = 1;

/** The receipt body, exactly as documented in PRD FR-012. */
export interface ReceiptBody extends CanonicalObject {
  receiptId: string;
  requestId: string;
  organizationId: string;
  requesterUserId: string;
  approverUserId: string;
  decision: string;
  actionType: string;
  payloadHash: string;
  credentialId: string;
  approvedAt: string;
  schemaVersion: number;
}

/**
 * Writes the signed receipt for a decision (PRD FR-012).
 *
 * Called inside the same transaction as the decision it records, so a receipt
 * cannot exist for a decision that did not commit, nor a decision without its
 * receipt.
 */
export async function createReceipt(
  db: DbClient,
  input: {
    receiptId: string;
    requestId: string;
    organizationId: string;
    requesterUserId: string;
    approverUserId: string;
    decision: string;
    actionType: string;
    payloadHash: string;
    credentialId: string;
    decidedAt: Date;
  },
  config: ReceiptSigningConfig,
) {
  const body: ReceiptBody = {
    receiptId: input.receiptId,
    requestId: input.requestId,
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
    approverUserId: input.approverUserId,
    decision: input.decision,
    actionType: input.actionType,
    payloadHash: input.payloadHash,
    credentialId: input.credentialId,
    approvedAt: input.decidedAt.toISOString(),
    schemaVersion: RECEIPT_SCHEMA_VERSION,
  };

  const canonicalBody = canonicalize(body);

  return db.receipt.create({
    data: {
      id: input.receiptId,
      requestId: input.requestId,
      receiptPayloadJson: body as Prisma.InputJsonValue,
      receiptPayloadHash: computePayloadHash(body),
      serverSignature: signReceiptBody(canonicalBody, config),
      signingKeyVersion: config.keyVersion,
    },
  });
}

export interface ReceiptVerification {
  /** The signature is intact and the stored body has not been altered. */
  signatureValid: boolean;
  /** The receipt still describes the request's current protected payload. */
  payloadMatchesRequest: boolean;
  /** The approval it records is still in force. */
  currentlyValid: boolean;
  revoked: boolean;
  expired: boolean;
  status: string;
}

/**
 * Verifies a receipt server-side (PRD FR-013).
 *
 * All four checks run against stored data, never against anything the client
 * sends. The interface renders the result; it does not decide it
 * (PRD 10.6, section 25).
 */
export async function verifyReceipt(
  membership: MembershipContext,
  receiptId: string,
  config: ReceiptSigningConfig,
): Promise<ReceiptVerification & { receipt: Awaited<ReturnType<typeof loadReceipt>> }> {
  const receipt = await loadReceipt(membership, receiptId);

  const body = receipt.receiptPayloadJson as unknown as ReceiptBody;
  const signatureValid = verifyReceiptSignature(
    canonicalize(body as CanonicalObject),
    receipt.serverSignature,
    config,
  );

  const status = effectiveStatus(receipt.request.status, receipt.request.expiresAt);
  const payloadMatchesRequest = body.payloadHash === receipt.request.payloadHash;
  const revoked = status === 'REVOKED';

  return {
    receipt,
    signatureValid,
    payloadMatchesRequest,
    revoked,
    expired: status === 'EXPIRED',
    status,
    // An approval is only in force if it was signed properly, still describes
    // the request as it stands, and has not been revoked. The body records the
    // resulting state ("APPROVED"/"DENIED"), not the verb that produced it.
    currentlyValid:
      signatureValid &&
      payloadMatchesRequest &&
      status === 'APPROVED' &&
      body.decision === 'APPROVED',
  };
}

async function loadReceipt(membership: MembershipContext, receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      request: {
        include: {
          requester: { select: { id: true, email: true, name: true } },
          approver: { select: { id: true, email: true, name: true } },
          revocation: { select: { reason: true, createdAt: true } },
          decisions: {
            orderBy: { createdAt: 'asc' },
            select: {
              decision: true,
              reason: true,
              createdAt: true,
              credential: { select: { label: true } },
            },
          },
        },
      },
    },
  });

  // Cross-organization access reads as missing, so receipt IDs cannot be
  // enumerated across tenants (PRD FR-002).
  if (!receipt || receipt.request.organizationId !== membership.organizationId) {
    throw new DomainError('NOT_FOUND', { message: 'That receipt does not exist.' });
  }

  const isParty =
    receipt.request.requesterUserId === membership.user.id ||
    receipt.request.assignedApproverUserId === membership.user.id;
  const canReadAll = membership.role === 'ORG_ADMIN' || membership.role === 'AUDITOR';

  if (!isParty && !canReadAll) {
    throw new DomainError('NOT_FOUND', { message: 'That receipt does not exist.' });
  }

  return receipt;
}

export async function recordReceiptViewed(
  membership: MembershipContext,
  receiptId: string,
  ctx: RequestContext,
): Promise<void> {
  await recordAuditEvent({
    organizationId: membership.organizationId,
    actorUserId: membership.user.id,
    eventType: 'RECEIPT_VIEWED',
    targetType: 'Receipt',
    targetId: receiptId,
    metadata: {},
    ctx,
  });
}
