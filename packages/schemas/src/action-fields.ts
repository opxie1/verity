import { z } from 'zod';
import {
  amountMinorSchema,
  currencySchema,
  isoDateSchema,
  lastFourSchema,
  normalizedText,
  requiredText,
} from './common';

/**
 * The protected fields for each action type (PRD section 13).
 *
 * Every field here is part of what the approver authorizes and part of what
 * gets hashed. Display-only text is deliberately not in these schemas: putting
 * it in the protected payload would mean cosmetic edits invalidate a receipt,
 * and leaving a *meaningful* field out would mean it could be changed after
 * approval without detection.
 */

/** Hex SHA-256 of an attached document, so the file is bound without storing it. */
const documentHashSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 hash');

export const paymentRequestFieldsSchema = z.object({
  amountMinor: amountMinorSchema,
  currency: currencySchema,
  recipientLegalName: requiredText(200, "Enter the recipient's full legal name"),
  accountLastFour: lastFourSchema,
  paymentReason: requiredText(300, 'Say what this payment is for'),
  requestedCompletionDate: isoDateSchema,

  invoiceNumber: normalizedText(60).optional(),
  vendorName: normalizedText(200).optional(),
  memo: normalizedText(500).optional(),
  attachmentSha256: documentHashSchema.optional(),
});
export type PaymentRequestFields = z.infer<typeof paymentRequestFieldsSchema>;

export const bankAccountChangeFieldsSchema = z.object({
  subjectName: requiredText(200, 'Enter the vendor or employee name'),
  previousAccountLastFour: lastFourSchema.optional(),
  newAccountLastFour: lastFourSchema,
  effectiveDate: isoDateSchema,
  changeReason: requiredText(300, 'Say why the account is changing'),

  routingNumberLastFour: lastFourSchema.optional(),
  supportingDocumentSha256: documentHashSchema.optional(),
  contactPerson: normalizedText(200).optional(),
  notes: normalizedText(500).optional(),
});
export type BankAccountChangeFields = z.infer<typeof bankAccountChangeFieldsSchema>;

export const payrollChangeFieldsSchema = z.object({
  employeeName: requiredText(200, "Enter the employee's name"),
  changeType: requiredText(120, 'Say what is changing'),
  effectiveDate: isoDateSchema,
  destinationAccountLastFour: lastFourSchema,
  requestedBy: requiredText(200, 'Say who asked for this change'),
  notes: normalizedText(500).optional(),
});
export type PayrollChangeFields = z.infer<typeof payrollChangeFieldsSchema>;

export const accessChangeFieldsSchema = z.object({
  affectedUser: requiredText(200, 'Enter the affected user'),
  systemName: requiredText(200, 'Enter the system'),
  requestedPermission: requiredText(200, 'Enter the permission being granted'),
  duration: requiredText(120, 'Say how long the access lasts'),
  accessReason: requiredText(300, 'Say why the access is needed'),
});
export type AccessChangeFields = z.infer<typeof accessChangeFieldsSchema>;

export const confidentialDataDisclosureFieldsSchema = z.object({
  dataCategory: requiredText(200, 'Say what kind of data this is'),
  recipient: requiredText(200, 'Enter the recipient'),
  deliveryMethod: requiredText(120, 'Say how it will be delivered'),
  businessPurpose: requiredText(300, 'Say why it is being disclosed'),
  accessExpiration: requiredText(120, 'Say when access ends'),
});
export type ConfidentialDataDisclosureFields = z.infer<
  typeof confidentialDataDisclosureFieldsSchema
>;

/**
 * A custom action still has to be specific. At least one structured key-value
 * pair is required, because "approve this email" is exactly the ambiguity the
 * product exists to remove (PRD 10.1).
 */
export const customActionFieldsSchema = z.object({
  actionTitle: requiredText(120, 'Give this action a title'),
  actionDescription: requiredText(1000, 'Describe in plain language what is being approved'),
  details: z
    .array(
      z.object({
        key: requiredText(60, 'Enter a label'),
        value: requiredText(300, 'Enter a value'),
      }),
    )
    .min(1, 'Add at least one detail so the approver knows exactly what they are approving')
    .max(20),
});
export type CustomActionFields = z.infer<typeof customActionFieldsSchema>;

export const ACTION_FIELD_SCHEMAS = {
  PAYMENT_REQUEST: paymentRequestFieldsSchema,
  BANK_ACCOUNT_CHANGE: bankAccountChangeFieldsSchema,
  PAYROLL_CHANGE: payrollChangeFieldsSchema,
  ACCESS_CHANGE: accessChangeFieldsSchema,
  CONFIDENTIAL_DATA_DISCLOSURE: confidentialDataDisclosureFieldsSchema,
  CUSTOM: customActionFieldsSchema,
} as const;

/**
 * Human-readable labels for every protected field, used to build the detail
 * table an approver reads before deciding (PRD 23.3).
 */
export const FIELD_LABELS: Record<string, string> = {
  amountMinor: 'Amount',
  currency: 'Currency',
  recipientLegalName: 'Recipient legal name',
  accountLastFour: 'Account ending',
  paymentReason: 'Reason for payment',
  requestedCompletionDate: 'Requested completion date',
  invoiceNumber: 'Invoice number',
  vendorName: 'Vendor',
  memo: 'Memo',
  attachmentSha256: 'Attached document fingerprint',

  subjectName: 'Vendor or employee',
  previousAccountLastFour: 'Previous account ending',
  newAccountLastFour: 'New account ending',
  effectiveDate: 'Effective date',
  changeReason: 'Reason for change',
  routingNumberLastFour: 'Routing number ending',
  supportingDocumentSha256: 'Supporting document fingerprint',
  contactPerson: 'Contact person',
  notes: 'Notes',

  employeeName: 'Employee',
  changeType: 'Type of change',
  destinationAccountLastFour: 'Destination account ending',
  requestedBy: 'Requested by',

  affectedUser: 'Affected user',
  systemName: 'System',
  requestedPermission: 'Permission',
  duration: 'Duration',
  accessReason: 'Reason for access',

  dataCategory: 'Data category',
  recipient: 'Recipient',
  deliveryMethod: 'Delivery method',
  businessPurpose: 'Business purpose',
  accessExpiration: 'Access expires',

  actionTitle: 'Action',
  actionDescription: 'Description',
};

/**
 * Fields whose change is most likely to indicate fraud rather than a
 * correction. The interface calls these out specifically when a comparison
 * does not match an approved receipt (PRD 18.4, 34 Risk 5).
 */
export const HIGH_RISK_FIELDS = new Set([
  'amountMinor',
  'currency',
  'accountLastFour',
  'newAccountLastFour',
  'destinationAccountLastFour',
  'routingNumberLastFour',
  'recipientLegalName',
  'subjectName',
  'recipient',
]);
