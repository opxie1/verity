import 'server-only';
import { DomainError } from '@verity/domain';

/**
 * Rate limiting for the endpoints where guessing or flooding would matter
 * (PRD NFR-001).
 *
 * This is an in-process fixed-window counter. It is honest about what it is:
 * it protects a single server instance, and behind more than one instance each
 * would keep its own count. That is adequate for the MVP's single-instance
 * deployment and for slowing down a script, but it is not a defence against a
 * distributed attacker.
 *
 * Before running more than one instance, move the counter to Redis or the
 * platform's own rate limiter. This module is deliberately small so that
 * swapping the store is a change in one place.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounded so a flood of distinct keys cannot exhaust memory. */
const MAX_TRACKED_KEYS = 50_000;

function sweep(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) {
    return;
  }
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
  if (windows.size >= MAX_TRACKED_KEYS) {
    // Still full of live windows: drop the oldest rather than grow without limit.
    const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED_KEYS / 10))) {
      windows.delete(key);
    }
  }
}

export interface RateLimitRule {
  /** Distinguishes one limit from another for the same caller. */
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Sign-in links: enough for genuine retries, not enough to spray an inbox. */
  signIn: { name: 'sign-in', limit: 5, windowMs: 15 * 60 * 1000 },
  /** Decision attempts: a person decides once or twice, not fifty times. */
  decision: { name: 'decision', limit: 20, windowMs: 5 * 60 * 1000 },
  /** Passkey ceremonies, which are cheap for us but should not be a free oracle. */
  passkey: { name: 'passkey', limit: 30, windowMs: 5 * 60 * 1000 },
  /** Invitation redemption, the one place a token could in principle be guessed. */
  invitation: { name: 'invitation', limit: 10, windowMs: 10 * 60 * 1000 },
  /** Request creation, to bound accidental or malicious flooding. */
  createRequest: { name: 'create-request', limit: 60, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Consumes one unit against a rule, throwing `RATE_LIMITED` when exhausted.
 *
 * `identity` should be the most specific stable thing available — a user ID
 * where the caller is authenticated, otherwise the hashed client address.
 */
export function enforceRateLimit(rule: RateLimitRule, identity: string): void {
  const now = Date.now();
  const key = `${rule.name}:${identity}`;

  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    const seconds = Math.ceil((existing.resetAt - now) / 1000);
    throw new DomainError('RATE_LIMITED', {
      message: `Too many attempts. Try again in about ${Math.max(1, Math.ceil(seconds / 60))} minute${seconds > 60 ? 's' : ''}.`,
      internalDetail: `${rule.name} limit ${rule.limit}/${rule.windowMs}ms exceeded by ${identity}`,
    });
  }
}

/** Test helper. Not exported through any route. */
export function resetRateLimits(): void {
  windows.clear();
}
