import { requireMembership, startRevocation } from '@verity/domain';
import { organizationIdSchema, requestIdSchema } from '@verity/schemas';
import { z } from 'zod';
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

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  enforceRateLimit(RATE_LIMITS.decision, user.id);

  const body = await parseJsonBody(request, z.object({ organizationId: organizationIdSchema }));
  const membership = await requireMembership(user, body.organizationId, ctx);

  const result = await startRevocation(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    webAuthnConfig,
    ctx,
  );

  return okResponse(
    { options: result.options, challengeId: result.challengeId },
    ctx.correlationId,
  );
});
