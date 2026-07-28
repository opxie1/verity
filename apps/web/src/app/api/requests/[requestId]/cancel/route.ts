import { cancelRequest, requireMembership } from '@verity/domain';
import { cancelRequestSchema, organizationIdSchema, requestIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { requestId } = await params;

  const body = await parseJsonBody(
    request,
    cancelRequestSchema.extend({ organizationId: organizationIdSchema }),
  );

  const membership = await requireMembership(user, body.organizationId, ctx);
  const result = await cancelRequest(
    membership,
    parseOrThrow(requestIdSchema, requestId),
    body,
    ctx,
  );

  return okResponse({ request: result }, ctx.correlationId);
});
