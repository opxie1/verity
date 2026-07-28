import { listOrganizationsForUser, roleHasPermission } from '@verity/domain';
import { corsPreflight, extensionRouteHandler, okResponse } from '@/lib/api';
import { enabledActionTypes } from '@/lib/env';
import { getSessionUser } from '@/lib/session';

export const OPTIONS = async (request: Request) => corsPreflight(request);

/**
 * Tells the panel who is signed in (PRD 21.7).
 *
 * Answers 200 with `signedIn: false` rather than 401 when there is no session,
 * because "nobody is signed in" is a normal state for a panel that is always
 * open, not an error worth logging on every Gmail page load.
 */
export const GET = extensionRouteHandler(async (_request, ctx) => {
  const user = await getSessionUser();

  if (!user) {
    return okResponse(
      { signedIn: false, user: null, organizations: [], enabledActionTypes },
      ctx.correlationId,
    );
  }

  const organizations = await listOrganizationsForUser(user.id);

  return okResponse(
    {
      signedIn: true,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      organizations: organizations.map((organization) => ({
        organizationId: organization.organizationId,
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
        canCreateRequests: roleHasPermission(organization.role, 'request:create'),
      })),
      enabledActionTypes,
    },
    ctx.correlationId,
  );
});
