import { prisma } from '@verity/database';
import type { MembershipContext, RequestContext, SessionUser } from '../context';
import { DomainError } from '../errors';
import { recordAuditEvent } from '../audit/audit-service';
import { roleHasPermission, type Permission } from './permissions';

/**
 * Resolves the session user's membership in one organization, or throws.
 *
 * Every organization-scoped service call starts here. The `organizationId`
 * argument may come from a URL or a request body — it is never trusted; it is
 * only used as a lookup key against the caller's own memberships, so a
 * fabricated ID yields "no membership" rather than access (PRD FR-002).
 */
export async function requireMembership(
  user: SessionUser,
  organizationId: string,
  ctx?: RequestContext,
): Promise<MembershipContext> {
  if (user.status !== 'ACTIVE') {
    throw new DomainError('UNAUTHORIZED', {
      internalDetail: `user ${user.id} has status ${user.status}`,
    });
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    select: { id: true, role: true, status: true, organizationId: true },
  });

  if (!membership) {
    if (ctx) {
      await recordAuditEvent({
        organizationId: null,
        actorUserId: user.id,
        eventType: 'AUTHORIZATION_FAILURE',
        targetType: 'Organization',
        targetId: organizationId,
        metadata: { reason: 'not_a_member' },
        ctx,
      });
    }
    // Deliberately the same error whether the organization does not exist or
    // the caller simply is not in it, so IDs cannot be probed.
    throw new DomainError('ORGANIZATION_ACCESS_DENIED');
  }

  if (membership.status === 'DISABLED') {
    throw new DomainError('UNAUTHORIZED', {
      message: 'Your access to this organization has been disabled.',
    });
  }

  return {
    user,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
    memberStatus: membership.status,
  };
}

/** Throws unless the membership's role carries `permission`. */
export function requirePermission(
  membership: MembershipContext,
  permission: Permission,
): void {
  if (!roleHasPermission(membership.role, permission)) {
    throw new DomainError('UNAUTHORIZED', {
      internalDetail: `role ${membership.role} lacks ${permission}`,
    });
  }
}

/** Convenience combination used by most route handlers. */
export async function requireMembershipWithPermission(
  user: SessionUser,
  organizationId: string,
  permission: Permission,
  ctx?: RequestContext,
): Promise<MembershipContext> {
  const membership = await requireMembership(user, organizationId, ctx);
  requirePermission(membership, permission);
  return membership;
}

/**
 * Guards a record fetched by ID. Records are always loaded with an
 * `organizationId` selected, and this asserts it matches the caller's
 * membership before the record is used or returned.
 */
export function assertSameOrganization(
  membership: MembershipContext,
  record: { organizationId: string } | null,
  notFoundCode: 'REQUEST_NOT_FOUND' | 'NOT_FOUND' | 'INVITATION_NOT_FOUND' = 'NOT_FOUND',
): asserts record is { organizationId: string } {
  // A record in another organization is reported as missing rather than
  // forbidden, so that IDs cannot be enumerated across tenants.
  if (!record || record.organizationId !== membership.organizationId) {
    throw new DomainError(notFoundCode);
  }
}
