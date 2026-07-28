import { prisma, type Invitation, type OrgRole } from '@verity/database';
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  InvitationStatusValue,
} from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../authz/guards';
import type { MembershipContext, RequestContext, SessionUser } from '../context';
import { generateInvitationToken, hashToken } from '../crypto/tokens';
import { DomainError } from '../errors';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Status is derived so that "expired" is always evaluated against now. */
export function invitationStatus(
  invitation: Pick<Invitation, 'acceptedAt' | 'revokedAt' | 'expiresAt'>,
  now: Date = new Date(),
): InvitationStatusValue {
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.acceptedAt) return 'ACCEPTED';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

export interface CreatedInvitation {
  invitationId: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
  /**
   * The raw token, returned exactly once so the caller can put it in the
   * invitation email. It is not stored and cannot be retrieved again.
   */
  token: string;
}

export async function createInvitation(
  membership: MembershipContext,
  input: CreateInvitationInput,
  ctx: RequestContext,
): Promise<CreatedInvitation> {
  requirePermission(membership, 'org:invite');

  const existingMember = await prisma.organizationMember.findFirst({
    where: { organizationId: membership.organizationId, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) {
    throw new DomainError('CONFLICT', {
      message: 'That person is already a member of this organization.',
      fieldErrors: { email: ['This person is already a member.'] },
    });
  }

  const openInvitation = await prisma.invitation.findFirst({
    where: {
      organizationId: membership.organizationId,
      email: input.email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (openInvitation) {
    throw new DomainError('CONFLICT', {
      message: 'An invitation is already pending for that address. Resend it instead.',
      fieldErrors: { email: ['An invitation is already pending for this address.'] },
    });
  }

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        organizationId: membership.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedByUserId: membership.user.id,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'INVITATION_CREATED',
        targetType: 'Invitation',
        targetId: created.id,
        // The token itself is never written to an audit record or a log.
        metadata: { email: created.email, role: created.role },
        newState: 'PENDING',
        ctx,
      },
      tx,
    );

    return created;
  });

  return {
    invitationId: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    token,
  };
}

export async function listInvitations(membership: MembershipContext) {
  requirePermission(membership, 'org:invite');

  const invitations = await prisma.invitation.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      invitedBy: { select: { name: true, email: true } },
    },
  });

  return invitations.map((invitation) => ({
    invitationId: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitationStatus(invitation),
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitedByDisplayName: invitation.invitedBy.name ?? invitation.invitedBy.email,
  }));
}

/**
 * Issues a fresh token for an open invitation. The previous token stops working
 * immediately, since only one hash is stored per invitation.
 */
export async function resendInvitation(
  membership: MembershipContext,
  invitationId: string,
  ctx: RequestContext,
): Promise<CreatedInvitation> {
  requirePermission(membership, 'org:invite');

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });

    if (!existing || existing.organizationId !== membership.organizationId) {
      throw new DomainError('INVITATION_NOT_FOUND');
    }
    if (existing.acceptedAt) {
      throw new DomainError('INVITATION_ALREADY_ACCEPTED');
    }
    if (existing.revokedAt) {
      throw new DomainError('INVITATION_REVOKED');
    }

    const updated = await tx.invitation.update({
      where: { id: existing.id },
      data: { tokenHash: hashToken(token), expiresAt },
      select: { id: true, email: true, role: true, expiresAt: true },
    });

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'INVITATION_RESENT',
        targetType: 'Invitation',
        targetId: updated.id,
        metadata: { email: updated.email },
        ctx,
      },
      tx,
    );

    return {
      invitationId: updated.id,
      email: updated.email,
      role: updated.role,
      expiresAt: updated.expiresAt,
      token,
    };
  });
}

export async function revokeInvitation(
  membership: MembershipContext,
  invitationId: string,
  ctx: RequestContext,
): Promise<void> {
  requirePermission(membership, 'org:invite');

  await prisma.$transaction(async (tx) => {
    const existing = await tx.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, organizationId: true, email: true, acceptedAt: true, revokedAt: true },
    });

    if (!existing || existing.organizationId !== membership.organizationId) {
      throw new DomainError('INVITATION_NOT_FOUND');
    }
    if (existing.acceptedAt) {
      throw new DomainError('INVITATION_ALREADY_ACCEPTED', {
        message: 'That invitation has already been accepted. Disable the member instead.',
      });
    }
    if (existing.revokedAt) {
      return;
    }

    await tx.invitation.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'INVITATION_REVOKED',
        targetType: 'Invitation',
        targetId: existing.id,
        metadata: { email: existing.email },
        previousState: 'PENDING',
        newState: 'REVOKED',
        ctx,
      },
      tx,
    );
  });
}

/** Read-only preview shown on the invitation landing page before sign-in. */
export async function peekInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invitation) {
    throw new DomainError('INVITATION_NOT_FOUND');
  }

  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
    status: invitationStatus(invitation),
  };
}

/**
 * Accepts an invitation and creates the membership (PRD 14.1).
 *
 * Two properties matter here:
 *
 *   - Single use. `acceptedAt` is set inside the same transaction that creates
 *     the membership, and the update is conditional on it still being null, so
 *     two concurrent redemptions cannot both succeed.
 *   - Bound to the invited address. Possession of the link is not enough; the
 *     signed-in account's verified email must match the invited email.
 *     Otherwise a forwarded or intercepted link would let anyone join.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  actor: SessionUser,
  ctx: RequestContext,
): Promise<{ organizationId: string }> {
  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    });

    if (!invitation) {
      throw new DomainError('INVITATION_NOT_FOUND');
    }
    if (invitation.revokedAt) {
      throw new DomainError('INVITATION_REVOKED');
    }
    if (invitation.acceptedAt) {
      throw new DomainError('INVITATION_ALREADY_ACCEPTED');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('INVITATION_EXPIRED');
    }

    if (actor.email.toLowerCase() !== invitation.email.toLowerCase()) {
      await recordAuditEvent(
        {
          organizationId: invitation.organizationId,
          actorUserId: actor.id,
          eventType: 'AUTHORIZATION_FAILURE',
          targetType: 'Invitation',
          targetId: invitation.id,
          metadata: { reason: 'email_mismatch' },
          ctx,
        },
        tx,
      );
      throw new DomainError('UNAUTHORIZED', {
        message: `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      });
    }

    if (!actor.emailVerifiedAt) {
      throw new DomainError('UNAUTHORIZED', {
        message: 'Verify your email address before joining an organization.',
      });
    }

    // Conditional update: claims the invitation only if it is still unclaimed.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new DomainError('INVITATION_ALREADY_ACCEPTED');
    }

    await tx.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId: actor.id,
        },
      },
      create: {
        organizationId: invitation.organizationId,
        userId: actor.id,
        role: invitation.role,
        status: 'ACTIVE',
      },
      update: { role: invitation.role, status: 'ACTIVE' },
    });

    await tx.user.update({
      where: { id: actor.id },
      data: {
        status: 'ACTIVE',
        ...(actor.displayName || !input.displayName ? {} : { name: input.displayName }),
      },
    });

    await recordAuditEvent(
      {
        organizationId: invitation.organizationId,
        actorUserId: actor.id,
        eventType: 'INVITATION_ACCEPTED',
        targetType: 'Invitation',
        targetId: invitation.id,
        metadata: { email: invitation.email, role: invitation.role },
        previousState: 'PENDING',
        newState: 'ACCEPTED',
        ctx,
      },
      tx,
    );

    return { organizationId: invitation.organizationId };
  });
}
