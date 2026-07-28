import { z } from 'zod';
import { currencySchema, emailSchema, memberIdSchema, requiredText } from './common';
import { memberStatusSchema, orgRoleSchema } from './enums';

/**
 * A business email domain such as `acme.com`. Stored without scheme or path;
 * it is descriptive only and never used to grant access on its own.
 */
export const businessDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Enter a domain such as acme.com',
  )
  .max(253);

export const createOrganizationSchema = z.object({
  name: requiredText(120, 'Enter your organization name'),
  domain: businessDomainSchema.optional(),
  administratorName: requiredText(120, 'Enter your name'),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: requiredText(120).optional(),
    domain: businessDomainSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Organization policy (PRD FR-020). In the MVP these produce warnings and
 * server-side guards inside Verity; they do not control anything outside it.
 */
export const organizationPolicySchema = z.object({
  allowSelfApproval: z.boolean(),
  defaultExpirationMinutes: z.number().int().min(5).max(43_200),
  maximumExpirationMinutes: z.number().int().min(5).max(43_200),
  requirePasskeyEnrollment: z.boolean(),
  verificationRecommendedThresholdMinor: z.number().int().nonnegative().nullable(),
  currency: currencySchema,
});
export type OrganizationPolicyInput = z.infer<typeof organizationPolicySchema>;

export const updateOrganizationPolicySchema = organizationPolicySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .refine(
    (value) =>
      value.defaultExpirationMinutes === undefined ||
      value.maximumExpirationMinutes === undefined ||
      value.defaultExpirationMinutes <= value.maximumExpirationMinutes,
    {
      message: 'The default expiration cannot be longer than the maximum expiration',
      path: ['defaultExpirationMinutes'],
    },
  );
export type UpdateOrganizationPolicyInput = z.infer<typeof updateOrganizationPolicySchema>;

export const updateMemberSchema = z
  .object({
    role: orgRoleSchema.optional(),
    status: memberStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberIdParamSchema = z.object({ memberId: memberIdSchema });

/** Shape returned by the members list, used by the admin UI (PRD FR-004). */
export const memberSummarySchema = z.object({
  memberId: memberIdSchema,
  userId: z.string(),
  email: emailSchema,
  displayName: z.string().nullable(),
  role: orgRoleSchema,
  status: memberStatusSchema,
  passkeyCount: z.number().int().nonnegative(),
  hasEnrolledPasskey: z.boolean(),
  joinedAt: z.string().datetime(),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;
