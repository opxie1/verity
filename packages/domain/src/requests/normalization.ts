import { createHash } from 'node:crypto';
import { DomainError } from '../errors';

/**
 * Canonical serialization and hashing of protected payloads (PRD FR-007, FR-008).
 *
 * Everything Verity claims rests on this file. A receipt says "this exact
 * action was approved", and the only thing tying the receipt to the action is
 * a hash. So the same action must always produce the same bytes, and any
 * meaningful difference must produce different bytes.
 *
 * The rules below exist because ordinary `JSON.stringify` satisfies neither:
 * key order follows insertion order, `undefined` disappears silently, and
 * floating point makes `0.1 + 0.2` a different amount than `0.3`.
 */

/** Values permitted in a protected payload. Deliberately narrow. */
export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | CanonicalObject;
export interface CanonicalObject {
  [key: string]: CanonicalValue;
}

export const PAYLOAD_SCHEMA_VERSION = 1;

/**
 * Serializes a value to canonical JSON.
 *
 * - Object keys are sorted by Unicode code point, so key order carries no
 *   meaning and cannot vary between a client and the server.
 * - Strings are Unicode-normalized to NFC, so "é" typed as one code point and
 *   as "e" plus a combining accent hash identically. Without this, two
 *   visually identical recipient names would produce different receipts.
 * - Numbers must be safe integers. Money is carried in minor units precisely
 *   so that no amount is ever a float, and rejecting floats outright means an
 *   ambiguous amount fails loudly instead of hashing something unexpected.
 * - `undefined` is rejected rather than dropped. An absent protected field
 *   must be an explicit `null`, so that "field omitted" and "field set to
 *   nothing" cannot collapse into the same hash.
 */
export function canonicalize(value: CanonicalValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'Amounts must be whole numbers.',
        internalDetail: `refusing to canonicalize non-integer number ${value}`,
      });
    }
    return String(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value.normalize('NFC'));
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const entry = value[key];
      if (entry === undefined) {
        throw new DomainError('VALIDATION_FAILED', {
          internalDetail: `protected payload field "${key}" was undefined; use null`,
        });
      }
      return `${JSON.stringify(key.normalize('NFC'))}:${canonicalize(entry)}`;
    });
    return `{${entries.join(',')}}`;
  }

  throw new DomainError('VALIDATION_FAILED', {
    internalDetail: `unsupported value of type ${typeof value} in protected payload`,
  });
}

/**
 * SHA-256 over the canonical serialization, as lowercase hex.
 *
 * Always computed on the server from the server's own normalized payload. A
 * hash supplied by a client is never read or compared (PRD FR-008, section 25).
 */
export function computePayloadHash(payload: CanonicalObject): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}

/** Normalizes a single field value according to the FR-007 rules. */
function normalizeFieldValue(key: string, value: unknown): CanonicalValue {
  if (value === undefined || value === null || value === '') {
    // Optional fields that were left blank become explicit nulls, so a request
    // that omits a memo and one that sets it to "" hash the same way, and both
    // differ from one that sets it to actual text.
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.normalize('NFC').trim();
    if (trimmed === '') {
      return null;
    }
    if (key === 'currency') {
      return trimmed.toUpperCase();
    }
    if (key.toLowerCase().endsWith('email')) {
      return trimmed.toLowerCase();
    }
    return trimmed;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeFieldValue(`${key}[${index}]`, entry));
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: CanonicalObject = {};
    for (const entryKey of Object.keys(source).sort()) {
      result[entryKey] = normalizeFieldValue(entryKey, source[entryKey]);
    }
    return result;
  }

  throw new DomainError('VALIDATION_FAILED', {
    internalDetail: `cannot normalize field "${key}" of type ${typeof value}`,
  });
}

export interface ProtectedPayloadInput {
  actionType: string;
  fields: Record<string, unknown>;
  organizationId: string;
  requesterUserId: string;
  approverUserId: string;
  sourceMessageId: string | null;
  expiresAt: Date;
  nonce: string;
}

/**
 * Builds the protected payload that gets hashed and shown to the approver.
 *
 * The action fields sit at the top level alongside the identifiers, matching
 * the example in PRD FR-007. Display-only text such as the summary line is
 * absent on purpose: rewording a summary must not invalidate an approval, and
 * anything that *should* invalidate it belongs in the fields.
 */
export function buildProtectedPayload(input: ProtectedPayloadInput): CanonicalObject {
  const payload: CanonicalObject = {
    actionType: input.actionType,
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
    approverUserId: input.approverUserId,
    sourceMessageId: input.sourceMessageId,
    // Millisecond-precision UTC, so the same instant always renders the same
    // way regardless of the server's timezone.
    expiresAt: input.expiresAt.toISOString(),
    nonce: input.nonce,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
  };

  for (const key of Object.keys(input.fields).sort()) {
    if (key in payload) {
      throw new DomainError('VALIDATION_FAILED', {
        internalDetail: `action field "${key}" collides with a reserved payload key`,
      });
    }

    const normalized = normalizeFieldValue(key, input.fields[key]);

    // An optional field that was left out and one that was submitted blank
    // mean the same thing, so they must hash the same way. Omitting the key
    // is what makes that true: keeping an explicit null would give the two
    // forms different hashes and a receipt that fails to match a request a
    // person would call identical.
    //
    // The identity block above keeps its keys either way, so the payload
    // always carries a fixed skeleton naming the action, the parties and the
    // expiry.
    if (normalized !== null) {
      payload[key] = normalized;
    }
  }

  return payload;
}

/** Keys that identify the request rather than describe the action. */
const RESERVED_KEYS = new Set([
  'actionType',
  'organizationId',
  'requesterUserId',
  'approverUserId',
  'sourceMessageId',
  'expiresAt',
  'nonce',
  'schemaVersion',
]);

/** The action fields alone, for display and for comparison. */
export function actionFieldsOf(payload: CanonicalObject): CanonicalObject {
  const fields: CanonicalObject = {};
  for (const key of Object.keys(payload)) {
    if (!RESERVED_KEYS.has(key)) {
      fields[key] = payload[key] as CanonicalValue;
    }
  }
  return fields;
}

/**
 * Compares submitted values against an approved payload, field by field
 * (PRD 14.5, 18.4).
 *
 * Comparison runs on normalized values, so trailing whitespace or a different
 * Unicode encoding of the same name does not read as tampering. Anything that
 * changes meaning does.
 */
export function compareToApprovedPayload(
  approved: CanonicalObject,
  submitted: Record<string, unknown>,
): { field: string; matches: boolean; approvedValue: CanonicalValue; submittedValue: CanonicalValue }[] {
  const approvedFields = actionFieldsOf(approved);
  const keys = new Set([...Object.keys(approvedFields), ...Object.keys(submitted)]);

  return [...keys].sort().map((field) => {
    const approvedValue = field in approvedFields ? approvedFields[field]! : null;
    const submittedValue = normalizeFieldValue(field, submitted[field]);
    return {
      field,
      // Compared through canonical form so that 1000 and "1000" are not
      // silently treated as equal.
      matches: canonicalize(approvedValue) === canonicalize(submittedValue),
      approvedValue,
      submittedValue,
    };
  });
}
