import { verifyPasskeyAssertion } from '@verity/domain';
import { authenticationResponseSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseJsonBody, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';
import { webAuthnConfig } from '@/lib/webauthn';

export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const response = await parseJsonBody(request, authenticationResponseSchema);

  const assertion = await verifyPasskeyAssertion(user, response, webAuthnConfig);

  return okResponse(
    { verified: true, credential: { label: assertion.credential.label } },
    ctx.correlationId,
  );
});
