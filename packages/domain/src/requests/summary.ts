import type { ActionType } from '@verity/database';
import type { CanonicalObject, CanonicalValue } from './normalization';

/**
 * Plain-language descriptions of a request (PRD 10.3).
 *
 * Approvers see sentences, not JSON and not hashes. These strings are display
 * only and are deliberately excluded from the protected payload, so rewording
 * a summary can never invalidate an approval.
 */

/** Formats minor units for display: 2_500_000 USD becomes "$25,000.00". */
export function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(amountMinor / 100);
  } catch {
    // An unrecognised but well-formed ISO code should still render sensibly
    // rather than throwing in the middle of an approval screen.
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

function text(value: CanonicalValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function num(value: CanonicalValue | undefined): number {
  return typeof value === 'number' ? value : 0;
}

export function buildDisplayTitle(actionType: ActionType, payload: CanonicalObject): string {
  switch (actionType) {
    case 'PAYMENT_REQUEST':
      return `Payment of ${formatAmount(num(payload.amountMinor), text(payload.currency))} to ${text(payload.recipientLegalName)}`;
    case 'BANK_ACCOUNT_CHANGE':
      return `Bank-account change for ${text(payload.subjectName)}`;
    case 'PAYROLL_CHANGE':
      return `Payroll change for ${text(payload.employeeName)}`;
    case 'ACCESS_CHANGE':
      return `${text(payload.requestedPermission)} on ${text(payload.systemName)} for ${text(payload.affectedUser)}`;
    case 'CONFIDENTIAL_DATA_DISCLOSURE':
      return `Disclosure of ${text(payload.dataCategory)} to ${text(payload.recipient)}`;
    case 'CUSTOM':
      return text(payload.actionTitle);
    default:
      return 'Verification request';
  }
}

/**
 * One sentence naming every detail that matters, so an approver who reads
 * nothing else still sees the amount, the recipient and the account.
 */
export function buildDisplaySummary(actionType: ActionType, payload: CanonicalObject): string {
  switch (actionType) {
    case 'PAYMENT_REQUEST': {
      const amount = formatAmount(num(payload.amountMinor), text(payload.currency));
      return `Approve a ${amount} payment to ${text(payload.recipientLegalName)}, account ending ${text(payload.accountLastFour)}, for ${text(payload.paymentReason)}, by ${text(payload.requestedCompletionDate)}.`;
    }
    case 'BANK_ACCOUNT_CHANGE': {
      const from = text(payload.previousAccountLastFour);
      const movement = from
        ? `from the account ending ${from} to the account ending ${text(payload.newAccountLastFour)}`
        : `to the account ending ${text(payload.newAccountLastFour)}`;
      return `Approve changing payments for ${text(payload.subjectName)} ${movement}, effective ${text(payload.effectiveDate)}, because ${text(payload.changeReason)}.`;
    }
    case 'PAYROLL_CHANGE':
      return `Approve a payroll change for ${text(payload.employeeName)} (${text(payload.changeType)}) paying the account ending ${text(payload.destinationAccountLastFour)}, effective ${text(payload.effectiveDate)}.`;
    case 'ACCESS_CHANGE':
      return `Approve granting ${text(payload.affectedUser)} the permission "${text(payload.requestedPermission)}" on ${text(payload.systemName)} for ${text(payload.duration)}, because ${text(payload.accessReason)}.`;
    case 'CONFIDENTIAL_DATA_DISCLOSURE':
      return `Approve disclosing ${text(payload.dataCategory)} to ${text(payload.recipient)} by ${text(payload.deliveryMethod)}, for ${text(payload.businessPurpose)}, with access ending ${text(payload.accessExpiration)}.`;
    case 'CUSTOM':
      return text(payload.actionDescription);
    default:
      return 'Approve the action shown below.';
  }
}

/**
 * Renders one protected field for the detail table.
 *
 * Amounts are formatted, and document hashes are shortened, since a 64-character
 * hex string in a table teaches the reader to skip past it.
 */
export function formatFieldValue(
  field: string,
  value: CanonicalValue,
  payload: CanonicalObject,
): string {
  if (value === null) {
    return '—';
  }
  if (field === 'amountMinor' && typeof value === 'number') {
    return formatAmount(value, text(payload.currency));
  }
  if (field.toLowerCase().endsWith('sha256') && typeof value === 'string') {
    return `${value.slice(0, 12)}…${value.slice(-8)}`;
  }
  if (field.toLowerCase().endsWith('lastfour') && typeof value === 'string') {
    // Shown as a masked tail so nobody reads it as a whole account number.
    return `•••• ${value}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? `${String((entry as CanonicalObject).key ?? '')}: ${String((entry as CanonicalObject).value ?? '')}`
          : String(entry),
      )
      .join('; ');
  }
  return String(value);
}
