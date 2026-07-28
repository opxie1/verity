import { prisma } from '@verity/database';
import {
  PERMISSIONS,
  permissionsForRole,
  recordAuditEvent,
  requireMembership,
  requirePermission,
  roleHasPermission,
  updateMember,
  type Permission,
} from '@verity/domain';
import { describe, expect, it } from 'vitest';
import { addMember, createOrganizationWithAdmin, testContext } from './setup/factories';

/** The role table from PRD section 12, asserted rather than described. */
describe('role permissions', () => {
  it('gives an auditor no way to change anything', async () => {
    const writePermissions: Permission[] = [
      'org:update',
      'org:invite',
      'org:member:update',
      'org:policy:update',
      'request:create',
      'request:cancel:own',
      'request:decide',
      'request:revoke:own',
    ];

    for (const permission of writePermissions) {
      expect(roleHasPermission('AUDITOR', permission)).toBe(false);
    }
    expect(roleHasPermission('AUDITOR', 'audit:read')).toBe(true);
    expect(roleHasPermission('AUDITOR', 'request:read:all')).toBe(true);
  });

  it('does not let a requester decide, and does not let an approver create', async () => {
    expect(roleHasPermission('REQUESTER', 'request:decide')).toBe(false);
    expect(roleHasPermission('APPROVER', 'request:create')).toBe(false);
  });

  it('does not let a non-administrator read the whole organization', async () => {
    expect(roleHasPermission('REQUESTER', 'request:read:all')).toBe(false);
    expect(roleHasPermission('APPROVER', 'request:read:all')).toBe(false);
  });

  it('grants the administrator every permission except none', async () => {
    const adminPermissions = permissionsForRole('ORG_ADMIN');
    for (const permission of PERMISSIONS) {
      expect(adminPermissions).toContain(permission);
    }
  });
});

describe('membership guards', () => {
  it('blocks a disabled member immediately', async () => {
    const { organizationId, admin } = await createOrganizationWithAdmin();
    const approver = await addMember(organizationId, 'APPROVER');

    // The approver can act while active.
    const before = await requireMembership(approver, organizationId);
    expect(() => requirePermission(before, 'request:decide')).not.toThrow();

    const adminMembership = await requireMembership(admin, organizationId);
    const approverMember = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId, userId: approver.id },
      select: { id: true },
    });
    await updateMember(adminMembership, approverMember.id, { status: 'DISABLED' }, testContext());

    // No cached session keeps them in: the very next resolution fails.
    await expect(requireMembership(approver, organizationId)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('blocks a user whose account has been disabled outright', async () => {
    const { organizationId } = await createOrganizationWithAdmin();
    const member = await addMember(organizationId, 'REQUESTER');

    await expect(
      requireMembership({ ...member, status: 'DISABLED' }, organizationId),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('records a role change with both the previous and the new value', async () => {
    const { organizationId, admin } = await createOrganizationWithAdmin();
    const member = await addMember(organizationId, 'REQUESTER');
    const adminMembership = await requireMembership(admin, organizationId);
    const record = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId, userId: member.id },
      select: { id: true },
    });

    const ctx = testContext();
    await updateMember(adminMembership, record.id, { role: 'APPROVER' }, ctx);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'ROLE_CHANGED' },
    });
    expect(event.previousState).toBe('REQUESTER');
    expect(event.newState).toBe('APPROVER');
  });
});

describe('audit records', () => {
  it('cannot be modified or deleted, even by the application', async () => {
    const { organizationId, admin } = await createOrganizationWithAdmin();
    const ctx = testContext();

    await recordAuditEvent({
      organizationId,
      actorUserId: admin.id,
      eventType: 'ORGANIZATION_CREATED',
      targetType: 'Organization',
      targetId: organizationId,
      ctx,
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId },
    });

    await expect(
      prisma.auditEvent.update({
        where: { id: event.id },
        data: { eventType: 'REQUEST_APPROVED' },
      }),
    ).rejects.toThrow(/append-only/);

    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    );

    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_events')).rejects.toThrow(/append-only/);

    const survivor = await prisma.auditEvent.findUnique({ where: { id: event.id } });
    expect(survivor?.eventType).toBe('ORGANIZATION_CREATED');
  });
});
