import { listEligibleApprovers, requireMembership } from '@verity/domain';
import { organizationIdSchema } from '@verity/schemas';
import { corsPreflight, extensionRouteHandler, okResponse, parseOrThrow } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

export const OPTIONS = async (request: Request) => corsPreflight(request);

export const GET = extensionRouteHandler(async (request, ctx) => {
  const user = await requireSessionUser();
  const url = new URL(request.url);

  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, url.searchParams.get('organizationId')),
    ctx,
  );

  const approvers = await listEligibleApprovers(membership);
  return okResponse({ approvers }, ctx.correlationId);
});
