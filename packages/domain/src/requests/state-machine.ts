import type { RequestStatus } from '@verity/database';
import { DomainError } from '../errors';

/**
 * The request state machine from PRD section 15.
 *
 * Declared as data rather than scattered through `if` statements, so that
 * "can this transition happen" has exactly one answer and the tests can walk
 * every pair.
 */
const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ['PENDING', 'CANCELED'],
  PENDING: ['APPROVED', 'DENIED', 'EXPIRED', 'CANCELED'],
  APPROVED: ['REVOKED'],
  // Terminal. In particular nothing returns to APPROVED: a denied, expired,
  // canceled or revoked request has to be raised again as a new request, which
  // gets a new nonce and a new payload hash.
  DENIED: [],
  EXPIRED: [],
  CANCELED: [],
  REVOKED: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Throws unless the transition is legal, with an error naming what the caller
 * should do next rather than what the state machine thinks.
 */
export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (canTransition(from, to)) {
    return;
  }

  switch (from) {
    case 'APPROVED':
      throw new DomainError('REQUEST_ALREADY_DECIDED');
    case 'DENIED':
      throw new DomainError('REQUEST_ALREADY_DECIDED');
    case 'EXPIRED':
      throw new DomainError('REQUEST_EXPIRED');
    case 'CANCELED':
      throw new DomainError('REQUEST_CANCELED');
    case 'REVOKED':
      throw new DomainError('REQUEST_REVOKED');
    default:
      throw new DomainError('REQUEST_NOT_PENDING', {
        internalDetail: `illegal transition ${from} -> ${to}`,
      });
  }
}

export const TERMINAL_STATUSES: readonly RequestStatus[] = [
  'DENIED',
  'EXPIRED',
  'CANCELED',
  'REVOKED',
];

export function isTerminal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The status a request should be treated as having right now.
 *
 * A pending request whose expiry has passed is expired whether or not the
 * background job has caught up, so reads never show a stale window in which a
 * lapsed request still looks approvable (PRD FR-016).
 */
export function effectiveStatus(
  status: RequestStatus,
  expiresAt: Date,
  now: Date = new Date(),
): RequestStatus {
  if (status === 'PENDING' && expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return status;
}
