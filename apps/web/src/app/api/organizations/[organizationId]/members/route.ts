import { listMembers, requireMembership } from '@verity/domain';
import { organizationIdSchema } from '@verity/schemas';
import { okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ organizationId: string }> };

export const GET = routeHandler(async (_request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { organizationId } = await params;
  const membership = await requireMembership(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    ctx,
  );

  const members = await listMembers(membership);
  return okResponse({ members }, ctx.correlationId);
});
