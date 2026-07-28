import {
  actionFieldsOf,
  getRequest,
  recordRequestViewed,
  requireMembership,
  type CanonicalObject,
} from '@verity/domain';
import { organizationIdSchema, requestIdSchema } from '@verity/schemas';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

export const GET = routeHandler(async (request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { requestId } = await params;
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const found = await getRequest(membership, parseOrThrow(requestIdSchema, requestId));

  // An approver opening the request is a fact worth recording: it is the
  // difference between "they never saw it" and "they saw it and did nothing".
  if (found.viewerIsApprover) {
    await recordRequestViewed(membership, found.id, ctx);
  }

  return okResponse(
    {
      request: {
        id: found.id,
        status: found.status,
        actionType: found.actionType,
        displayTitle: found.displayTitle,
        displaySummary: found.displaySummary,
        payloadHash: found.payloadHash,
        fields: actionFieldsOf(found.protectedPayloadJson as CanonicalObject),
        requester: found.requester,
        approver: found.approver,
        source: {
          type: found.sourceType,
          threadId: found.sourceThreadId,
          senderEmail: found.sourceSenderEmail,
          subject: found.sourceSubject,
          url: found.sourceUrl,
        },
        createdAt: found.createdAt,
        expiresAt: found.expiresAt,
        approvedAt: found.approvedAt,
        deniedAt: found.deniedAt,
        canceledAt: found.canceledAt,
        revokedAt: found.revokedAt,
        receiptId: found.receipt?.id ?? null,
        revocation: found.revocation,
        decisions: found.decisions,
        viewerIsApprover: found.viewerIsApprover,
        viewerIsRequester: found.viewerIsRequester,
      },
    },
    ctx.correlationId,
  );
});
