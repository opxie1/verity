import { prisma } from '@verity/database';
import {
  DomainError,
  createOrganization,
  listMembers,
  requireMembership,
  updateMember,
} from '@verity/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrganizationWithAdmin,
  createUser,
  testContext,
} from './setup/factories';

/**
 * Milestone 1 exit criterion: two users can join the same organization, and
 * users in different organizations cannot reach each other's records
 * (PRD FR-002).
 */
describe('organization isolation', () => {
  let orgA: { organizationId: string; admin: Awaited<ReturnType<typeof createUser>> };
  let orgB: { organizationId: string; admin: Awaited<ReturnType<typeof createUser>> };

  beforeAll(async () => {
    orgA = await createOrganizationWithAdmin('Acme Consulting');
    orgB = await createOrganizationWithAdmin('Rival Holdings');
  });

  it('lets a member of an organization read its members', async () => {
    const membership = await requireMembership(orgA.admin, orgA.organizationId);
    const members = await listMembers(membership);

    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(orgA.admin.id);
  });

  it('refuses membership resolution for an organization the user does not belong to', async () => {
    await expect(requireMembership(orgA.admin, orgB.organizationId)).rejects.toMatchObject({
      code: 'ORGANIZATION_ACCESS_DENIED',
    });
  });

  it('reports a fabricated organization id the same way as one that exists', async () => {
    const fabricated = requireMembership(orgA.admin, 'org_00000000000000000000000000000000');
    const realButForeign = requireMembership(orgA.admin, orgB.organizationId);

    const [fabricatedError, foreignError] = await Promise.all([
      fabricated.catch((error: DomainError) => error),
      realButForeign.catch((error: DomainError) => error),
    ]);

    // Identical responses, so organization IDs cannot be probed for existence.
    expect(fabricatedError.code).toBe(foreignError.code);
    expect(fabricatedError.message).toBe(foreignError.message);
  });

  it('refuses to update a member belonging to another organization', async () => {
    const foreignMember = await addMember(orgB.organizationId, 'REQUESTER');
    const foreignMembership = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgB.organizationId, userId: foreignMember.id },
      select: { id: true },
    });

    const membershipA = await requireMembership(orgA.admin, orgA.organizationId);

    await expect(
      updateMember(membershipA, foreignMembership.id, { role: 'ORG_ADMIN' }, testContext()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // And the foreign record is untouched.
    const unchanged = await prisma.organizationMember.findUniqueOrThrow({
      where: { id: foreignMembership.id },
      select: { role: true },
    });
    expect(unchanged.role).toBe('REQUESTER');
  });

  it('supports two users in the same organization', async () => {
    const colleague = await addMember(orgA.organizationId, 'APPROVER', {
      displayName: 'Jane Smith',
    });

    const adminView = await listMembers(await requireMembership(orgA.admin, orgA.organizationId));
    const colleagueView = await listMembers(
      await requireMembership(colleague, orgA.organizationId),
    );

    expect(adminView.map((member) => member.userId).sort()).toEqual(
      colleagueView.map((member) => member.userId).sort(),
    );
    expect(adminView).toHaveLength(2);
  });

  it('records an authorization failure in the audit log when a cross-org access is attempted', async () => {
    const ctx = testContext();
    await requireMembership(orgA.admin, orgB.organizationId, ctx).catch(() => undefined);

    const event = await prisma.auditEvent.findFirst({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'AUTHORIZATION_FAILURE' },
    });

    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBe(orgA.admin.id);
  });
});

describe('organization creation', () => {
  it('refuses to create an organization for an unverified email address', async () => {
    const unverified = await createUser({ verified: false });

    await expect(
      createOrganization(
        { name: 'Unverified Co', administratorName: 'Nobody' },
        unverified,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('makes the creator an administrator and writes an audit record', async () => {
    const founder = await createUser({ displayName: '' });
    const ctx = testContext();

    const { organizationId } = await createOrganization(
      { name: 'Bright Path Advisors', administratorName: 'Alex Rivera' },
      founder,
      ctx,
    );

    const membership = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId: founder.id } },
    });
    expect(membership.role).toBe('ORG_ADMIN');
    expect(membership.status).toBe('ACTIVE');

    const policy = await prisma.organizationPolicy.findUnique({ where: { organizationId } });
    expect(policy?.allowSelfApproval).toBe(false);
    expect(policy?.requirePasskeyEnrollment).toBe(true);

    const event = await prisma.auditEvent.findFirst({
      where: { organizationId, eventType: 'ORGANIZATION_CREATED' },
    });
    expect(event?.requestCorrelationId).toBe(ctx.correlationId);
  });

  it('gives two organizations with the same name distinct slugs', async () => {
    const first = await createUser();
    const second = await createUser();

    const a = await createOrganization(
      { name: 'Duplicate Name Ltd', administratorName: 'One' },
      first,
      testContext(),
    );
    const b = await createOrganization(
      { name: 'Duplicate Name Ltd', administratorName: 'Two' },
      second,
      testContext(),
    );

    expect(a.slug).not.toBe(b.slug);
  });

  it('refuses to remove the last administrator', async () => {
    const { organizationId, admin } = await createOrganizationWithAdmin();
    const membership = await requireMembership(admin, organizationId);
    const own = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId: admin.id } },
      select: { id: true },
    });

    await expect(
      updateMember(membership, own.id, { role: 'REQUESTER' }, testContext()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      updateMember(membership, own.id, { status: 'DISABLED' }, testContext()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
