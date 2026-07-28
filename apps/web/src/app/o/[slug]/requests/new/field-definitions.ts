import type { ActionTypeValue } from '@verity/schemas';

/**
 * Drives the request form. Kept as data so that adding an action type is a
 * matter of describing its fields, and so the form cannot drift from the Zod
 * schemas without a type error at the call site.
 */
export interface FieldDefinition {
  name: string;
  label: string;
  kind: 'text' | 'longtext' | 'amount' | 'currency' | 'date' | 'lastFour';
  required: boolean;
  hint?: string;
  placeholder?: string;
}

export const ACTION_FIELDS: Partial<Record<ActionTypeValue, FieldDefinition[]>> = {
  PAYMENT_REQUEST: [
    {
      name: 'amountMinor',
      label: 'Amount',
      kind: 'amount',
      required: true,
      placeholder: '25000.00',
      hint: 'Exactly as it will be paid. The approver sees this figure and nothing else counts.',
    },
    { name: 'currency', label: 'Currency', kind: 'currency', required: true, placeholder: 'USD' },
    {
      name: 'recipientLegalName',
      label: 'Recipient legal name',
      kind: 'text',
      required: true,
      placeholder: 'ABC Consulting LLC',
      hint: 'The name on the account, not the trading name in the email.',
    },
    {
      name: 'accountLastFour',
      label: 'Account ending',
      kind: 'lastFour',
      required: true,
      placeholder: '4821',
      hint: 'Last four digits only. Verity never stores a full account number.',
    },
    {
      name: 'paymentReason',
      label: 'Reason for payment',
      kind: 'text',
      required: true,
      placeholder: 'July consulting invoice',
    },
    {
      name: 'requestedCompletionDate',
      label: 'Requested completion date',
      kind: 'date',
      required: true,
    },
    { name: 'invoiceNumber', label: 'Invoice number', kind: 'text', required: false },
    { name: 'vendorName', label: 'Vendor', kind: 'text', required: false },
    { name: 'memo', label: 'Memo', kind: 'longtext', required: false },
  ],

  BANK_ACCOUNT_CHANGE: [
    {
      name: 'subjectName',
      label: 'Vendor or employee',
      kind: 'text',
      required: true,
      placeholder: 'ABC Consulting LLC',
    },
    {
      name: 'previousAccountLastFour',
      label: 'Previous account ending',
      kind: 'lastFour',
      required: false,
      hint: 'If you know it. Showing the approver what is being replaced makes a substitution obvious.',
    },
    {
      name: 'newAccountLastFour',
      label: 'New account ending',
      kind: 'lastFour',
      required: true,
      placeholder: '9914',
    },
    { name: 'effectiveDate', label: 'Effective date', kind: 'date', required: true },
    {
      name: 'changeReason',
      label: 'Reason for change',
      kind: 'text',
      required: true,
      placeholder: 'Vendor moved banks',
    },
    {
      name: 'routingNumberLastFour',
      label: 'Routing number ending',
      kind: 'lastFour',
      required: false,
    },
    { name: 'contactPerson', label: 'Contact person', kind: 'text', required: false },
    { name: 'notes', label: 'Notes', kind: 'longtext', required: false },
  ],

  PAYROLL_CHANGE: [
    { name: 'employeeName', label: 'Employee', kind: 'text', required: true },
    { name: 'changeType', label: 'Type of change', kind: 'text', required: true },
    { name: 'effectiveDate', label: 'Effective date', kind: 'date', required: true },
    {
      name: 'destinationAccountLastFour',
      label: 'Destination account ending',
      kind: 'lastFour',
      required: true,
    },
    { name: 'requestedBy', label: 'Requested by', kind: 'text', required: true },
    { name: 'notes', label: 'Notes', kind: 'longtext', required: false },
  ],

  ACCESS_CHANGE: [
    { name: 'affectedUser', label: 'Affected user', kind: 'text', required: true },
    { name: 'systemName', label: 'System', kind: 'text', required: true },
    { name: 'requestedPermission', label: 'Permission', kind: 'text', required: true },
    { name: 'duration', label: 'Duration', kind: 'text', required: true },
    { name: 'accessReason', label: 'Reason for access', kind: 'longtext', required: true },
  ],

  CONFIDENTIAL_DATA_DISCLOSURE: [
    { name: 'dataCategory', label: 'Data category', kind: 'text', required: true },
    { name: 'recipient', label: 'Recipient', kind: 'text', required: true },
    { name: 'deliveryMethod', label: 'Delivery method', kind: 'text', required: true },
    { name: 'businessPurpose', label: 'Business purpose', kind: 'longtext', required: true },
    { name: 'accessExpiration', label: 'Access expires', kind: 'text', required: true },
  ],
};

export const EXPIRATION_CHOICES = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
];

/**
 * Parses a typed decimal amount into minor units.
 *
 * Done with string arithmetic rather than `parseFloat`, because 25000.10
 * cannot be represented exactly as a double and would round to the wrong
 * number of cents.
 */
export function parseAmountToMinor(input: string): number | null {
  const match = /^(\d{1,15})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return null;
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt((match[2] ?? '0').padEnd(2, '0'), 10);
  return major * 100 + minor;
}
