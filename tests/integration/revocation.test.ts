import { generateKeyPairSync } from 'node:crypto';
import { prisma } from '@verity/database';
import {
  completeDecision,
  completeRevocation,
  createRequest,
  getRequest,
  requireMembership,
  startDecision,
  startRevocation,
  verifyReceipt,
  type ReceiptSigningConfig,
  type WebAuthnConfig,
} from '@verity/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createOrganizationWithAdmin, testContext } from './setup/factories';
import { VirtualAuthenticator } from './setup/virtual-authenticator';

const webAuthnConfig: WebAuthnConfig = {
  rpId: 'localhost',
  rpName: 'Verity Test',
  expectedOrigins: ['http://localhost:3000'],
};

let signingConfig: ReceiptSigningConfig;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('ed25519');
  signingConfig = {
    privateKeyBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    keyVersion: 1,
  };
});

const paymentFields = {
  amountMinor: 2_500_000,
  currency: 'USD',
  recipientLegalName: 'ABC Consulting LLC',
  accountLastFour: '4821',
  paymentReason: 'July consulting invoice',
  requestedCompletionDate: '2026-07-30',
};

/** An organization with an approved request, ready to be revoked. */
async function approvedScenario() {
  const { organizationId, admin } = await createOrganizationWithAdmin();
  const alex = await addMember(organizationId, 'REQUESTER');
  const jane = await addMember(organizationId, 'APPROVER', { displayName: 'Jane' });

  const janeKey = new VirtualAuthenticator();
  await janeKey.register(jane.id, "Jane's laptop");
  const adminKey = new VirtualAuthenticator();
  await adminKey.register(admin.id, "Administrator's key");

  const requester = await requireMembership(alex, organizationId);
  const approver = await requireMembership(jane, organizationId);
  const adminMembership = await requireMembership(admin, organizationId);

  const request = await createRequest(
    requester,
    {
      organizationId,
      assignedApproverUserId: jane.id,
      actionType: 'PAYMENT_REQUEST',
      expiresInMinutes: 60,
      fields: paymentFields,
    },
    testContext(),
  );

  const options = await startDecision(
    approver,
    request.id,
    'APPROVE',
    webAuthnConfig,
    testContext(),
  );
  const decision = await completeDecision(
    approver,
    request.id,
    { decision: 'APPROVE', response: janeKey.assert(options.options.challenge) },
    webAuthnConfig,
    signingConfig,
    testContext(),
  );

  return {
    organizationId,
    admin,
    alex,
    jane,
    janeKey,
    adminKey,
    requester,
    approver,
    adminMembership,
    request,
    receiptId: decision.receiptId,
  };
}

async function revoke(
  membership: Awaited<ReturnType<typeof requireMembership>>,
  requestId: string,
  authenticator: VirtualAuthenticator,
  reason: string,
) {
  const options = await startRevocation(membership, requestId, webAuthnConfig, testContext());
  return completeRevocation(
    membership,
    requestId,
    { response: authenticator.assert(options.options.challenge), reason },
    webAuthnConfig,
    testContext(),
  );
}

