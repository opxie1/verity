import {
  actionFieldsOf,
  createRequest,
  listRequests,
  requireMembership,
  requireMembershipWithPermission,
  type CanonicalObject,
} from '@verity/domain';
import { prisma } from '@verity/database';
import { DomainError } from '@verity/domain';
import {
  ACTION_TYPE_LABELS,
  createRequestSchema,
  listRequestsQuerySchema,
  organizationIdSchema,
} from '@verity/schemas';
import { sendApprovalRequestEmail } from '@/lib/email/templates';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { enabledActionTypes } from '@/lib/env';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';

export const GET = routeHandler(async (request, ctx) => {
  const user = await requireSessionUser();
  const url = new URL(request.url);

  const organizationId = parseOrThrow(
    organizationIdSchema,
    url.searchParams.get('organizationId'),
  );
  const membership = await requireMembership(user, organizationId, ctx);

  const query = parseOrThrow(
    listRequestsQuerySchema,
    Object.fromEntries(url.searchParams.entries()),
  );

  const result = await listRequests(membership, query);
  return okResponse(result, ctx.correlationId);
});

export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  enforceRateLimit(RATE_LIMITS.createRequest, user.id);

  const input = await parseJsonBody(request, createRequestSchema);

  // Checked before anything is written: an action type that is switched off
  // must not be able to produce an approvable request (PRD 36.19).
  if (!enabledActionTypes.includes(input.actionType)) {
    throw new DomainError('VALIDATION_FAILED', {
      message: 'That action type is not available yet.',
      fieldErrors: { actionType: ['This action type is not enabled for your organization.'] },
    });
  }

  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, input.organizationId),
    'request:create',
    ctx,
  );

  const created = await createRequest(membership, input, ctx);
  const payload = created.protectedPayloadJson as CanonicalObject;

  // Notification is best effort. A delivery failure must not undo a request
  // that already exists, so it is logged and reported rather than thrown.
  const [approver, organization] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: created.assignedApproverUserId },
      select: { email: true, name: true },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
      select: { name: true },
    }),
  ]);

  let notified = true;
  try {
    await sendApprovalRequestEmail({
      to: approver.email,
      approverName: approver.name,
      requesterName: membership.user.displayName ?? membership.user.email,
      organizationName: organization.name,
      actionTypeLabel: ACTION_TYPE_LABELS[created.actionType],
      summary: created.displaySummary,
      requestId: created.id,
      expiresAt: created.expiresAt,
    });
  } catch (error) {
    notified = false;
    console.error(`[verity] ${ctx.correlationId} approver notification failed`, error);
  }

  return okResponse(
    {
      request: {
        id: created.id,
        status: created.status,
        actionType: created.actionType,
        payloadHash: created.payloadHash,
        displayTitle: created.displayTitle,
        displaySummary: created.displaySummary,
        expiresAt: created.expiresAt,
        fields: actionFieldsOf(payload),
      },
      approverNotified: notified,
    },
    ctx.correlationId,
    201,
  );
});
