import { revokePasskey } from '@verity/domain';
import { credentialIdSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ credentialId: string }> };

export const DELETE = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { credentialId } = await params;

  await revokePasskey(user, parseOrThrow(credentialIdSchema, credentialId), ctx);

  return okResponse({ credentialId, removed: true }, ctx.correlationId);
});
