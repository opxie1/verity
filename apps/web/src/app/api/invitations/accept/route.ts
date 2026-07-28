import { prisma } from '@verity/database';
import { acceptInvitation } from '@verity/domain';
import { acceptInvitationSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseJsonBody, routeHandler } from '@/lib/api';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSessionUser } from '@/lib/session';

export const POST = routeHandler(async (request, ctx) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  // Keyed to the account, so a single signed-in session cannot grind through
  // invitation tokens.
  enforceRateLimit(RATE_LIMITS.invitation, user.id);

  const input = await parseJsonBody(request, acceptInvitationSchema);

  const { organizationId } = await acceptInvitation(input, user, ctx);

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });

  return okResponse({ organization }, ctx.correlationId);
});
