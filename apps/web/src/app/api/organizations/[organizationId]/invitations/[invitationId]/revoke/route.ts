import { requireMembershipWithPermission, revokeInvitation } from '@verity/domain';
import { invitationIdSchema, organizationIdSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ organizationId: string; invitationId: string }> };

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { organizationId, invitationId } = await params;

  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:invite',
    ctx,
  );

  await revokeInvitation(membership, parseOrThrow(invitationIdSchema, invitationId), ctx);

  return okResponse({ invitation: { invitationId, status: 'REVOKED' } }, ctx.correlationId);
});
