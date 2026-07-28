import { generateKeyPairSync } from 'node:crypto';
import { createRequest, requireMembership, type ReceiptSigningConfig, type WebAuthnConfig } from '@verity/domain';
import { addMember, createOrganizationWithAdmin, testContext } from './factories';
import { VirtualAuthenticator } from './virtual-authenticator';

/**
 * The organization from the PRD's demo (section 31): Alex in finance raises a
 * payment request, Jane the CEO decides it. Shared so the decision, denial and
 * revocation suites all exercise the same shape.
 */

export const webAuthnConfig: WebAuthnConfig = {
  rpId: 'localhost',
  rpName: 'Verity Test',
  expectedOrigins: ['http://localhost:3000'],
};

export function freshSigningConfig(): ReceiptSigningConfig {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    keyVersion: 1,
  };
}

export const paymentFields = {
  amountMinor: 2_500_000,
  currency: 'USD',
  recipientLegalName: 'ABC Consulting LLC',
  accountLastFour: '4821',
  paymentReason: 'July consulting invoice',
  requestedCompletionDate: '2026-07-30',
};

export async function acmeScenario() {
  const { organizationId, admin } = await createOrganizationWithAdmin('Acme Consulting');
  const alex = await addMember(organizationId, 'REQUESTER', { displayName: 'Alex' });
  const jane = await addMember(organizationId, 'APPROVER', { displayName: 'Jane' });

  const authenticator = new VirtualAuthenticator();
  await authenticator.register(jane.id, "Jane's laptop");

  const requester = await requireMembership(alex, organizationId);
  const approver = await requireMembership(jane, organizationId);

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

  return { organizationId, admin, alex, jane, requester, approver, authenticator, request };
}