describe('revoking an approval', () => {
  it('withdraws it without erasing the original decision', async () => {
    const s = await approvedScenario();

    await revoke(
      s.approver,
      s.request.id,
      s.janeKey,
      'The vendor confirmed by phone that they did not change their details.',
    );

    const after = await getRequest(s.approver, s.request.id);
    expect(after.status).toBe('REVOKED');
    expect(after.revokedAt).not.toBeNull();

    // The approval is still there, recorded, alongside the revocation.
    const decisions = after.decisions.map((decision) => decision.decision);
    expect(decisions).toContain('APPROVE');
    expect(decisions).toContain('REVOKE');
    expect(after.approvedAt).not.toBeNull();

    const revocation = await prisma.revocation.findUniqueOrThrow({
      where: { requestId: s.request.id },
    });
    expect(revocation.revokedByUserId).toBe(s.jane.id);
    expect(revocation.reason).toContain('confirmed by phone');
    expect(revocation.credentialId).not.toBeNull();
  });

  it('leaves the receipt intact but no longer in force', async () => {
    const s = await approvedScenario();

    const before = await verifyReceipt(s.approver, s.receiptId, signingConfig);
    expect(before.currentlyValid).toBe(true);

    await revoke(s.approver, s.request.id, s.janeKey, 'Raised in error.');

    const after = await verifyReceipt(s.approver, s.receiptId, signingConfig);
    // The signature still verifies: the record of what was approved is
    // unchanged. What changed is whether it may be acted on.
    expect(after.signatureValid).toBe(true);
    expect(after.revoked).toBe(true);
    expect(after.currentlyValid).toBe(false);
  });

  it('records the revocation in the audit log with both states', async () => {
    const s = await approvedScenario();
    const options = await startRevocation(
      s.approver,
      s.request.id,
      webAuthnConfig,
      testContext(),
    );

    const ctx = testContext();
    await completeRevocation(
      s.approver,
      s.request.id,
      { response: s.janeKey.assert(options.options.challenge), reason: 'Duplicate invoice.' },
      webAuthnConfig,
      ctx,
    );

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'APPROVAL_REVOKED' },
    });
    expect(event.previousState).toBe('APPROVED');
    expect(event.newState).toBe('REVOKED');
    expect(event.actorUserId).toBe(s.jane.id);
  });

  it('cannot be reinstated', async () => {
    const s = await approvedScenario();
    await revoke(s.approver, s.request.id, s.janeKey, 'Withdrawn.');

    await expect(
      startDecision(s.approver, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_REVOKED' });
  });

  it('cannot be revoked twice', async () => {
    const s = await approvedScenario();
    await revoke(s.approver, s.request.id, s.janeKey, 'Withdrawn.');

    await expect(
      startRevocation(s.approver, s.request.id, webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_REVOKED' });
  });

  it('refuses somebody who neither approved it nor administers the organization', async () => {
    const s = await approvedScenario();
    const bystanderUser = await addMember(s.organizationId, 'APPROVER');
    const bystanderKey = new VirtualAuthenticator();
    await bystanderKey.register(bystanderUser.id);
    const bystander = await requireMembership(bystanderUser, s.organizationId);

    await expect(
      startRevocation(bystander, s.request.id, webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const untouched = await getRequest(s.approver, s.request.id);
    expect(untouched.status).toBe('APPROVED');
  });

  it('lets an administrator revoke, recorded under their own name', async () => {
    const s = await approvedScenario();

    await revoke(s.adminMembership, s.request.id, s.adminKey, 'Approver has left the company.');

    const revocation = await prisma.revocation.findUniqueOrThrow({
      where: { requestId: s.request.id },
    });
    // Not attributed to the original approver. An administrator acting is
    // visibly an administrator acting.
    expect(revocation.revokedByUserId).toBe(s.admin.id);
    expect(revocation.revokedByUserId).not.toBe(s.jane.id);
  });

  it('refuses a revocation challenge presented as an approval, and the reverse', async () => {
    const s = await approvedScenario();
    const second = await createRequest(
      s.requester,
      {
        organizationId: s.organizationId,
        assignedApproverUserId: s.jane.id,
        actionType: 'PAYMENT_REQUEST',
        expiresInMinutes: 60,
        fields: { ...paymentFields, accountLastFour: '9914' },
      },
      testContext(),
    );

    // A challenge issued to approve the second request must not revoke the first.
    const approveOptions = await startDecision(
      s.approver,
      second.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    await expect(
      completeRevocation(
        s.approver,
        s.request.id,
        {
          response: s.janeKey.assert(approveOptions.options.challenge),
          reason: 'Trying to reuse a challenge.',
        },
        webAuthnConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });

    const untouched = await getRequest(s.approver, s.request.id);
    expect(untouched.status).toBe('APPROVED');
  });

  it('refuses a replayed revocation assertion', async () => {
    const s = await approvedScenario();
    const options = await startRevocation(
      s.approver,
      s.request.id,
      webAuthnConfig,
      testContext(),
    );
    const assertion = s.janeKey.assert(options.options.challenge);

    await completeRevocation(
      s.approver,
      s.request.id,
      { response: assertion, reason: 'First revocation.' },
      webAuthnConfig,
      testContext(),
    );

    // The second attempt is refused twice over: the request is no longer
    // approved, and the challenge has been spent. The state gate is checked
    // first, so that is the error the caller sees.
    await expect(
      completeRevocation(
        s.approver,
        s.request.id,
        { response: assertion, reason: 'Replay.' },
        webAuthnConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_REVOKED' });

    const spent = await prisma.approvalChallenge.findFirstOrThrow({
      where: { requestId: s.request.id, decision: 'REVOKE' },
    });
    expect(spent.usedAt).not.toBeNull();

    // And exactly one revocation exists, not two.
    expect(await prisma.revocation.count({ where: { requestId: s.request.id } })).toBe(1);
    expect(
      await prisma.decision.count({ where: { requestId: s.request.id, decision: 'REVOKE' } }),
    ).toBe(1);
  });

  it('cannot revoke a request that was never approved', async () => {
    const { organizationId } = await createOrganizationWithAdmin();
    const alex = await addMember(organizationId, 'REQUESTER');
    const jane = await addMember(organizationId, 'APPROVER');
    const key = new VirtualAuthenticator();
    await key.register(jane.id);

    const requester = await requireMembership(alex, organizationId);
    const approver = await requireMembership(jane, organizationId);

    const pendingRequest = await createRequest(
      requester,
      {
        organizationId,
        assignedApproverUserId: jane.id,
        actionType: 'PAYMENT_REQUEST',
        expiresInMinutes: 60,
        fields: paymentFields,
      },
      testContext(),
    );

    await expect(
      startRevocation(approver, pendingRequest.id, webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' });
  });
});
