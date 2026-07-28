import {
  getOrganization,
  requireMembership,
  requireMembershipWithPermission,
  updateOrganization,
} from '@verity/domain';
import { organizationIdSchema, updateOrganizationSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
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

  const organization = await getOrganization(membership);

  return okResponse(
    {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        domain: organization.domain,
        createdAt: organization.createdAt,
      },
      policy: organization.policy,
      viewer: { role: membership.role, memberStatus: membership.memberStatus },
    },
    ctx.correlationId,
  );
});

export const PATCH = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { organizationId } = await params;
  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:update',
    ctx,
  );

  const input = await parseJsonBody(request, updateOrganizationSchema);
  const organization = await updateOrganization(membership, input, ctx);

  return okResponse(
    {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        domain: organization.domain,
      },
    },
    ctx.correlationId,
  );
});
