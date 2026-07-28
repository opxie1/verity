import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { DomainError } from '../errors';

/**
 * Ed25519 signing for receipts (PRD FR-012).
 *
 * The algorithm and the implementation both come from Node's standard crypto
 * module. Nothing here implements a primitive: PRD section 25 forbids custom
 * cryptography, and a receipt signature is precisely the wrong place to
 * discover a hand-rolled mistake.
 *
 * A signature proves the receipt was issued by this server and has not been
 * altered since. It does not prove the approval was wise, legitimate, or that
 * the server itself was uncompromised at the time (PRD 18.8).
 */
export interface ReceiptSigningConfig {
  /** Base64-encoded PKCS#8 DER Ed25519 private key. Never committed. */
  privateKeyBase64: string;
  keyVersion: number;
}

function loadPrivateKey(config: ReceiptSigningConfig) {
  if (!config.privateKeyBase64) {
    throw new DomainError('INTERNAL_ERROR', {
      internalDetail: 'RECEIPT_SIGNING_KEY is not configured; receipts cannot be signed',
    });
  }
  try {
    return createPrivateKey({
      key: Buffer.from(config.privateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch (error) {
    throw new DomainError('INTERNAL_ERROR', {
      internalDetail: 'RECEIPT_SIGNING_KEY is not a valid PKCS#8 Ed25519 key',
      cause: error,
    });
  }
}

/** Signs the canonical receipt body. Returns a base64url signature. */
export function signReceiptBody(body: string, config: ReceiptSigningConfig): string {
  const privateKey = loadPrivateKey(config);
  // Ed25519 hashes internally, so the digest argument is null by design.
  return sign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64url');
}

export function verifyReceiptSignature(
  body: string,
  signature: string,
  config: ReceiptSigningConfig,
): boolean {
  let publicKey;
  try {
    publicKey = createPublicKey(loadPrivateKey(config));
  } catch {
    return false;
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }

  try {
    return verify(null, Buffer.from(body, 'utf8'), publicKey, signatureBytes);
  } catch {
    // A malformed signature is a failed verification, not an error to surface.
    return false;
  }
}

/**
 * The public key, so a receipt can be checked by someone who does not have the
 * private key. Published rather than secret: that is the point of a signature.
 */
export function receiptPublicKeyBase64(config: ReceiptSigningConfig): string {
  const publicKey = createPublicKey(loadPrivateKey(config));
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}
