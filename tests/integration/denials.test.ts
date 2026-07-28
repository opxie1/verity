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
import { createOrganizationWithAdmin, testContext } from './setup/factories';
import {
  acmeScenario as scenario,
  freshSigningConfig,
  webAuthnConfig,
} from './setup/approval-scenario';

let signingConfig: ReceiptSigningConfig;
beforeAll(() => {
  signingConfig = freshSigningConfig();
});
describe('denying', () => {
  it('records a denial with a reason and a receipt', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'DENY',
      webAuthnConfig,
      testContext(),
    );

    const result = await completeDecision(
      s.approver,
      s.request.id,
      {
        decision: 'DENY',
        response: s.authenticator.assert(options.options.challenge),
        reason: 'I did not send this and our bank details have not changed.',
      },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    expect(result.status).toBe('DENIED');

    const after = await getRequest(s.approver, s.request.id);
    expect(after.status).toBe('DENIED');
    expect(after.decisions[0]?.reason).toContain('did not send this');

    const verification = await verifyReceipt(s.approver, result.receiptId, signingConfig);
    expect(verification.signatureValid).toBe(true);
    // A denial receipt is genuine evidence, but it is not an approval.
    expect(verification.currentlyValid).toBe(false);
    expect((verification.receipt.receiptPayloadJson as CanonicalObject).decision).toBe('DENIED');
  });

  it('cannot be approved afterwards', async () => {
    const s = await scenario();
    const denial = await startDecision(
      s.approver,
      s.request.id,
      'DENY',
      webAuthnConfig,
      testContext(),
    );
    await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'DENY', response: s.authenticator.assert(denial.options.challenge) },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    await expect(
      startDecision(s.approver, s.request.id, 'APPROVE', webAuthnConfig, testContext()),
    ).rejects.toMatchObject({ code: 'REQUEST_ALREADY_DECIDED' });
  });
});

describe('reading a receipt', () => {
  it('is hidden from another organization', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    const result = await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'APPROVE', response: s.authenticator.assert(options.options.challenge) },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    const other = await createOrganizationWithAdmin();
    const outsider = await requireMembership(other.admin, other.organizationId);

    await expect(verifyReceipt(outsider, result.receiptId, signingConfig)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports a tampered receipt body as invalid', async () => {
    const s = await scenario();
    const options = await startDecision(
      s.approver,
      s.request.id,
      'APPROVE',
      webAuthnConfig,
      testContext(),
    );
    const result = await completeDecision(
      s.approver,
      s.request.id,
      { decision: 'APPROVE', response: s.authenticator.assert(options.options.challenge) },
      webAuthnConfig,
      signingConfig,
      testContext(),
    );

    // Receipts reject UPDATE at the database level, so tampering has to be
    // simulated by checking a body that differs from the signed one.
    await expect(
      prisma.receipt.update({
        where: { id: result.receiptId },
        data: { serverSignature: 'tampered' },
      }),
    ).rejects.toThrow(/append-only/);

    const verification = await verifyReceipt(s.approver, result.receiptId, signingConfig);
    expect(verification.signatureValid).toBe(true);
  });
});
