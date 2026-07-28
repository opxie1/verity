import { Prisma, prisma, type ActionType, type RequestStatus } from '@verity/database';
import type { CancelRequestInput, CreateRequestInput, ListRequestsQuery } from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../authz/guards';
import type { MembershipContext, RequestContext } from '../context';
import { generateNonce } from '../crypto/tokens';
import { DomainError } from '../errors';
import { getOrganizationPolicy } from '../organizations/organization-service';
import {
  buildProtectedPayload,
  compareToApprovedPayload,
  computePayloadHash,
  type CanonicalObject,
} from './normalization';
import { assertTransition, effectiveStatus } from './state-machine';
import { buildDisplaySummary, buildDisplayTitle } from './summary';

/**
 * Creates a verification request in PENDING (PRD 14.3).
 *
 * Two properties are load-bearing:
 *
 *   - The protected payload and its hash are built here, on the server, from
 *     validated input. A hash supplied by the caller is never read
 *     (PRD FR-008, section 25).
 *   - The nonce is server-generated, so two requests that are otherwise
 *     identical still hash differently and an approval for one can never be
 *     presented as an approval for the other (PRD 18.5).
 */
export async function createRequest(
  membership: MembershipContext,
  input: CreateRequestInput,
  ctx: RequestContext,
) {
  requirePermission(membership, 'request:create');

  const policy = await getOrganizationPolicy(membership.organizationId);

  if (input.expiresInMinutes > policy.maximumExpirationMinutes) {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: {
        expiresInMinutes: [
          `This organization allows a maximum of ${policy.maximumExpirationMinutes} minutes.`,
        ],
      },
    });
  }

  const approverMembership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: membership.organizationId,
        userId: input.assignedApproverUserId,
      },
    },
    select: { role: true, status: true, user: { select: { status: true } } },
  });

  if (
    !approverMembership ||
    approverMembership.status !== 'ACTIVE' ||
    approverMembership.user.status !== 'ACTIVE'
  ) {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: { assignedApproverUserId: ['That approver is not active in this organization.'] },
    });
  }

  if (approverMembership.role !== 'ORG_ADMIN' && approverMembership.role !== 'APPROVER') {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: { assignedApproverUserId: ['That person is not allowed to approve requests.'] },
    });
  }

  if (input.assignedApproverUserId === membership.user.id && !policy.allowSelfApproval) {
    throw new DomainError('UNAUTHORIZED', {
      message:
        'This organization does not allow approving your own request. Choose a different approver.',
    });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
  const nonce = generateNonce();

  const payload = buildProtectedPayload({
    actionType: input.actionType,
    fields: input.fields as Record<string, unknown>,
    organizationId: membership.organizationId,
    requesterUserId: membership.user.id,
    approverUserId: input.assignedApproverUserId,
    sourceMessageId: input.source?.messageId ?? null,
    expiresAt,
    nonce,
  });

  const payloadHash = computePayloadHash(payload);

  return prisma.$transaction(async (tx) => {
    const created = await tx.verificationRequest.create({
      data: {
        organizationId: membership.organizationId,
        requesterUserId: membership.user.id,
        assignedApproverUserId: input.assignedApproverUserId,
        actionType: input.actionType,
        // Created and submitted in one step: a request that sits in DRAFT
        // helps nobody, and PENDING is what the approver is notified about.
        status: 'PENDING',
        displayTitle: buildDisplayTitle(input.actionType, payload),
        displaySummary: buildDisplaySummary(input.actionType, payload),
        protectedPayloadJson: payload as Prisma.InputJsonValue,
        payloadHash,
        nonce,
        sourceType: input.source?.type ?? 'MANUAL',
        sourceMessageId: input.source?.messageId ?? null,
        sourceThreadId: input.source?.threadId ?? null,
        sourceSenderEmail: input.source?.senderEmail ?? null,
        sourceSubject: input.source?.subject ?? null,
        sourceUrl: input.source?.url || null,
        expiresAt,
        submittedAt: now,
      },
    });

    for (const eventType of ['REQUEST_CREATED', 'REQUEST_SUBMITTED'] as const) {
      await recordAuditEvent(
        {
          organizationId: membership.organizationId,
          actorUserId: membership.user.id,
          eventType,
          targetType: 'VerificationRequest',
          targetId: created.id,
          // The hash, not the payload: an audit record should let you prove
          // what was requested without itself restating account details.
          metadata: {
            actionType: created.actionType,
            payloadHash,
            approverUserId: input.assignedApproverUserId,
          },
          previousState: eventType === 'REQUEST_CREATED' ? null : 'DRAFT',
          newState: eventType === 'REQUEST_CREATED' ? 'DRAFT' : 'PENDING',
          ctx,
        },
        tx,
      );
    }

    return created;
  });
}

