import { prisma } from '@verity/database';
import { completeRevocation, requireMembership } from '@verity/domain';
import {
  authenticationResponseSchema,
  organizationIdSchema,
  requestIdSchema,
  requiredText,
} from '@verity/schemas';
import { z } from 'zod';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { sendRevocationNotificationEmail } from '@/lib/email/templates';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

type Params = { params: Promise<{ requestId: string }> };

const bodySchema = z.object({
  organizationId: organizationIdSchema,
  response: authenticationResponseSchema,
  // A reason is required, not optional: whoever acted on the approval needs to
  // know why it was withdrawn (PRD 14.6 step 3).
  reason: requiredText(500, 'Say why you are revoking this approval'),
});

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  enforceRateLimit(RATE_LIMITS.decision, user.id);

  const body = await parseJsonBody(request, bodySchema);
  const membership = await requireMembership(user, body.organizationId, ctx);

  const result = await completeRevocation(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    { response: body.response, reason: body.reason },
    webAuthnConfig,
    ctx,
  );

  // The requester and every administrator are told, because someone may
  // already be acting on the approval that has just been withdrawn.
  const revoked = await prisma.verificationRequest.findUniqueOrThrow({
    where: { id: result.requestId },
    select: {
      displayTitle: true,
      requester: { select: { email: true } },
      organization: {
        select: {
          name: true,
          members: {
            where: { role: 'ORG_ADMIN', status: 'ACTIVE' },
            select: { user: { select: { email: true } } },
          },
        },
      },
    },
  });

  const recipients = new Set<string>([
    revoked.requester.email,
    ...revoked.organization.members.map((member) => member.user.email),
  ]);

  await Promise.all(
    [...recipients].map((to) =>
      sendRevocationNotificationEmail({
        to,
        organizationName: revoked.organization.name,
        revokedByName: membership.user.displayName ?? membership.user.email,
        requestTitle: revoked.displayTitle,
        requestId: result.requestId,
        reason: body.reason,
      }).catch((error: unknown) => {
        console.error(`[verity] ${ctx.correlationId} revocation notification failed`, error);
      }),
    ),
  );

  return okResponse(
    { requestId: result.requestId, status: result.status, revokedAt: result.revokedAt },
    ctx.correlationId,
  );
});
