import { cancelRequest, requireMembership } from '@verity/domain';
import { cancelRequestSchema, organizationIdSchema, requestIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  corsPreflight,
  extensionRouteHandler,
  okResponse,
  parseJsonBody,
  parseOrThrow,
} from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ requestId: string }> };

export const OPTIONS = async (request: Request) => corsPreflight(request);

/**
 * Lets the requester withdraw a pending request from the Gmail panel.
 *
 * Cancelling is the one state change the panel can make, and it only ever
 * reduces authority. Approving and denying are not reachable from here: they
 * happen on the Verity page, against details loaded from the server
 * (PRD 18.9, 23.4).
 */
export const POST = extensionRouteHandler(async (request, ctx, { params }: Params) => {
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
