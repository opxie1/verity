import { requireMembershipWithPermission, updateOrganizationPolicy } from '@verity/domain';
import { organizationIdSchema, updateOrganizationPolicySchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ organizationId: string }> };

export const PATCH = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { organizationId } = await params;

  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:policy:update',
    ctx,
  );

  const input = await parseJsonBody(request, updateOrganizationPolicySchema);
  const policy = await updateOrganizationPolicy(membership, input, ctx);

  return okResponse({ policy }, ctx.correlationId);
});
