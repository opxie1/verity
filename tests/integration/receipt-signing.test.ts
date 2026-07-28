import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalize,
  signReceiptBody,
  verifyReceiptSignature,
  type ReceiptSigningConfig,
} from '@verity/domain';
import { beforeAll, describe, expect, it } from 'vitest';

let signingConfig: ReceiptSigningConfig;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('ed25519');
  signingConfig = {
    privateKeyBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    keyVersion: 1,
  };
});
describe('receipt signing', () => {
  it('verifies a signature it produced', () => {
    const body = canonicalize({ receiptId: 'rcpt_1', decision: 'APPROVED' });
    const signature = signReceiptBody(body, signingConfig);
    expect(verifyReceiptSignature(body, signature, signingConfig)).toBe(true);
  });

  it('rejects a body that has been altered', () => {
    const body = canonicalize({ receiptId: 'rcpt_1', amountMinor: 2_500_000 });
    const signature = signReceiptBody(body, signingConfig);
    const tampered = canonicalize({ receiptId: 'rcpt_1', amountMinor: 9_900_000 });

    expect(verifyReceiptSignature(tampered, signature, signingConfig)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const otherKey: ReceiptSigningConfig = {
      privateKeyBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      keyVersion: 1,
    };
    const body = canonicalize({ receiptId: 'rcpt_1' });

    expect(verifyReceiptSignature(body, signReceiptBody(body, otherKey), signingConfig)).toBe(false);
  });

  it('treats a malformed signature as invalid rather than throwing', () => {
    expect(verifyReceiptSignature('{}', 'not-a-signature', signingConfig)).toBe(false);
  });
});
