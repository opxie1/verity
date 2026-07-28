import { prisma } from '@verity/database';
import { completeDecision, requireMembership } from '@verity/domain';
import {
  authenticationResponseSchema,
  normalizedText,
  organizationIdSchema,
  requestIdSchema,
} from '@verity/schemas';
import { z } from 'zod';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { sendDecisionNotificationEmail } from '@/lib/email/templates';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { receiptSigningConfig } from '@/lib/receipts';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

type Params = { params: Promise<{ requestId: string }> };

const bodySchema = z.object({
  organizationId: organizationIdSchema,
  decision: z.enum(['APPROVE', 'DENY']),
  response: authenticationResponseSchema,
  reason: normalizedText(500).optional(),
});

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  enforceRateLimit(RATE_LIMITS.decision, user.id);

  const body = await parseJsonBody(request, bodySchema);
  const membership = await requireMembership(user, body.organizationId, ctx);

  const result = await completeDecision(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    { decision: body.decision, response: body.response, reason: body.reason },
    webAuthnConfig,
    receiptSigningConfig,
    ctx,
  );

  // Telling the requester happens after the decision has committed. If the
  // email fails, the decision still stands; the reverse would be worse.
  const decided = await prisma.verificationRequest.findUniqueOrThrow({
    where: { id: result.requestId },
    select: {
      displayTitle: true,
      requester: { select: { email: true, name: true } },
      organization: { select: { name: true } },
    },
  });

  await sendDecisionNotificationEmail({
    to: decided.requester.email,
    requesterName: decided.requester.name,
    organizationName: decided.organization.name,
    approverName: membership.user.displayName ?? membership.user.email,
    requestTitle: decided.displayTitle,
    requestId: result.requestId,
    decision: result.status,
    reason: body.reason ?? null,
  }).catch((error: unknown) => {
    console.error(`[verity] ${ctx.correlationId} decision notification failed`, error);
  });

  return okResponse(
    {
      requestId: result.requestId,
      status: result.status,
      receiptId: result.receiptId,
      decidedAt: result.decidedAt,
      approver: { id: result.approver.id, displayName: result.approver.displayName },
    },
    ctx.correlationId,
  );
});