/** Loads a request the caller is entitled to see, or reports it as missing. */
export async function getRequest(membership: MembershipContext, requestId: string) {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: {
      requester: { select: { id: true, email: true, name: true } },
      approver: { select: { id: true, email: true, name: true } },
      receipt: { select: { id: true, createdAt: true } },
      revocation: { select: { reason: true, createdAt: true, revokedByUserId: true } },
      decisions: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          decision: true,
          reason: true,
          createdAt: true,
          approverUserId: true,
          credential: { select: { label: true } },
        },
      },
    },
  });

  // Cross-organization reads are indistinguishable from a missing record.
  if (!request || request.organizationId !== membership.organizationId) {
    throw new DomainError('REQUEST_NOT_FOUND');
  }

  const isRequester = request.requesterUserId === membership.user.id;
  const isApprover = request.assignedApproverUserId === membership.user.id;
  const canReadAll =
    membership.role === 'ORG_ADMIN' || membership.role === 'AUDITOR';

  if (!isRequester && !isApprover && !canReadAll) {
    throw new DomainError('REQUEST_NOT_FOUND');
  }

  return {
    ...request,
    status: effectiveStatus(request.status, request.expiresAt),
    viewerIsRequester: isRequester,
    viewerIsApprover: isApprover,
  };
}

