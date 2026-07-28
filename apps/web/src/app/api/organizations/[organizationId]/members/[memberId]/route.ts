import { requireMembershipWithPermission, updateMember } from '@verity/domain';
import { memberIdSchema, organizationIdSchema, updateMemberSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ organizationId: string; memberId: string }> };

export const PATCH = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { organizationId, memberId } = await params;

  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:member:update',
    ctx,
  );

  const input = await parseJsonBody(request, updateMemberSchema);
  const member = await updateMember(
    membership,
    parseOrThrow(memberIdSchema, memberId),
    input,
    ctx,
  );

  return okResponse(
    { member: { memberId: member.id, role: member.role, status: member.status } },
    ctx.correlationId,
  );
});
