import type { MemberStatus, OrgRole, UserStatus } from '@verity/database';

/** The authenticated person, as resolved from the server-side session. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

/**
 * Per-request metadata attached to audit records. `ipHash` is a keyed digest,
 * not the address itself (PRD NFR-002).
 */
export interface RequestContext {
  correlationId: string;
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Proof that the session user is an active member of a specific organization.
 *
 * Services take this rather than a bare `organizationId` string, so that no
 * code path can act on an organization without first passing through
 * `requireMembership`. This is the mechanism behind PRD FR-002.
 */
export interface MembershipContext {
  user: SessionUser;
  organizationId: string;
  membershipId: string;
  role: OrgRole;
  memberStatus: MemberStatus;
}

export function isActiveMember(membership: MembershipContext): boolean {
  return membership.memberStatus === 'ACTIVE' && membership.user.status === 'ACTIVE';
}
