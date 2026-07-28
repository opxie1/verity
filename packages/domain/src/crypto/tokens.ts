import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 256 bits of entropy, base64url-encoded to 43 characters. Long enough that
 * invitation links cannot be guessed, and URL-safe without escaping.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest. Only the digest of a token is ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256')
    .update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input)
    .digest('hex');
}

/** Length-safe, constant-time string comparison for secret material. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Keyed, truncated digest of a client IP address (PRD NFR-002). Keyed rather
 * than plain SHA-256 so the small IPv4 space cannot be brute-forced from a
 * database dump, and truncated because audit records only need to answer "same
 * source or different source".
 */
export function hashIpAddress(ip: string | null | undefined, key: string): string | null {
  if (!ip) {
    return null;
  }
  return createHmac('sha256', key).update(ip.trim(), 'utf8').digest('hex').slice(0, 32);
}

/** Correlation ID for tying a log line, an audit record and a response together. */
export function generateCorrelationId(): string {
  return `corr_${randomBytes(12).toString('hex')}`;
}

/** Server-generated nonce embedded in the protected payload (PRD FR-007). */
export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * A prefixed identifier in the same shape the database generates.
 *
 * Used where a record's ID has to be known before the row is written, such as
 * a decision challenge whose ID is part of the payload the authenticator signs
 * over (PRD FR-010).
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}
