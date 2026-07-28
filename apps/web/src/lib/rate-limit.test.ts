import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, enforceRateLimit, resetRateLimits } from './rate-limit';

const rule = { name: 'test', limit: 3, windowMs: 60_000 };

describe('rate limiting', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it('allows up to the limit and refuses the next attempt', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      expect(() => enforceRateLimit(rule, 'usr_1')).not.toThrow();
    }
    expect(() => enforceRateLimit(rule, 'usr_1')).toThrow(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
  });

  it('counts each caller separately', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'usr_1');
    }
    // One person exhausting their allowance must not lock out anybody else.
    expect(() => enforceRateLimit(rule, 'usr_2')).not.toThrow();
  });

  it('counts each rule separately', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'usr_1');
    }
    expect(() => enforceRateLimit({ ...rule, name: 'other' }, 'usr_1')).not.toThrow();
  });

  it('lets the caller through again once the window passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'));

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'usr_1');
    }
    expect(() => enforceRateLimit(rule, 'usr_1')).toThrow();

    vi.setSystemTime(new Date('2026-07-27T12:01:01Z'));
    expect(() => enforceRateLimit(rule, 'usr_1')).not.toThrow();
  });

  it('tells the caller roughly how long to wait, without internal detail', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'usr_1');
    }

    try {
      enforceRateLimit(rule, 'usr_1');
      expect.unreachable('should have been rate limited');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/try again in about/i);
      // The limit and the identity are diagnostics, not something to hand back.
      expect(message).not.toContain('usr_1');
      expect(message).not.toContain(String(rule.limit));
    }
  });

  it('applies a tight limit to sign-in and a looser one to reading', () => {
    // Sending sign-in links is the expensive, abusable one.
    expect(RATE_LIMITS.signIn.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.decision.limit).toBeGreaterThan(RATE_LIMITS.signIn.limit);
  });
});
