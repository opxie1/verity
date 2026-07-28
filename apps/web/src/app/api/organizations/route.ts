import { createOrganization, listOrganizationsForUser } from '@verity/domain';
import { createOrganizationSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseJsonBody, routeHandler } from '@/lib/api';
import { requireSessionUser } from '@/lib/session';

export const GET = routeHandler(async (_request, ctx) => {
  const user = await requireSessionUser();
  const organizations = await listOrganizationsForUser(user.id);
  return okResponse({ organizations }, ctx.correlationId);
});

export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const input = await parseJsonBody(request, createOrganizationSchema);

  const { organizationId, slug } = await createOrganization(input, user, ctx);

  return okResponse({ organization: { id: organizationId, slug } }, ctx.correlationId, 201);
});
