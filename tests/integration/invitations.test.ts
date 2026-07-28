import { prisma } from '@verity/database';
import {
  acceptInvitation,
  createInvitation,
  hashToken,
  listInvitations,
  peekInvitation,
  requireMembership,
  resendInvitation,
  revokeInvitation,
} from '@verity/domain';
import { describe, expect, it } from 'vitest';
import {
  addMember,
  createOrganizationWithAdmin,
  createUser,
  testContext,
  uniqueEmail,
} from './setup/factories';

async function adminMembership() {
  const { organizationId, admin } = await createOrganizationWithAdmin();
  return { organizationId, admin, membership: await requireMembership(admin, organizationId) };
}

describe('invitations', () => {
  it('stores only the hash of the token', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('invited');

    const invitation = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());

    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.invitationId },
      select: { tokenHash: true },
    });

    expect(stored.tokenHash).toBe(hashToken(invitation.token));
    expect(stored.tokenHash).not.toBe(invitation.token);
    expect(invitation.token).toHaveLength(43);
  });

  it('never writes the raw token into the audit record', async () => {
    const { membership } = await adminMembership();
    const ctx = testContext();
    const invitation = await createInvitation(
      membership,
      { email: uniqueEmail(), role: 'REQUESTER' },
      ctx,
    );

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'INVITATION_CREATED' },
    });

    expect(JSON.stringify(event.metadata)).not.toContain(invitation.token);
  });

  it('can be accepted once and only once', async () => {
    const { organizationId, membership } = await adminMembership();
    const email = uniqueEmail('joiner');
    const invitation = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());
    const joiner = await createUser({ email, displayName: '' });

    const accepted = await acceptInvitation(
      { token: invitation.token, displayName: 'Jane Smith' },
      joiner,
      testContext(),
    );
    expect(accepted.organizationId).toBe(organizationId);

    await expect(
      acceptInvitation({ token: invitation.token }, joiner, testContext()),
    ).rejects.toMatchObject({ code: 'INVITATION_ALREADY_ACCEPTED' });
  });

  it('refuses acceptance by an account other than the invited address', async () => {
    const { membership } = await adminMembership();
    const invitation = await createInvitation(
      membership,
      { email: uniqueEmail('intended'), role: 'APPROVER' },
      testContext(),
    );

    // Someone who obtained the link but is signed in as a different person.
    const interloper = await createUser();

    await expect(
      acceptInvitation({ token: invitation.token }, interloper, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const stillOpen = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.invitationId },
      select: { acceptedAt: true },
    });
    expect(stillOpen.acceptedAt).toBeNull();
  });

  it('refuses acceptance by an account with an unverified address', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('unverified');
    const invitation = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());
    const joiner = await createUser({ email, verified: false });

    await expect(
      acceptInvitation({ token: invitation.token }, joiner, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses an expired invitation', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('late');
    const invitation = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());

    await prisma.invitation.update({
      where: { id: invitation.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const joiner = await createUser({ email });
    await expect(
      acceptInvitation({ token: invitation.token }, joiner, testContext()),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });

  it('refuses a revoked invitation', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('revoked');
    const invitation = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());

    await revokeInvitation(membership, invitation.invitationId, testContext());

    const joiner = await createUser({ email });
    await expect(
      acceptInvitation({ token: invitation.token }, joiner, testContext()),
    ).rejects.toMatchObject({ code: 'INVITATION_REVOKED' });
  });

  it('invalidates the previous token when an invitation is resent', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('resent');
    const original = await createInvitation(membership, { email, role: 'APPROVER' }, testContext());

    const reissued = await resendInvitation(membership, original.invitationId, testContext());
    expect(reissued.token).not.toBe(original.token);

    const joiner = await createUser({ email });
    await expect(
      acceptInvitation({ token: original.token }, joiner, testContext()),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });

    await expect(
      acceptInvitation({ token: reissued.token }, joiner, testContext()),
    ).resolves.toMatchObject({ organizationId: membership.organizationId });
  });

  it('refuses to issue a second open invitation for the same address', async () => {
    const { membership } = await adminMembership();
    const email = uniqueEmail('dupe');
    await createInvitation(membership, { email, role: 'APPROVER' }, testContext());

    await expect(
      createInvitation(membership, { email, role: 'APPROVER' }, testContext()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to invite somebody who is already a member', async () => {
    const { organizationId, membership } = await adminMembership();
    const existing = await addMember(organizationId, 'REQUESTER');

    await expect(
      createInvitation(membership, { email: existing.email, role: 'APPROVER' }, testContext()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not let a requester invite anyone', async () => {
    const { organizationId } = await adminMembership();
    const requester = await addMember(organizationId, 'REQUESTER');
    const requesterMembership = await requireMembership(requester, organizationId);

    await expect(
      createInvitation(requesterMembership, { email: uniqueEmail(), role: 'APPROVER' }, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('derives status from timestamps rather than storing it', async () => {
    const { membership } = await adminMembership();
    const invitation = await createInvitation(
      membership,
      { email: uniqueEmail(), role: 'AUDITOR' },
      testContext(),
    );

    expect((await peekInvitation(invitation.token)).status).toBe('PENDING');

    await prisma.invitation.update({
      where: { id: invitation.invitationId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    expect((await peekInvitation(invitation.token)).status).toBe('EXPIRED');

    const listed = await listInvitations(membership);
    expect(listed.find((row) => row.invitationId === invitation.invitationId)?.status).toBe(
      'EXPIRED',
    );
  });
});
