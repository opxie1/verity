import { prisma } from '@verity/database';
import { requireMembershipWithPermission, resendInvitation } from '@verity/domain';
import { invitationIdSchema, organizationIdSchema } from '@verity/schemas';
import { assertAllowedOrigin, okResponse, parseOrThrow, routeHandler } from '@/lib/api';
import { sendInvitationEmail } from '@/lib/email/templates';
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

  const invitation = await resendInvitation(
    membership,
    parseOrThrow(invitationIdSchema, invitationId),
    ctx,
  );

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: membership.organizationId },
    select: { name: true },
  });

  await sendInvitationEmail({
    to: invitation.email,
    token: invitation.token,
    organizationName: organization.name,
    role: invitation.role,
    invitedByName: membership.user.displayName ?? membership.user.email,
    expiresAt: invitation.expiresAt,
  });

  return okResponse(
    {
      invitation: {
        invitationId: invitation.invitationId,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
      },
    },
    ctx.correlationId,
  );
});
