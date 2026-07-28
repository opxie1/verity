import { randomUUID } from 'node:crypto';
import { prisma, type OrgRole } from '@verity/database';
import type { RequestContext, SessionUser } from '@verity/domain';

/**
 * Fixtures create their own organizations and users with unique identifiers,
 * so test files never need to clean up after each other. That matters here:
 * the audit, receipt and decision tables reject DELETE and TRUNCATE by design,
 * so "wipe between tests" is not available.
 */

export function testContext(): RequestContext {
  return {
    correlationId: `corr_test_${randomUUID().replace(/-/g, '')}`,
    ipHash: null,
    userAgent: 'integration-test',
  };
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export async function createUser(
  options: { email?: string; displayName?: string; verified?: boolean } = {},
): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: options.email ?? uniqueEmail(),
      name: options.displayName ?? 'Test Person',
      emailVerified: options.verified === false ? null : new Date(),
      status: 'ACTIVE',
    },
    select: { id: true, email: true, name: true, status: true, emailVerified: true },
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerified,
  };
}

export async function createOrganizationWithAdmin(name?: string): Promise<{
  organizationId: string;
  admin: SessionUser;
}> {
  const admin = await createUser({ displayName: 'Admin Person' });
  const organizationName = name ?? `Org ${randomUUID().slice(0, 8)}`;

  const organization = await prisma.organization.create({
    data: {
      name: organizationName,
      slug: `org-${randomUUID()}`,
      policy: { create: {} },
      members: { create: { userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' } },
    },
    select: { id: true },
  });

  return { organizationId: organization.id, admin };
}

export async function addMember(
  organizationId: string,
  role: OrgRole,
  options: { displayName?: string } = {},
): Promise<SessionUser> {
  const user = await createUser({ displayName: options.displayName ?? `${role} Person` });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, role, status: 'ACTIVE' },
  });
  return user;
}