export async function listRequests(membership: MembershipContext, query: ListRequestsQuery) {
  const canReadAll = membership.role === 'ORG_ADMIN' || membership.role === 'AUDITOR';

  // A requester sees what they raised; an approver sees what was sent to them.
  // Administrators and auditors see everything in their own organization only.
  const visibility: Prisma.VerificationRequestWhereInput = canReadAll
    ? {}
    : {
        OR: [
          { requesterUserId: membership.user.id },
          { assignedApproverUserId: membership.user.id },
        ],
      };

  const where: Prisma.VerificationRequestWhereInput = {
    organizationId: membership.organizationId,
    ...visibility,
    ...(query.status ? { status: query.status } : {}),
    ...(query.actionType ? { actionType: query.actionType } : {}),
    ...(query.requesterUserId ? { requesterUserId: query.requesterUserId } : {}),
    ...(query.approverUserId ? { assignedApproverUserId: query.approverUserId } : {}),
    ...(query.threadId ? { sourceThreadId: query.threadId } : {}),
    ...(query.createdAfter || query.createdBefore
      ? {
          createdAt: {
            ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}),
            ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.verificationRequest.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      requester: { select: { id: true, email: true, name: true } },
      approver: { select: { id: true, email: true, name: true } },
    },
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  // Amount filtering happens here rather than in SQL: amounts live inside the
  // protected payload, and querying into that JSON would tie the filter to the
  // payload's internal shape.
  const filtered = page.filter((row) => {
    if (query.minAmountMinor === undefined && query.maxAmountMinor === undefined) {
      return true;
    }
    const payload = row.protectedPayloadJson as CanonicalObject;
    const amount = payload.amountMinor;
    if (typeof amount !== 'number') {
      return false;
    }
    if (query.minAmountMinor !== undefined && amount < query.minAmountMinor) return false;
    if (query.maxAmountMinor !== undefined && amount > query.maxAmountMinor) return false;
    return true;
  });

  return {
    requests: filtered.map((row) => ({
      id: row.id,
      status: effectiveStatus(row.status, row.expiresAt),
      actionType: row.actionType,
      displayTitle: row.displayTitle,
      displaySummary: row.displaySummary,
      payloadHash: row.payloadHash,
      requester: row.requester,
      approver: row.approver,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      sourceThreadId: row.sourceThreadId,
      viewerIsApprover: row.assignedApproverUserId === membership.user.id,
      viewerIsRequester: row.requesterUserId === membership.user.id,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Cancels a pending request. Only the person who raised it may do so (PRD FR-017). */
export async function cancelRequest(
  membership: MembershipContext,
  requestId: string,
  input: CancelRequestInput,
  ctx: RequestContext,
) {
  requirePermission(membership, 'request:cancel:own');

  return prisma.$transaction(async (tx) => {
    const request = await tx.verificationRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        organizationId: true,
        requesterUserId: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!request || request.organizationId !== membership.organizationId) {
      throw new DomainError('REQUEST_NOT_FOUND');
    }
    if (request.requesterUserId !== membership.user.id) {
      throw new DomainError('UNAUTHORIZED', {
        message: 'Only the person who created a request can cancel it.',
      });
    }

    const current = effectiveStatus(request.status, request.expiresAt);
    assertTransition(current, 'CANCELED');

    // Conditional update, so a cancellation racing an approval cannot both win.
    const updated = await tx.verificationRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new DomainError('REQUEST_NOT_PENDING');
    }

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'REQUEST_CANCELED',
        targetType: 'VerificationRequest',
        targetId: request.id,
        metadata: input.reason ? { reason: input.reason } : {},
        previousState: 'PENDING',
        newState: 'CANCELED',
        ctx,
      },
      tx,
    );

    return { id: request.id, status: 'CANCELED' as RequestStatus };
  });
}

/**
 * Reports whether details the caller is about to act on still match what was
 * approved (PRD 14.5, 18.4).
 *
 * The caller sends the values they hold; the response says which ones differ.
 * It deliberately does not return corrected values for fields the caller got
 * wrong beyond what they already submitted, so this cannot be used to read a
 * payload out of the system field by field.
 */
export async function compareRequestDetails(
  membership: MembershipContext,
  requestId: string,
  submitted: Record<string, unknown>,
) {
  const request = await getRequest(membership, requestId);
  const approved = request.protectedPayloadJson as CanonicalObject;

  const comparisons = compareToApprovedPayload(approved, submitted);

  return {
    status: request.status,
    // A comparison only means anything against a live approval. If the request
    // was denied, revoked or has expired, matching details are not authority
    // to act.
    matches: request.status === 'APPROVED' && comparisons.every((entry) => entry.matches),
    comparisons,
  };
}

/** Records that the assigned approver opened a request (PRD FR-015). */
export async function recordRequestViewed(
  membership: MembershipContext,
  requestId: string,
  ctx: RequestContext,
): Promise<void> {
  await recordAuditEvent({
    organizationId: membership.organizationId,
    actorUserId: membership.user.id,
    eventType: 'REQUEST_VIEWED',
    targetType: 'VerificationRequest',
    targetId: requestId,
    metadata: {},
    ctx,
  });
}

/**
 * Marks lapsed requests expired (PRD FR-016).
 *
 * Reads already treat a lapsed request as expired via `effectiveStatus`; this
 * makes the database agree, so the audit trail records the moment it lapsed
 * rather than leaving it implicit.
 */
export async function expireLapsedRequests(ctx: RequestContext, now = new Date()) {
  const lapsed = await prisma.verificationRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    select: { id: true, organizationId: true },
    take: 500,
  });

  let expired = 0;
  for (const request of lapsed) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.verificationRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      if (updated.count !== 1) {
        return;
      }
      await recordAuditEvent(
        {
          organizationId: request.organizationId,
          // No human did this, so there is no actor to name.
          actorUserId: null,
          eventType: 'REQUEST_EXPIRED',
          targetType: 'VerificationRequest',
          targetId: request.id,
          metadata: {},
          previousState: 'PENDING',
          newState: 'EXPIRED',
          ctx,
        },
        tx,
      );
      expired += 1;
    });
  }

  return { expired };
}

export interface EligibleApprover {
  userId: string;
  email: string;
  displayName: string | null;
  hasEnrolledPasskey: boolean;
}

export function actionTypeIsEnabled(actionType: ActionType, enabled: readonly ActionType[]): boolean {
  return enabled.includes(actionType);
}
