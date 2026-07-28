import 'server-only';
import type { ReceiptSigningConfig } from '@verity/domain';
import { serverEnv } from './env';

/**
 * Receipt signing key, read from the environment.
 *
 * The private key lives in a secret manager or an environment variable and is
 * never committed (PRD FR-012, section 25). `signingKeyVersion` is stored on
 * every receipt so keys can be rotated without invalidating older ones.
 */
export const receiptSigningConfig: ReceiptSigningConfig = {
  privateKeyBase64: serverEnv.RECEIPT_SIGNING_KEY,
  keyVersion: serverEnv.RECEIPT_SIGNING_KEY_VERSION,
};
