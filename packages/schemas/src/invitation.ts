import { z } from 'zod';
import { emailSchema, invitationIdSchema } from './common';
import { invitationStatusSchema, orgRoleSchema } from './enums';

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/**
 * The raw token appears only in the invitation email and in this request body.
 * The server stores nothing but its SHA-256 hash (PRD 20.4).
 */
export const invitationTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is not valid');

export const acceptInvitationSchema = z.object({
  token: invitationTokenSchema,
  /** Collected when the invited person does not have a display name yet. */
  displayName: z.string().trim().min(1).max(120).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const invitationIdParamSchema = z.object({ invitationId: invitationIdSchema });

export const invitationSummarySchema = z.object({
  invitationId: invitationIdSchema,
  email: emailSchema,
  role: orgRoleSchema,
  status: invitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  invitedByDisplayName: z.string().nullable(),
});
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;
