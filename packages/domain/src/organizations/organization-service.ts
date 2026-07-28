import { Prisma, prisma } from '@verity/database';
import type {
  CreateOrganizationInput,
  UpdateMemberInput,
  UpdateOrganizationInput,
  UpdateOrganizationPolicyInput,
} from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../authz/guards';
import type { MembershipContext, RequestContext, SessionUser } from '../context';
import { DomainError } from '../errors';

function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    // Strip combining diacritics left behind by NFKD decomposition.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'organization';
}

function randomSuffix(): string {
  return Math.floor(Math.random() * 1e6)
    .toString(36)
    .padStart(4, '0');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Creates an organization and makes the caller its first administrator
 * (PRD 14.1).
 *
 * The caller must have a verified email address: everything downstream —
 * invitations, approver notifications — is addressed by email, so an
 * unverified address would let someone seed an organization they do not
 * control.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
  actor: SessionUser,
  ctx: RequestContext,
): Promise<{ organizationId: string; slug: string }> {
  if (!actor.emailVerifiedAt) {
    throw new DomainError('UNAUTHORIZED', {
      message: 'Verify your email address before creating an organization.',
    });
  }

  const baseSlug = slugify(input.name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`;
    try {
      return await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: input.name,
            slug,
            domain: input.domain ?? null,
            // Defaults come from the schema; PRD FR-020 lets an administrator
            // change them afterwards.
            policy: { create: {} },
          },
          select: { id: true, slug: true },
        });

        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: actor.id,
            role: 'ORG_ADMIN',
            status: 'ACTIVE',
          },
        });

        await tx.user.update({
          where: { id: actor.id },
          data: {
            status: 'ACTIVE',
            ...(actor.displayName ? {} : { name: input.administratorName }),
          },
        });

        await recordAuditEvent(
          {
            organizationId: organization.id,
            actorUserId: actor.id,
            eventType: 'ORGANIZATION_CREATED',
            targetType: 'Organization',
            targetId: organization.id,
            metadata: { name: input.name, slug: organization.slug },
            newState: 'ACTIVE',
            ctx,
          },
          tx,
        );

        return { organizationId: organization.id, slug: organization.slug };
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) {
        continue;
      }
      throw error;
    }
  }

  throw new DomainError('CONFLICT', {
    message: 'Could not create the organization. Try a slightly different name.',
  });
}

export async function listOrganizationsForUser(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role,
    organizationId: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
  }));
}

export async function getOrganization(membership: MembershipContext) {
  requirePermission(membership, 'org:read');
  const organization = await prisma.organization.findUnique({
    where: { id: membership.organizationId },
    include: { policy: true },
  });
  if (!organization) {
    throw new DomainError('NOT_FOUND');
  }
  return organization;
}

export async function updateOrganization(
  membership: MembershipContext,
  input: UpdateOrganizationInput,
  ctx: RequestContext,
) {
  requirePermission(membership, 'org:update');

  const updated = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.update({
      where: { id: membership.organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.domain !== undefined ? { domain: input.domain } : {}),
      },
    });

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'ORGANIZATION_SETTINGS_UPDATED',
        targetType: 'Organization',
        targetId: membership.organizationId,
        metadata: { fields: Object.keys(input) },
        ctx,
      },
      tx,
    );

    return organization;
  });

  return updated;
}

export async function listMembers(membership: MembershipContext) {
  requirePermission(membership, 'org:read');

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          _count: { select: { passkeys: { where: { revokedAt: null } } } },
        },
      },
    },
  });

  return members.map((member) => ({
    memberId: member.id,
    userId: member.user.id,
    email: member.user.email,
    displayName: member.user.name,
    role: member.role,
    status: member.status,
    userStatus: member.user.status,
    passkeyCount: member.user._count.passkeys,
    hasEnrolledPasskey: member.user._count.passkeys > 0,
    joinedAt: member.createdAt,
  }));
}

/**
 * Members eligible to be assigned as the approver on a request: active members
 * whose role carries `request:decide`.
 */
export async function listEligibleApprovers(membership: MembershipContext) {
  requirePermission(membership, 'org:read');

  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: membership.organizationId,
      status: 'ACTIVE',
      role: { in: ['ORG_ADMIN', 'APPROVER'] },
      user: { status: 'ACTIVE' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          _count: { select: { passkeys: { where: { revokedAt: null } } } },
        },
      },
    },
  });

  return members.map((member) => ({
    userId: member.user.id,
    email: member.user.email,
    displayName: member.user.name,
    hasEnrolledPasskey: member.user._count.passkeys > 0,
  }));
}

/**
 * Changes a member's role or status (PRD FR-004).
 *
 * Refuses to remove the last administrator, which would leave the organization
 * with no one able to manage members or policy.
 */
export async function updateMember(
  membership: MembershipContext,
  memberId: string,
  input: UpdateMemberInput,
  ctx: RequestContext,
) {
  requirePermission(membership, 'org:member:update');

  return prisma.$transaction(async (tx) => {
    const target = await tx.organizationMember.findUnique({
      where: { id: memberId },
      select: { id: true, organizationId: true, userId: true, role: true, status: true },
    });

    if (!target || target.organizationId !== membership.organizationId) {
      throw new DomainError('NOT_FOUND', { message: 'That member is not in this organization.' });
    }

    const losesAdmin =
      target.role === 'ORG_ADMIN' &&
      ((input.role !== undefined && input.role !== 'ORG_ADMIN') || input.status === 'DISABLED');

    if (losesAdmin) {
      const remainingAdmins = await tx.organizationMember.count({
        where: {
          organizationId: membership.organizationId,
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
          id: { not: target.id },
        },
      });
      if (remainingAdmins === 0) {
        throw new DomainError('CONFLICT', {
          message: 'An organization must keep at least one active administrator.',
        });
      }
    }

    const updated = await tx.organizationMember.update({
      where: { id: target.id },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    if (input.role !== undefined && input.role !== target.role) {
      await recordAuditEvent(
        {
          organizationId: membership.organizationId,
          actorUserId: membership.user.id,
          eventType: 'ROLE_CHANGED',
          targetType: 'OrganizationMember',
          targetId: target.id,
          metadata: { userId: target.userId },
          previousState: target.role,
          newState: input.role,
          ctx,
        },
        tx,
      );
    }

    if (input.status !== undefined && input.status !== target.status) {
      await recordAuditEvent(
        {
          organizationId: membership.organizationId,
          actorUserId: membership.user.id,
          eventType: input.status === 'DISABLED' ? 'USER_DISABLED' : 'USER_REACTIVATED',
          targetType: 'OrganizationMember',
          targetId: target.id,
          metadata: { userId: target.userId },
          previousState: target.status,
          newState: input.status,
          ctx,
        },
        tx,
      );
    }

    return updated;
  });
}

export async function updateOrganizationPolicy(
  membership: MembershipContext,
  input: UpdateOrganizationPolicyInput,
  ctx: RequestContext,
) {
  requirePermission(membership, 'org:policy:update');

  return prisma.$transaction(async (tx) => {
    const existing = await tx.organizationPolicy.findUnique({
      where: { organizationId: membership.organizationId },
    });
    if (!existing) {
      throw new DomainError('NOT_FOUND');
    }

    const nextDefault = input.defaultExpirationMinutes ?? existing.defaultExpirationMinutes;
    const nextMaximum = input.maximumExpirationMinutes ?? existing.maximumExpirationMinutes;
    if (nextDefault > nextMaximum) {
      throw new DomainError('VALIDATION_FAILED', {
        fieldErrors: {
          defaultExpirationMinutes: [
            'The default expiration cannot be longer than the maximum expiration.',
          ],
        },
      });
    }

    const updated = await tx.organizationPolicy.update({
      where: { organizationId: membership.organizationId },
      data: {
        ...(input.allowSelfApproval !== undefined
          ? { allowSelfApproval: input.allowSelfApproval }
          : {}),
        ...(input.defaultExpirationMinutes !== undefined
          ? { defaultExpirationMinutes: input.defaultExpirationMinutes }
          : {}),
        ...(input.maximumExpirationMinutes !== undefined
          ? { maximumExpirationMinutes: input.maximumExpirationMinutes }
          : {}),
        ...(input.requirePasskeyEnrollment !== undefined
          ? { requirePasskeyEnrollment: input.requirePasskeyEnrollment }
          : {}),
        ...(input.verificationRecommendedThresholdMinor !== undefined
          ? {
              verificationRecommendedThresholdMinor:
                input.verificationRecommendedThresholdMinor === null
                  ? null
                  : BigInt(input.verificationRecommendedThresholdMinor),
            }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });

    await recordAuditEvent(
      {
        organizationId: membership.organizationId,
        actorUserId: membership.user.id,
        eventType: 'POLICY_UPDATED',
        targetType: 'OrganizationPolicy',
        targetId: updated.id,
        metadata: { fields: Object.keys(input) },
        ctx,
      },
      tx,
    );

    return updated;
  });
}

export async function getOrganizationPolicy(organizationId: string) {
  const policy = await prisma.organizationPolicy.findUnique({ where: { organizationId } });
  if (!policy) {
    throw new DomainError('NOT_FOUND', { internalDetail: `no policy for ${organizationId}` });
  }
  return policy;
}
