import type { OrgRole } from '@verity/database';

/**
 * Permissions implement the role table in PRD section 12.
 *
 * Two rules that are deliberately *not* expressible here, because they depend
 * on the record rather than the role, and are enforced in the services:
 *
 *   - `request:decide` grants the ability to decide, but a decision is only
 *     accepted from the approver assigned to that specific request. An
 *     administrator holding `request:decide` still cannot approve on behalf of
 *     someone else (PRD 12.1).
 *   - `request:cancel:own` and `request:revoke:own` are scoped to records the
 *     actor created or decided.
 */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:invite',
  'org:member:update',
  'org:policy:update',
  'audit:read',
  'audit:export',
  'request:create',
  'request:read:own',
  'request:read:assigned',
  'request:read:all',
  'request:cancel:own',
  'request:decide',
  'request:revoke:own',
  'receipt:read',
  'passkey:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  ORG_ADMIN: [
    'org:read',
    'org:update',
    'org:invite',
    'org:member:update',
    'org:policy:update',
    'audit:read',
    'audit:export',
    'request:create',
    'request:read:own',
    'request:read:assigned',
    'request:read:all',
    'request:cancel:own',
    'request:decide',
    'request:revoke:own',
    'receipt:read',
    'passkey:manage',
  ],
  REQUESTER: [
    'org:read',
    'request:create',
    'request:read:own',
    'request:cancel:own',
    'receipt:read',
    'passkey:manage',
  ],
  APPROVER: [
    'org:read',
    'request:read:assigned',
    'request:decide',
    'request:revoke:own',
    'receipt:read',
    'passkey:manage',
  ],
  // Read-only. An auditor can never create, decide, cancel or revoke.
  AUDITOR: ['org:read', 'audit:read', 'audit:export', 'request:read:all', 'receipt:read'],
};

export function permissionsForRole(role: OrgRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
