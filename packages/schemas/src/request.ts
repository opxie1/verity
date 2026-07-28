import { z } from 'zod';
import {
  accessChangeFieldsSchema,
  bankAccountChangeFieldsSchema,
  confidentialDataDisclosureFieldsSchema,
  customActionFieldsSchema,
  paymentRequestFieldsSchema,
  payrollChangeFieldsSchema,
} from './action-fields';
import { normalizedText, requestIdSchema, userIdSchema } from './common';
import { actionTypeSchema, requestStatusSchema, sourceTypeSchema } from './enums';

/**
 * Where the request came from (PRD 14.3).
 *
 * Metadata only. The message body is never captured by default, so a request
 * cannot quietly carry the contents of somebody's mailbox into Verity
 * (PRD NFR-002).
 */
export const requestSourceSchema = z.object({
  type: sourceTypeSchema,
  messageId: normalizedText(200).optional(),
  threadId: normalizedText(200).optional(),
  senderEmail: z.string().trim().toLowerCase().max(254).optional(),
  subject: normalizedText(500).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => value === '' || /^https:\/\//i.test(value),
      'Source links must use https',
    )
    .optional(),
});
export type RequestSource = z.infer<typeof requestSourceSchema>;

const baseCreateRequest = {
  organizationId: z.string(),
  assignedApproverUserId: userIdSchema,
  expiresInMinutes: z.number().int().min(5).max(43_200),
  source: requestSourceSchema.optional(),
};

/**
 * Discriminated on `actionType`, so the field schema applied is decided by the
 * action rather than by whichever fields happen to be present. A payment
 * request cannot be submitted carrying bank-change fields.
 */
export const createRequestSchema = z.discriminatedUnion('actionType', [
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('PAYMENT_REQUEST'),
    fields: paymentRequestFieldsSchema,
  }),
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('BANK_ACCOUNT_CHANGE'),
    fields: bankAccountChangeFieldsSchema,
  }),
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('PAYROLL_CHANGE'),
    fields: payrollChangeFieldsSchema,
  }),
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('ACCESS_CHANGE'),
    fields: accessChangeFieldsSchema,
  }),
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('CONFIDENTIAL_DATA_DISCLOSURE'),
    fields: confidentialDataDisclosureFieldsSchema,
  }),
  z.object({
    ...baseCreateRequest,
    actionType: z.literal('CUSTOM'),
    fields: customActionFieldsSchema,
  }),
]);
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const cancelRequestSchema = z.object({
  reason: normalizedText(300).optional(),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

export const requestIdParamSchema = z.object({ requestId: requestIdSchema });

export const listRequestsQuerySchema = z.object({
  status: requestStatusSchema.optional(),
  actionType: actionTypeSchema.optional(),
  requesterUserId: userIdSchema.optional(),
  approverUserId: userIdSchema.optional(),
  threadId: z.string().trim().max(200).optional(),
  /** Inclusive bounds on payment amounts, in minor units. */
  minAmountMinor: z.coerce.number().int().nonnegative().optional(),
  maxAmountMinor: z.coerce.number().int().nonnegative().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/**
 * Compares a set of current details against what was approved (PRD 14.5).
 *
 * The caller submits the values they are about to act on; the server reports
 * whether they still match the approved payload. Only the comparison result is
 * returned, never a corrected payload, so this cannot be used to read out
 * fields the caller does not already know.
 */
export const compareRequestSchema = z.object({
  fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type CompareRequestInput = z.infer<typeof compareRequestSchema>;

export const fieldComparisonSchema = z.object({
  field: z.string(),
  label: z.string(),
  matches: z.boolean(),
  highRisk: z.boolean(),
  approvedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  submittedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const compareRequestResultSchema = z.object({
  matches: z.boolean(),
  status: requestStatusSchema,
  comparisons: z.array(fieldComparisonSchema),
});
export type CompareRequestResult = z.infer<typeof compareRequestResultSchema>;
