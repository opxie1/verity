import { z } from 'zod';

/**
 * Every error code the API may return (PRD section 24).
 *
 * Messages shown to users explain what to do next; they never expose
 * implementation detail, stack traces, or the contents of a protected payload.
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'ORGANIZATION_ACCESS_DENIED',
  'VALIDATION_FAILED',
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_ALREADY_ACCEPTED',
  'INVITATION_NOT_FOUND',
  'PASSKEY_REQUIRED',
  'PASSKEY_NOT_FOUND',
  'PASSKEY_VERIFICATION_FAILED',
  'REQUEST_NOT_FOUND',
  'REQUEST_NOT_PENDING',
  'REQUEST_EXPIRED',
  'REQUEST_ALREADY_DECIDED',
  'REQUEST_CANCELED',
  'REQUEST_REVOKED',
  'APPROVER_MISMATCH',
  'PAYLOAD_HASH_MISMATCH',
  'CHALLENGE_EXPIRED',
  'CHALLENGE_ALREADY_USED',
  'CHALLENGE_NOT_FOUND',
  'RATE_LIMITED',
  'CONFLICT',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    correlationId: z.string(),
    /** Field-level detail, present only for VALIDATION_FAILED. */
    fieldErrors: z.record(z.array(z.string())).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** HTTP status paired with each error code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNAUTHORIZED: 403,
  ORGANIZATION_ACCESS_DENIED: 403,
  VALIDATION_FAILED: 400,
  INVITATION_EXPIRED: 410,
  INVITATION_REVOKED: 410,
  INVITATION_ALREADY_ACCEPTED: 409,
  INVITATION_NOT_FOUND: 404,
  PASSKEY_REQUIRED: 403,
  PASSKEY_NOT_FOUND: 404,
  PASSKEY_VERIFICATION_FAILED: 401,
  REQUEST_NOT_FOUND: 404,
  REQUEST_NOT_PENDING: 409,
  REQUEST_EXPIRED: 410,
  REQUEST_ALREADY_DECIDED: 409,
  REQUEST_CANCELED: 409,
  REQUEST_REVOKED: 409,
  APPROVER_MISMATCH: 403,
  PAYLOAD_HASH_MISMATCH: 409,
  CHALLENGE_EXPIRED: 410,
  CHALLENGE_ALREADY_USED: 409,
  CHALLENGE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/** Default user-facing message for each code. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to continue.',
  UNAUTHORIZED: 'You do not have permission to do that.',
  ORGANIZATION_ACCESS_DENIED: 'This record belongs to a different organization.',
  VALIDATION_FAILED: 'Some of the details you entered are not valid.',
  INVITATION_EXPIRED: 'This invitation has expired. Ask an administrator to send a new one.',
  INVITATION_REVOKED: 'This invitation was revoked. Ask an administrator to send a new one.',
  INVITATION_ALREADY_ACCEPTED: 'This invitation has already been used.',
  INVITATION_NOT_FOUND: 'This invitation link is not valid.',
  PASSKEY_REQUIRED: 'Register a passkey before you can approve or deny requests.',
  PASSKEY_NOT_FOUND: 'That passkey is no longer registered on your account.',
  PASSKEY_VERIFICATION_FAILED: 'Your passkey could not be verified. Try again.',
  REQUEST_NOT_FOUND: 'That request does not exist.',
  REQUEST_NOT_PENDING: 'This request is no longer awaiting a decision.',
  REQUEST_EXPIRED: 'This request expired before it could be approved.',
  REQUEST_ALREADY_DECIDED: 'A decision has already been recorded for this request.',
  REQUEST_CANCELED: 'This request was canceled by the requester.',
  REQUEST_REVOKED: 'The approval for this request was revoked.',
  APPROVER_MISMATCH: 'You are not the approver assigned to this request.',
  PAYLOAD_HASH_MISMATCH: 'The request details changed. Review the request and start again.',
  CHALLENGE_EXPIRED: 'This approval step timed out. Start the approval again.',
  CHALLENGE_ALREADY_USED: 'This approval step was already completed. Refresh the page.',
  CHALLENGE_NOT_FOUND: 'This approval step is no longer valid. Start the approval again.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  CONFLICT: 'Someone else changed this at the same time. Refresh and try again.',
  NOT_FOUND: 'That record does not exist.',
  INTERNAL_ERROR: 'Something went wrong on our side. The problem has been logged.',
};
