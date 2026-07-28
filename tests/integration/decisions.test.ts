import { prisma } from '@verity/database';
import {
  completeDecision,
  createRequest,
  getRequest,
  requireMembership,
  startDecision,
  verifyReceipt,
  type CanonicalObject,
  type ReceiptSigningConfig,
} from '@verity/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createOrganizationWithAdmin, testContext } from './setup/factories';
import {
  acmeScenario as scenario,
  freshSigningConfig,
  paymentFields,
  webAuthnConfig,
} from './setup/approval-scenario';
import { VirtualAuthenticator } from './setup/virtual-authenticator';

let signingConfig: ReceiptSigningConfig;

beforeAll(() => {
  signingConfig = freshSigningConfig();
});

describe('issuing a decision challenge', () => {
  it('binds the request, the payload hash and the decision', async () => {
    const s = await scenario();

    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    expect(options.payloadHash).toBe(s.request.payloadHash);

    const stored = await prisma.approvalChallenge.findUniqueOrThrow({
      where: { id: options.challengeId },
    });
    expect(stored.requestId).toBe(s.request.id);
    expect(stored.userId).toBe(s.jane.id);
    expect(stored.decision).toBe('APPROVE');
    expect(stored.payloadHash).toBe(s.request.payloadHash);
    expect(stored.usedAt).toBeNull();
    // Short-lived by design.
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);
  });

  it('stores only the digest of the challenge, not the challenge', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    const stored = await prisma.approvalChallenge.findUniqueOrThrow({
      where: { id: options.challengeId },
    });
    expect(stored.challengeHash).not.toBe(options.options.challenge);
    expect(stored.challengeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses somebody who is not the assigned approver', async () => {
    const s = await scenario();
    const adminMembership = await requireMembership(s.admin, s.organizationId);

    await expect(
      startDecision(adminMembership, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'APPROVER_MISMATCH' });

    const failure = await prisma.auditEvent.findFirst({
      where: {
        eventType: 'AUTHORIZATION_FAILURE',
        targetId: s.request.id,
        actorUserId: s.admin.id,
      },
    });
    expect(failure).not.toBeNull();
  });

  it('refuses the requester, who cannot decide at all', async () => {
    const s = await scenario();
    await expect(
      startDecision(s.requester, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses an approver with no registered passkey', async () => {
    const { organizationId, admin } = await createOrganizationWithAdmin();
    const alex = await addMember(organizationId, 'REQUESTER');
    const keyless = await addMember(organizationId, 'APPROVER');
    const requester = await requireMembership(alex, organizationId);
    const approver = await requireMembership(keyless, organizationId);

    const request = await createRequest(
      requester,
      {
        organizationId,
        assignedApproverUserId: keyless.id,
        actionType: 'PAYMENT_REQUEST',
        expiresInMinutes: 60,
        fields: paymentFields,
      },
      testContext(),
    );

    await expect(
      startDecision(approver, request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'PASSKEY_REQUIRED' });
    expect(admin).toBeDefined();
  });

  it('refuses an expired request', async () => {
    const s = await scenario();
    await prisma.verificationRequest.update({
      where: { id: s.request.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      startDecision(s.approver, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
  });
});

describe('approving', () => {
  it('records the approval, the decision and a signed receipt', async () => {
    const s = await scenario();
    const ctx = testContext();

    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    const assertion = s.authenticator.assert(options.options.challenge);

    const result = await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'APPROVE', response: assertion },
      webAuthnConfig,
      signingConfig,
      ctx,
    );

    expect(result.status).toBe('APPROVED');

    const after = await getRequest(s.approver, s.request.id);
    expect(after.status).toBe('APPROVED');
    expect(after.approvedAt).not.toBeNull();

    const verification = await verifyReceipt(s.approver, result.receiptId, signingConfig);
    expect(verification.signatureValid).toBe(true);
    expect(verification.payloadMatchesRequest).toBe(true);
    expect(verification.currentlyValid).toBe(true);

    const body = verification.receipt.receiptPayloadJson as CanonicalObject;
    expect(body.decision).toBe('APPROVED');
    expect(body.payloadHash).toBe(s.request.payloadHash);
    expect(body.approverUserId).toBe(s.jane.id);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'REQUEST_APPROVED' },
    });
    expect(audit.previousState).toBe('PENDING');
    expect(audit.newState).toBe('APPROVED');
  });

  it('cannot be approved twice', async () => {
    const s = await scenario();

    const first = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'APPROVE', response: s.authenticator.assert(first.options.challenge) },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    await expect(
      startDecision(s.approver, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_ALREADY_DECIDED' });
  });

  it('refuses a replayed assertion', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    const assertion = s.authenticator.assert(options.options.challenge);

    await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'APPROVE', response: assertion },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: assertion },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_USED' });
  });

  it('will not let a denial challenge be spent as an approval', async () => {
    const s = await scenario();

    const denyOptions = await startDecision(
      s.approver,
      s.request.id,
      'DENY',
      webAuthnConfig,
      testContext(),
    );
    const assertion = s.authenticator.assert(denyOptions.options.challenge);

    // The challenge the authenticator signed says DENY. Presenting the same
    // signature as an approval must fail (PRD FR-010).
    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: assertion },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });

    const untouched = await getRequest(s.approver, s.request.id);
    expect(untouched.status).toBe('PENDING');
  });

  it("will not let one request's challenge be spent on another", async () => {
    const s = await scenario();
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

    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    const assertion = s.authenticator.assert(options.options.challenge);

    await expect(
      completeDecision(
        s.approver,
        second.id,
        { decision: 'APPROVE', response: assertion },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });
  });

  it('refuses an assertion produced for a different origin', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    const assertion = s.authenticator.assert(options.options.challenge, {
      origin: 'https://verity-phishing.example',
    });

    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: assertion },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });

    const untouched = await getRequest(s.approver, s.request.id);
    expect(untouched.status).toBe('PENDING');
  });

  it('refuses an assertion where the user was not verified', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    const assertion = s.authenticator.assert(options.options.challenge, { userVerified: false });

    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: assertion },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });
  });

  it('leaves the request untouched and records the attempt when a decision fails', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    const forged = s.authenticator.assert(options.options.challenge);
    // Corrupt the signature.
    forged.response.signature = Buffer.from('not a real signature').toString('base64url');

    const ctx = testContext();
    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: forged },
        webAuthnConfig,
        signingConfig,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });

    const untouched = await getRequest(s.approver, s.request.id);
    expect(untouched.status).toBe('PENDING');
    expect(untouched.approvedAt).toBeNull();

    const attempt = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'FAILED_APPROVAL_ATTEMPT' },
    });
    expect(attempt.targetId).toBe(s.request.id);

    // And the challenge is spent, so the failure cannot be retried against it.
    const challenge = await prisma.approvalChallenge.findUniqueOrThrow({
      where: { id: options.challengeId },
    });
    expect(challenge.usedAt).not.toBeNull();
  });

  it('refuses an expired challenge', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    await prisma.approvalChallenge.update({
      where: { id: options.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: s.authenticator.assert(options.options.challenge) },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });

  it("refuses another person's passkey", async () => {
    const s = await scenario();
    const impostor = new VirtualAuthenticator();
    await impostor.register(s.alex.id, "Alex's key");

    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );

    await expect(
      completeDecision(
        s.approver,
        s.request.id,
        { decision: 'APPROVE', response: impostor.assert(options.options.challenge) },
        webAuthnConfig,
        signingConfig,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_NOT_FOUND' });
  });
});
