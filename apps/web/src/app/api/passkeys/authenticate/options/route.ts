import { startPasskeyAuthentication } from '@verity/domain';
import { assertAllowedOrigin, okResponse, routeHandler } from '@/lib/api';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

/**
 * Issues an authentication challenge for confirming presence — used to check
 * that a newly registered passkey actually works.
 *
 * Approving a request does not go through here: that challenge additionally
 * binds the request, its payload hash and the decision, and is issued by
 * `/api/requests/:requestId/decision/options` (PRD FR-010).
 */
export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  enforceRateLimit(RATE_LIMITS.passkey, user.id);

  const options = await startPasskeyAuthentication(user, webAuthnConfig);

  return okResponse({ options }, ctx.correlationId);
});
