import { prisma } from '@verity/database';
import { createInvitation, listInvitations, requireMembershipWithPermission } from '@verity/domain';
import { createInvitationSchema, organizationIdSchema } from '@verity/schemas';
import {
  assertAllowedOrigin,
  okResponse,
  parseJsonBody,
  parseOrThrow,
  routeHandler,
} from '@/lib/api';
import { sendInvitationEmail } from '@/lib/email/templates';
import { requireSessionUser } from '@/lib/session';

type Params = { params: Promise<{ organizationId: string }> };

export const GET = routeHandler(async (_request, ctx, { params }: Params) => {
  const user = await requireSessionUser();
  const { organizationId } = await params;
  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:invite',
    ctx,
  );

  const invitations = await listInvitations(membership);
  return okResponse({ invitations }, ctx.correlationId);
});

export const POST = routeHandler(async (request, ctx, { params }: Params) => {
  assertAllowedOrigin(request);
  const user = await requireSessionUser();
  const { organizationId } = await params;
  const membership = await requireMembershipWithPermission(
    user,
    parseOrThrow(organizationIdSchema, organizationId),
    'org:invite',
    ctx,
  );

  const input = await parseJsonBody(request, createInvitationSchema);
  const invitation = await createInvitation(membership, input, ctx);

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

  // The raw token is deliberately absent from the response: it belongs in the
  // invited person's mailbox and nowhere else.
  return okResponse(
    {
      invitation: {
        invitationId: invitation.invitationId,
        email: invitation.email,
        role: invitation.role,
        status: 'PENDING',
        expiresAt: invitation.expiresAt,
      },
    },
    ctx.correlationId,
    201,
  );
});
