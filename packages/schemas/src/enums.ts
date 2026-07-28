import { z } from 'zod';

/**
 * These mirror the Prisma enums in `packages/database/prisma/schema.prisma`.
 * They are declared separately so that browser bundles can validate input
 * without pulling in the Prisma client. `enums.parity.test.ts` fails the build
 * if the two ever drift apart.
 */

export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED', 'PENDING']);
export type UserStatusValue = z.infer<typeof userStatusSchema>;

export const orgRoleSchema = z.enum(['ORG_ADMIN', 'REQUESTER', 'APPROVER', 'AUDITOR']);
export type OrgRoleValue = z.infer<typeof orgRoleSchema>;

export const memberStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type MemberStatusValue = z.infer<typeof memberStatusSchema>;

export const actionTypeSchema = z.enum([
  'PAYMENT_REQUEST',
  'BANK_ACCOUNT_CHANGE',
  'PAYROLL_CHANGE',
  'ACCESS_CHANGE',
  'CONFIDENTIAL_DATA_DISCLOSURE',
  'CUSTOM',
]);
export type ActionTypeValue = z.infer<typeof actionTypeSchema>;

export const requestStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'DENIED',
  'EXPIRED',
  'CANCELED',
  'REVOKED',
]);
export type RequestStatusValue = z.infer<typeof requestStatusSchema>;

export const decisionTypeSchema = z.enum(['APPROVE', 'DENY', 'REVOKE']);
export type DecisionTypeValue = z.infer<typeof decisionTypeSchema>;

export const sourceTypeSchema = z.enum(['GMAIL', 'MANUAL', 'API']);
export type SourceTypeValue = z.infer<typeof sourceTypeSchema>;

export const auditEventTypeSchema = z.enum([
  'ORGANIZATION_CREATED',
  'ORGANIZATION_SETTINGS_UPDATED',
  'POLICY_UPDATED',
  'INVITATION_CREATED',
  'INVITATION_RESENT',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
  'ROLE_CHANGED',
  'USER_DISABLED',
  'USER_REACTIVATED',
  'PASSKEY_ADDED',
  'PASSKEY_REMOVED',
  'REQUEST_CREATED',
  'REQUEST_SUBMITTED',
  'REQUEST_VIEWED',
  'REQUEST_APPROVED',
  'REQUEST_DENIED',
  'REQUEST_EXPIRED',
  'REQUEST_CANCELED',
  'APPROVAL_REVOKED',
  'RECEIPT_VIEWED',
  'FAILED_APPROVAL_ATTEMPT',
  'AUTHORIZATION_FAILURE',
]);
export type AuditEventTypeValue = z.infer<typeof auditEventTypeSchema>;

/**
 * Invitation status is derived from timestamps rather than stored, so that
 * "expired" is always computed against the current time (PRD FR-003).
 */
export const invitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']);
export type InvitationStatusValue = z.infer<typeof invitationStatusSchema>;

/** Human-readable labels for roles, used in the UI and in emails. */
export const ORG_ROLE_LABELS: Record<OrgRoleValue, string> = {
  ORG_ADMIN: 'Administrator',
  REQUESTER: 'Requester',
  APPROVER: 'Approver',
  AUDITOR: 'Auditor',
};

export const ORG_ROLE_DESCRIPTIONS: Record<OrgRoleValue, string> = {
  ORG_ADMIN: 'Manages the organization, its members and its policies.',
  REQUESTER: 'Creates verification requests and cancels the ones they created.',
  APPROVER: 'Approves, denies and revokes requests assigned to them.',
  AUDITOR: 'Reads requests, receipts and audit records. Cannot make decisions.',
};

export const REQUEST_STATUS_LABELS: Record<RequestStatusValue, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Expired',
  CANCELED: 'Canceled',
  REVOKED: 'Revoked',
};

export const ACTION_TYPE_LABELS: Record<ActionTypeValue, string> = {
  PAYMENT_REQUEST: 'Payment request',
  BANK_ACCOUNT_CHANGE: 'Bank-account change',
  PAYROLL_CHANGE: 'Payroll change',
  ACCESS_CHANGE: 'Access or credential change',
  CONFIDENTIAL_DATA_DISCLOSURE: 'Confidential-data disclosure',
  CUSTOM: 'Custom action',
};
