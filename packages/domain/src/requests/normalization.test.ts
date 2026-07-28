import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  actionFieldsOf,
  buildProtectedPayload,
  canonicalize,
  compareToApprovedPayload,
  computePayloadHash,
  type CanonicalObject,
} from './normalization';

const baseInput = {
  actionType: 'PAYMENT_REQUEST',
  organizationId: 'org_789',
  requesterUserId: 'usr_123',
  approverUserId: 'usr_456',
  sourceMessageId: 'gmail_message_abc',
  expiresAt: new Date('2026-07-28T01:00:00.000Z'),
  nonce: 'server_generated_random_value',
};

const paymentFields = {
  amountMinor: 2_500_000,
  currency: 'USD',
  recipientLegalName: 'ABC Consulting LLC',
  accountLastFour: '4821',
  paymentReason: 'July consulting invoice',
  requestedCompletionDate: '2026-07-30',
};

describe('canonicalize', () => {
  it('orders object keys independently of insertion order', () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('orders nested object keys too', () => {
    expect(canonicalize({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it('normalizes equivalent Unicode spellings to the same bytes', () => {
    // Written as escapes so the assertion cannot be flattened by whatever
    // encoding this file happens to be saved in: a precomposed e-acute, and
    // the same letter written as `e` followed by a combining acute accent.
    const precomposed = { name: 'Jos\u00E9' };
    const decomposed = { name: 'Jose\u0301' };

    // The two strings are genuinely different sequences of code points.
    expect(precomposed.name).not.toBe(decomposed.name);
    expect(canonicalize(precomposed)).toBe(canonicalize(decomposed));
  });

  it('distinguishes null from an empty string', () => {
    expect(canonicalize({ memo: null })).not.toBe(canonicalize({ memo: '' }));
  });

  it('distinguishes a number from its string form', () => {
    expect(canonicalize({ amountMinor: 1000 })).not.toBe(canonicalize({ amountMinor: '1000' }));
  });

  it('refuses non-integer numbers rather than hashing a float', () => {
    expect(() => canonicalize({ amount: 25.5 })).toThrow(DomainError);
    expect(() => canonicalize({ amount: 0.1 + 0.2 })).toThrow(DomainError);
  });

  it('refuses undefined rather than silently dropping the field', () => {
    // JSON.stringify would produce "{}" here, quietly losing a protected field.
    expect(() => canonicalize({ accountLastFour: undefined } as never)).toThrow(DomainError);
    expect(JSON.stringify({ accountLastFour: undefined })).toBe('{}');
  });

  it('escapes strings so that structure cannot be forged from content', () => {
    const sneaky = canonicalize({ a: '","b":"' });
    expect(JSON.parse(sneaky)).toEqual({ a: '","b":"' });
  });
});

describe('computePayloadHash', () => {
  it('is stable across runs for the same payload', () => {
    const payload = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    expect(computePayloadHash(payload)).toBe(computePayloadHash(payload));
  });

  it('is independent of the order fields were supplied in', () => {
    const forwards = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    const backwards = buildProtectedPayload({
      ...baseInput,
      fields: Object.fromEntries(Object.entries(paymentFields).reverse()),
    });
    expect(computePayloadHash(forwards)).toBe(computePayloadHash(backwards));
  });

  it('produces a 64-character lowercase hex digest', () => {
    const payload = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    expect(computePayloadHash(payload)).toMatch(/^[0-9a-f]{64}$/);
  });

  // Each of these is a change that must invalidate an approval (PRD 18.4).
  it.each([
    ['the amount', { amountMinor: 2_500_001 }],
    ['the currency', { currency: 'EUR' }],
    ['the recipient', { recipientLegalName: 'ABC Consulting LLD' }],
    ['the account', { accountLastFour: '9914' }],
    ['the reason', { paymentReason: 'August consulting invoice' }],
    ['the completion date', { requestedCompletionDate: '2026-07-31' }],
  ])('changes when %s changes', (_label, override) => {
    const original = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    const altered = buildProtectedPayload({
      ...baseInput,
      fields: { ...paymentFields, ...override },
    });
    expect(computePayloadHash(altered)).not.toBe(computePayloadHash(original));
  });

  it('changes when the approver changes', () => {
    const original = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    const reassigned = buildProtectedPayload({
      ...baseInput,
      approverUserId: 'usr_999',
      fields: paymentFields,
    });
    expect(computePayloadHash(reassigned)).not.toBe(computePayloadHash(original));
  });

  it('changes when the nonce changes, so two identical requests never share a hash', () => {
    const first = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    const second = buildProtectedPayload({
      ...baseInput,
      nonce: 'a_different_nonce',
      fields: paymentFields,
    });
    expect(computePayloadHash(second)).not.toBe(computePayloadHash(first));
  });

  it('changes when the expiry changes', () => {
    const original = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    const extended = buildProtectedPayload({
      ...baseInput,
      expiresAt: new Date('2026-07-28T02:00:00.000Z'),
      fields: paymentFields,
    });
    expect(computePayloadHash(extended)).not.toBe(computePayloadHash(original));
  });
});

describe('buildProtectedPayload', () => {
  it('matches the shape documented in the PRD', () => {
    const payload = buildProtectedPayload({ ...baseInput, fields: paymentFields });

    expect(payload).toEqual({
      actionType: 'PAYMENT_REQUEST',
      amountMinor: 2_500_000,
      currency: 'USD',
      recipientLegalName: 'ABC Consulting LLC',
      accountLastFour: '4821',
      paymentReason: 'July consulting invoice',
      requestedCompletionDate: '2026-07-30',
      requesterUserId: 'usr_123',
      approverUserId: 'usr_456',
      organizationId: 'org_789',
      sourceMessageId: 'gmail_message_abc',
      expiresAt: '2026-07-28T01:00:00.000Z',
      nonce: 'server_generated_random_value',
      schemaVersion: 1,
    });
  });

  it('trims surrounding whitespace so it cannot change the hash', () => {
    const padded = buildProtectedPayload({
      ...baseInput,
      fields: { ...paymentFields, recipientLegalName: '  ABC Consulting LLC  ' },
    });
    const clean = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    expect(computePayloadHash(padded)).toBe(computePayloadHash(clean));
  });

  it('uppercases the currency code', () => {
    const lower = buildProtectedPayload({
      ...baseInput,
      fields: { ...paymentFields, currency: 'usd' },
    });
    expect(lower.currency).toBe('USD');
    expect(computePayloadHash(lower)).toBe(
      computePayloadHash(buildProtectedPayload({ ...baseInput, fields: paymentFields })),
    );
  });

  it('lowercases email fields', () => {
    const payload = buildProtectedPayload({
      ...baseInput,
      fields: { ...paymentFields, contactEmail: 'Finance@Example.COM' },
    });
    expect(payload.contactEmail).toBe('finance@example.com');
  });

  it('hashes an omitted optional field and a blank one identically', () => {
    const omitted = buildProtectedPayload({ ...baseInput, fields: paymentFields });

    // Three ways of saying "there is no memo" must not produce three receipts.
    for (const blankValue of ['', '   ', null]) {
      const blank = buildProtectedPayload({
        ...baseInput,
        fields: { ...paymentFields, memo: blankValue },
      });
      expect(blank.memo).toBeUndefined();
      expect(computePayloadHash(blank)).toBe(computePayloadHash(omitted));
    }

    // A memo with actual content is a different action.
    const withMemo = buildProtectedPayload({
      ...baseInput,
      fields: { ...paymentFields, memo: 'Second instalment' },
    });
    expect(computePayloadHash(withMemo)).not.toBe(computePayloadHash(omitted));
  });

  it('keeps the identity block even when a source is absent', () => {
    const payload = buildProtectedPayload({
      ...baseInput,
      sourceMessageId: null,
      fields: paymentFields,
    });
    // The skeleton is fixed, so a manually raised request and one from Gmail
    // still describe themselves the same way.
    expect(payload).toHaveProperty('sourceMessageId', null);
    expect(payload).toHaveProperty('schemaVersion', 1);
  });

  it('refuses an action field that would shadow a reserved key', () => {
    expect(() =>
      buildProtectedPayload({
        ...baseInput,
        fields: { ...paymentFields, approverUserId: 'usr_attacker' },
      }),
    ).toThrow(DomainError);
  });

  it('renders the expiry in UTC regardless of how the date was constructed', () => {
    const payload = buildProtectedPayload({
      ...baseInput,
      expiresAt: new Date(Date.UTC(2026, 6, 28, 1, 0, 0)),
      fields: paymentFields,
    });
    expect(payload.expiresAt).toBe('2026-07-28T01:00:00.000Z');
  });
});

describe('actionFieldsOf', () => {
  it('returns the action detail without the request identifiers', () => {
    const payload = buildProtectedPayload({ ...baseInput, fields: paymentFields });
    expect(Object.keys(actionFieldsOf(payload)).sort()).toEqual(
      Object.keys(paymentFields).sort(),
    );
  });
});

describe('compareToApprovedPayload', () => {
  const approved = buildProtectedPayload({
    ...baseInput,
    fields: paymentFields,
  }) as CanonicalObject;

  it('reports a match when the details are unchanged', () => {
    const result = compareToApprovedPayload(approved, paymentFields);
    expect(result.every((entry) => entry.matches)).toBe(true);
  });

  it('reports a mismatch when the account has been changed', () => {
    const result = compareToApprovedPayload(approved, {
      ...paymentFields,
      accountLastFour: '9914',
    });
    const account = result.find((entry) => entry.field === 'accountLastFour');
    expect(account?.matches).toBe(false);
    expect(account?.approvedValue).toBe('4821');
    expect(account?.submittedValue).toBe('9914');
    expect(result.filter((entry) => !entry.matches)).toHaveLength(1);
  });

  it('ignores differences that carry no meaning', () => {
    const result = compareToApprovedPayload(approved, {
      ...paymentFields,
      recipientLegalName: '  ABC Consulting LLC ',
      currency: 'usd',
    });
    expect(result.every((entry) => entry.matches)).toBe(true);
  });

  it('reports a field that is missing from the submitted details', () => {
    const { accountLastFour: _removed, ...withoutAccount } = paymentFields;
    const result = compareToApprovedPayload(approved, withoutAccount);
    expect(result.find((entry) => entry.field === 'accountLastFour')?.matches).toBe(false);
  });

  it('reports a field that was never approved', () => {
    const result = compareToApprovedPayload(approved, {
      ...paymentFields,
      secondaryAccount: '0001',
    });
    const extra = result.find((entry) => entry.field === 'secondaryAccount');
    expect(extra?.matches).toBe(false);
    expect(extra?.approvedValue).toBeNull();
  });
});
