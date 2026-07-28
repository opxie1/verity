import type { RequestStatus } from '@verity/database';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { assertTransition, canTransition, effectiveStatus, isTerminal } from './state-machine';

const ALL_STATUSES: RequestStatus[] = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'DENIED',
  'EXPIRED',
  'CANCELED',
  'REVOKED',
];

/** Exactly the transitions PRD section 15 permits, and nothing else. */
const LEGAL: [RequestStatus, RequestStatus][] = [
  ['DRAFT', 'PENDING'],
  ['DRAFT', 'CANCELED'],
  ['PENDING', 'APPROVED'],
  ['PENDING', 'DENIED'],
  ['PENDING', 'EXPIRED'],
  ['PENDING', 'CANCELED'],
  ['APPROVED', 'REVOKED'],
];

describe('request state machine', () => {
  it.each(LEGAL)('permits %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('permits nothing outside the documented set', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    const unexpected: string[] = [];

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (canTransition(from, to) && !legal.has(`${from}->${to}`)) {
          unexpected.push(`${from}->${to}`);
        }
      }
    }

    expect(unexpected).toEqual([]);
  });

  // The transitions explicitly called out as invalid in the PRD.
  it.each([
    ['DENIED', 'APPROVED'],
    ['EXPIRED', 'APPROVED'],
    ['CANCELED', 'APPROVED'],
    ['REVOKED', 'APPROVED'],
    ['APPROVED', 'PENDING'],
  ] as [RequestStatus, RequestStatus][])('refuses %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(DomainError);
  });

  it('never allows a request to become approved twice', () => {
    expect(canTransition('APPROVED', 'APPROVED')).toBe(false);
  });

  it('never allows a revoked approval to be reinstated', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('REVOKED', to)).toBe(false);
    }
  });

  it('explains the refusal in terms the caller can act on', () => {
    expect(() => assertTransition('APPROVED', 'APPROVED')).toThrow(
      expect.objectContaining({ code: 'REQUEST_ALREADY_DECIDED' }),
    );
    expect(() => assertTransition('EXPIRED', 'APPROVED')).toThrow(
      expect.objectContaining({ code: 'REQUEST_EXPIRED' }),
    );
    expect(() => assertTransition('CANCELED', 'APPROVED')).toThrow(
      expect.objectContaining({ code: 'REQUEST_CANCELED' }),
    );
    expect(() => assertTransition('REVOKED', 'APPROVED')).toThrow(
      expect.objectContaining({ code: 'REQUEST_REVOKED' }),
    );
  });

  it('marks the right statuses terminal', () => {
    expect(isTerminal('DENIED')).toBe(true);
    expect(isTerminal('EXPIRED')).toBe(true);
    expect(isTerminal('CANCELED')).toBe(true);
    expect(isTerminal('REVOKED')).toBe(true);
    expect(isTerminal('PENDING')).toBe(false);
    expect(isTerminal('APPROVED')).toBe(false);
  });
});

describe('effectiveStatus', () => {
  const now = new Date('2026-07-27T12:00:00.000Z');

  it('treats a lapsed pending request as expired without waiting for a job', () => {
    expect(effectiveStatus('PENDING', new Date('2026-07-27T11:59:59.000Z'), now)).toBe('EXPIRED');
  });

  it('treats expiry as exclusive of the exact moment', () => {
    expect(effectiveStatus('PENDING', now, now)).toBe('EXPIRED');
    expect(effectiveStatus('PENDING', new Date('2026-07-27T12:00:00.001Z'), now)).toBe('PENDING');
  });

  it('leaves a decided request alone even when its expiry has passed', () => {
    // An approval given before the deadline stays an approval afterwards.
    expect(effectiveStatus('APPROVED', new Date('2026-07-27T11:00:00.000Z'), now)).toBe('APPROVED');
    expect(effectiveStatus('DENIED', new Date('2026-07-27T11:00:00.000Z'), now)).toBe('DENIED');
    expect(effectiveStatus('REVOKED', new Date('2026-07-27T11:00:00.000Z'), now)).toBe('REVOKED');
  });
});
