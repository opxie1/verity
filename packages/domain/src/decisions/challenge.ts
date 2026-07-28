import { createHash } from 'node:crypto';
import type { DecisionType } from '@verity/database';
import { canonicalize } from '../requests/normalization';

/**
 * The payload a decision challenge commits to (PRD FR-010).
 *
 * The authenticator signs over the digest of this object, so a signature is
 * not merely "Jane touched her key". It is "Jane approved request req_123,
 * whose details hash to this value, as an APPROVE, within this window."
 *
 * That binding is what makes an assertion useless anywhere else: it cannot be
 * replayed against a different request, a different set of details, or turned
 * from a denial into an approval (PRD 18.4, 18.5).
 */
export interface DecisionChallengePayload {
  type: 'VERITY_DECISION';
  requestId: string;
  payloadHash: string;
  decision: DecisionType;
  nonce: string;
  challengeId: string;
  expiresAt: string;
}

export function buildDecisionChallengePayload(input: {
  requestId: string;
  payloadHash: string;
  decision: DecisionType;
  nonce: string;
  challengeId: string;
  expiresAt: Date;
}): DecisionChallengePayload {
  return {
    type: 'VERITY_DECISION',
    requestId: input.requestId,
    payloadHash: input.payloadHash,
    decision: input.decision,
    nonce: input.nonce,
    challengeId: input.challengeId,
    expiresAt: input.expiresAt.toISOString(),
  };
}

/**
 * The bytes handed to WebAuthn as the challenge.
 *
 * A digest rather than the payload itself, because a WebAuthn challenge is a
 * short byte string and the payload is not. The canonical serialization means
 * the same decision always yields the same digest.
 */
export function decisionChallengeBytes(
  payload: DecisionChallengePayload,
): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256')
    .update(canonicalize(payload as unknown as Record<string, string>), 'utf8')
    .digest();
  return new Uint8Array(digest);
}

/** Digest of the issued challenge string, which is what gets stored. */
export function hashChallengeString(challenge: string): string {
  return createHash('sha256').update(challenge, 'utf8').digest('hex');
}
