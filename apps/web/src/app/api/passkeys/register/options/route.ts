import { startPasskeyRegistration } from '@verity/domain';
import { assertAllowedOrigin, okResponse, routeHandler } from '@/lib/api';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

/**
 * Issues registration options. POST rather than GET because it creates a
 * server-side challenge, and a state-changing step must not be reachable by
 * navigation (PRD section 25).
 */
export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  enforceRateLimit(RATE_LIMITS.passkey, user.id);

  const options = await startPasskeyRegistration(user, webAuthnConfig);

  return okResponse({ options }, ctx.correlationId);
});
