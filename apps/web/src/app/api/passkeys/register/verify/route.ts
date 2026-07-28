import { completePasskeyRegistration } from '@verity/domain';
import { verifyPasskeyRegistrationSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseJsonBody, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const input = await parseJsonBody(request, verifyPasskeyRegistrationSchema);

  const passkey = await completePasskeyRegistration(user, input, webAuthnConfig, ctx);

  return okResponse({ passkey }, ctx.correlationId, 201);
});
