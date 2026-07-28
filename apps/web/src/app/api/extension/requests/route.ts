import { prisma } from '@verity/database';
import { DomainError, createRequest, requireMembershipWithPermission } from '@verity/domain';
import { ACTION_TYPE_LABELS, createRequestSchema, organizationIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  corsPreflight,
  extensionRouteHandler,
  okResponse,
  parseJsonBody,
  parseOrThrow,
} from '@/lib/api';
import { sendApprovalRequestEmail } from '@/lib/email/templates';
import { enabledActionTypes } from '@/lib/env';
import { requireSessionUser } from '@/lib/session';

export const OPTIONS = async (request: Request) => corsPreflight(request);

/**
 * Creates a request from the Gmail panel.
 *
 * Identical validation, normalization and hashing to the web form: this is a
 * different door onto the same domain service, not a shortcut past it. In
 * particular the payload is built and hashed on the server here too, so a
 * compromised extension cannot decide what the approver ends up authorizing
 * (PRD 18.9).
 */
export const POST = extensionRouteHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const input = await parseJsonBody(request, createRequestSchema);

  if (!enabledActionTypes.includes(input.actionType)) {
    throw new DomainError('VALIDATION_FAILED', {
      message: 'That action type is not available yet.',
    });
  }

  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, input.organizationId),
    'request:create',
    ctx,
  );

  const created = await createRequest(membership, input, ctx);

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

  await sendApprovalRequestEmail({
    to: approver.email,
    approverName: approver.name,
    requesterName: membership.user.displayName ?? membership.user.email,
    organizationName: organization.name,
    actionTypeLabel: ACTION_TYPE_LABELS[created.actionType],
    summary: created.displaySummary,
    requestId: created.id,
    expiresAt: created.expiresAt,
  }).catch((error: unknown) => {
    console.error(`[verity] ${ctx.correlationId} approver notification failed`, error);
  });

  return okResponse(
    {
      request: {
        id: created.id,
        status: created.status,
        displayTitle: created.displayTitle,
        displaySummary: created.displaySummary,
        expiresAt: created.expiresAt,
      },
    },
    ctx.correlationId,
    201,
  );
});
