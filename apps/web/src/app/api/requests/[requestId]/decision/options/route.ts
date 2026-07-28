import { requireMembership, startDecision } from '@verity/domain';
import { z } from 'zod';
import { organizationIdSchema, requestIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

type Params = { params: Promise<{ requestId: string }> };

const bodySchema = z.object({
  organizationId: organizationIdSchema,
  decision: z.enum(['APPROVE', 'DENY']),
});

/**
 * Issues the WebAuthn challenge for a decision (PRD 21.4, FR-010).
 *
 * The decision is part of the request body and gets bound into the challenge,
 * so the assertion that comes back can only be spent on the answer the
 * approver actually chose.
 */
export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  enforceRateLimit(RATE_LIMITS.decision, user.id);

  const body = await parseJsonBody(request, bodySchema);
  const membership = await requireMembership(user, body.organizationId, ctx);

  const result = await startDecision(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    body.decision,
    webAuthnConfig,
    ctx,
  );

  return okResponse(
    {
      options: result.options,
      challengeId: result.challengeId,
      payloadHash: result.payloadHash,
      expiresAt: result.expiresAt,
    },
    ctx.correlationId,
  );
});
