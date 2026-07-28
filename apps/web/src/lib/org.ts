import 'server-only';
import { prisma } from '@verity/database';
import { DomainError, requireMembership, type MembershipContext, type SessionUser } from '@verity/domain';

/**
 * Resolves a URL slug to an organization the caller actually belongs to.
 *
 * The lookup is scoped to the caller's own memberships, so an unknown or
 * someone else's slug is indistinguishable from one that does not exist
 * (PRD FR-002).
 */
export async function membershipForSlug(
  user: SessionUser,
  slug: string,
): Promise<MembershipContext & { organizationName: string; organizationSlug: string }> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id, organization: { slug } },
    select: {
      organizationId: true,
      organization: { select: { name: true, slug: true } },
    },
  });

  if (!membership) {
    throw new DomainError('ORGANIZATION_ACCESS_DENIED');
  }

  const resolved = await requireMembership(user, membership.organizationId);
  return {
    ...resolved,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
  };
}
