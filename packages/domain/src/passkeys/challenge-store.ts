import { prisma } from '@verity/database';
import { DomainError } from '../errors';

/**
 * Storage and single-use accounting for generic WebAuthn challenges.
 *
 * Decision challenges do not live here — they carry a request, a payload hash
 * and a decision, and are kept in `ApprovalChallenge` (PRD 20.7). This covers
 * registration and plain re-authentication.
 */

/**
 * Marks a challenge used, or throws if it was already spent or has expired.
 *
 * Deliberately uses the global client rather than any surrounding transaction.
 * If this ran inside the caller's transaction, a later failure — a bad
 * signature, a rejected decision — would roll back the "used" mark and hand
 * the challenge back for another attempt. Single use has to survive the
 * failure of whatever the challenge was authorizing (PRD 18.5, NFR-001).
 */
export async function consumeChallenge(
  userId: string,
  type: 'REGISTRATION' | 'AUTHENTICATION',
  challenge: string,
): Promise<void> {
  const record = await prisma.webAuthnChallenge.findUnique({
    where: { challenge },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.userId !== userId || record.type !== type) {
    throw new DomainError('CHALLENGE_NOT_FOUND');
  }
  if (record.usedAt) {
    throw new DomainError('CHALLENGE_ALREADY_USED');
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new DomainError('CHALLENGE_EXPIRED');
  }

  // Conditional update: two concurrent replays cannot both claim the challenge,
  // because only one can observe `usedAt` still null.
  const claimed = await prisma.webAuthnChallenge.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new DomainError('CHALLENGE_ALREADY_USED');
  }
}

/**
 * Reads the challenge out of the client data so it can be looked up before the
 * response is verified.
 *
 * This is a lookup key only. The signature check that follows is what makes
 * the value trustworthy, and it uses the same string, so a forged client-data
 * blob fails there rather than here.
 */
export function decodeClientData(clientDataJSON: string): { challenge: string; origin: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  } catch {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: 'client data was not valid base64url JSON',
    });
  }

  const data = parsed as { challenge?: unknown; origin?: unknown };
  if (typeof data.challenge !== 'string' || typeof data.origin !== 'string') {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: 'client data was missing challenge or origin',
    });
  }

  return { challenge: data.challenge, origin: data.origin };
}

/** Removes spent and expired challenges. Safe to run repeatedly. */
export async function pruneExpiredChallenges(olderThan: Date = new Date()): Promise<number> {
  const result = await prisma.webAuthnChallenge.deleteMany({
    where: { OR: [{ expiresAt: { lt: olderThan } }, { usedAt: { not: null } }] },
  });
  return result.count;
}
