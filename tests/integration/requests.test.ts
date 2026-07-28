import { prisma } from '@verity/database';
import {
  cancelRequest,
  compareRequestDetails,
  computePayloadHash,
  createRequest,
  expireLapsedRequests,
  getRequest,
  listRequests,
  requireMembership,
  type CanonicalObject,
  type MembershipContext,
} from '@verity/domain';
import { describe, expect, it } from 'vitest';
import { addMember, createOrganizationWithAdmin, testContext } from './setup/factories';

const paymentFields = {
  amountMinor: 2_500_000,
  currency: 'USD',
  recipientLegalName: 'ABC Consulting LLC',
  accountLastFour: '4821',
  paymentReason: 'July consulting invoice',
  requestedCompletionDate: '2026-07-30',
};

/** An organization with a requester and an approver, ready to raise requests. */
async function scenario() {
  const { organizationId, admin } = await createOrganizationWithAdmin();
  const requesterUser = await addMember(organizationId, 'REQUESTER', { displayName: 'Alex' });
  const approverUser = await addMember(organizationId, 'APPROVER', { displayName: 'Jane' });

  return {
    organizationId,
    admin,
    requesterUser,
    approverUser,
    requester: await requireMembership(requesterUser, organizationId),
    approver: await requireMembership(approverUser, organizationId),
    adminMembership: await requireMembership(admin, organizationId),
  };
}

function paymentInput(organizationId: string, approverUserId: string, overrides = {}) {
  return {
    organizationId,
    assignedApproverUserId: approverUserId,
    actionType: 'PAYMENT_REQUEST' as const,
    expiresInMinutes: 60,
    fields: paymentFields,
    ...overrides,
  };
}

describe('creating a request', () => {
  it('starts pending with a server-computed hash and nonce', async () => {
    const s = await scenario();

    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    expect(created.status).toBe('PENDING');
    expect(created.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.nonce.length).toBeGreaterThan(20);

    // The stored hash really is the hash of the stored payload.
    const payload = created.protectedPayloadJson as CanonicalObject;
    expect(computePayloadHash(payload)).toBe(created.payloadHash);
    expect(payload.nonce).toBe(created.nonce);
    expect(payload.approverUserId).toBe(s.approverUser.id);
    expect(payload.organizationId).toBe(s.organizationId);
  });

  it('gives two identical requests different hashes', async () => {
    const s = await scenario();
    const input = paymentInput(s.organizationId, s.approverUser.id);

    const first = await createRequest(s.requester, input, testContext());
    const second = await createRequest(s.requester, input, testContext());

    // The server nonce is what stops an approval for one being presented as an
    // approval for the other (PRD 18.5).
    expect(second.payloadHash).not.toBe(first.payloadHash);
  });

  it('builds a summary naming the amount, recipient and account', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    expect(created.displaySummary).toContain('$25,000.00');
    expect(created.displaySummary).toContain('ABC Consulting LLC');
    expect(created.displaySummary).toContain('4821');
  });

  it('ignores a payload hash supplied by the caller', async () => {
    const s = await scenario();

    const created = await createRequest(
      s.requester,
      // A client trying to pin the hash to a value of its choosing.
      paymentInput(s.organizationId, s.approverUser.id, {
        payloadHash: '0'.repeat(64),
        nonce: 'attacker-chosen-nonce',
      }) as never,
      testContext(),
    );

    expect(created.payloadHash).not.toBe('0'.repeat(64));
    expect(created.nonce).not.toBe('attacker-chosen-nonce');
  });

  it('refuses an approver who is not allowed to decide', async () => {
    const s = await scenario();
    const auditor = await addMember(s.organizationId, 'AUDITOR');

    await expect(
      createRequest(s.requester, paymentInput(s.organizationId, auditor.id), testContext()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an approver from another organization', async () => {
    const s = await scenario();
    const other = await createOrganizationWithAdmin();

    await expect(
      createRequest(s.requester, paymentInput(s.organizationId, other.admin.id), testContext()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a disabled approver', async () => {
    const s = await scenario();
    await prisma.organizationMember.updateMany({
      where: { organizationId: s.organizationId, userId: s.approverUser.id },
      data: { status: 'DISABLED' },
    });

    await expect(
      createRequest(s.requester, paymentInput(s.organizationId, s.approverUser.id), testContext()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses self-approval unless the policy allows it', async () => {
    const s = await scenario();

    await expect(
      createRequest(
        s.adminMembership,
        paymentInput(s.organizationId, s.admin.id),
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await prisma.organizationPolicy.update({
      where: { organizationId: s.organizationId },
      data: { allowSelfApproval: true },
    });

    await expect(
      createRequest(s.adminMembership, paymentInput(s.organizationId, s.admin.id), testContext()),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('refuses an expiry longer than the organization permits', async () => {
    const s = await scenario();

    await expect(
      createRequest(
        s.requester,
        paymentInput(s.organizationId, s.approverUser.id, { expiresInMinutes: 40_000 }),
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('does not let an approver raise a request', async () => {
    const s = await scenario();

    await expect(
      createRequest(s.approver, paymentInput(s.organizationId, s.approverUser.id), testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('records creation and submission in the audit log without the payload', async () => {
    const s = await scenario();
    const ctx = testContext();

    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      ctx,
    );

    const events = await prisma.auditEvent.findMany({
      where: { requestCorrelationId: ctx.correlationId },
      orderBy: { createdAt: 'asc' },
    });

    expect(events.map((event) => event.eventType)).toEqual([
      'REQUEST_CREATED',
      'REQUEST_SUBMITTED',
    ]);

    // The audit record carries the fingerprint, not the account details.
    const serialized = JSON.stringify(events.map((event) => event.metadata));
    expect(serialized).toContain(created.payloadHash);
    expect(serialized).not.toContain('4821');
    expect(serialized).not.toContain('ABC Consulting');
  });
});

describe('reading requests', () => {
  it('hides a request from a colleague who is neither party to it', async () => {
    const s = await scenario();
    const otherRequesterUser = await addMember(s.organizationId, 'REQUESTER');
    const otherRequester = await requireMembership(otherRequesterUser, s.organizationId);

    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await expect(getRequest(otherRequester, created.id)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
    });
  });

  it('shows a request to both the requester and the assigned approver', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await expect(getRequest(s.requester, created.id)).resolves.toMatchObject({
      viewerIsRequester: true,
    });
    await expect(getRequest(s.approver, created.id)).resolves.toMatchObject({
      viewerIsApprover: true,
    });
  });

  it('shows every request to an administrator and an auditor', async () => {
    const s = await scenario();
    const auditorUser = await addMember(s.organizationId, 'AUDITOR');
    const auditor = await requireMembership(auditorUser, s.organizationId);

    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await expect(getRequest(s.adminMembership, created.id)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(getRequest(auditor, created.id)).resolves.toMatchObject({ id: created.id });
  });

  it('reports a request in another organization as missing', async () => {
    const s = await scenario();
    const other = await createOrganizationWithAdmin();
    const otherAdmin = await requireMembership(other.admin, other.organizationId);

    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await expect(getRequest(otherAdmin, created.id)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
    });
  });

  it('scopes the list to the caller and their organization', async () => {
    const s = await scenario();
    const other = await createOrganizationWithAdmin();
    const otherRequesterUser = await addMember(other.organizationId, 'REQUESTER');
    const otherApproverUser = await addMember(other.organizationId, 'APPROVER');
    const otherRequester = await requireMembership(otherRequesterUser, other.organizationId);

    await createRequest(s.requester, paymentInput(s.organizationId, s.approverUser.id), testContext());
    await createRequest(
      otherRequester,
      paymentInput(other.organizationId, otherApproverUser.id),
      testContext(),
    );

    const mine = await listRequests(s.adminMembership, { limit: 50 });
    const theirs = await listRequests(
      await requireMembership(other.admin, other.organizationId),
      { limit: 50 },
    );

    expect(mine.requests).toHaveLength(1);
    expect(theirs.requests).toHaveLength(1);
    expect(mine.requests[0]?.id).not.toBe(theirs.requests[0]?.id);
  });
});

describe('cancelling a request', () => {
  it('lets the requester cancel and records it', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    const ctx = testContext();
    await cancelRequest(s.requester, created.id, { reason: 'Confirmed by phone' }, ctx);

    const after = await getRequest(s.requester, created.id);
    expect(after.status).toBe('CANCELED');
    expect(after.canceledAt).not.toBeNull();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'REQUEST_CANCELED' },
    });
    expect(event.previousState).toBe('PENDING');
    expect(event.newState).toBe('CANCELED');
  });

  it('does not let the approver cancel', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await expect(
      cancelRequest(s.approver, created.id, {}, testContext()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('cannot cancel twice', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await cancelRequest(s.requester, created.id, {}, testContext());
    await expect(cancelRequest(s.requester, created.id, {}, testContext())).rejects.toMatchObject({
      code: 'REQUEST_CANCELED',
    });
  });
});

describe('expiry', () => {
  it('reads as expired the moment it lapses, before any job runs', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );

    await prisma.verificationRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const read = await getRequest(s.requester, created.id);
    expect(read.status).toBe('EXPIRED');

    // The stored row still says PENDING until reconciliation catches up.
    const row = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('PENDING');
  });

  it('reconciles lapsed requests and records who did it', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );
    await prisma.verificationRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const ctx = testContext();
    const result = await expireLapsedRequests(ctx);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const row = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('EXPIRED');

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: {
        requestCorrelationId: ctx.correlationId,
        eventType: 'REQUEST_EXPIRED',
        targetId: created.id,
      },
    });
    // Nothing human expired it, so no actor is claimed.
    expect(event.actorUserId).toBeNull();
  });

  it('cannot be cancelled once expired', async () => {
    const s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );
    await prisma.verificationRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(cancelRequest(s.requester, created.id, {}, testContext())).rejects.toMatchObject({
      code: 'REQUEST_EXPIRED',
    });
  });
});

describe('comparing details against a request', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  let requestId: string;

  async function setup(): Promise<MembershipContext> {
    s = await scenario();
    const created = await createRequest(
      s.requester,
      paymentInput(s.organizationId, s.approverUser.id),
      testContext(),
    );
    requestId = created.id;
    return s.requester;
  }

  it('flags a changed account number', async () => {
    const requester = await setup();

    const result = await compareRequestDetails(requester, requestId, {
      ...paymentFields,
      accountLastFour: '9914',
    });

    const account = result.comparisons.find((entry) => entry.field === 'accountLastFour');
    expect(account?.matches).toBe(false);
    expect(result.matches).toBe(false);
  });

  it('does not call unchanged details a match while the request is still pending', async () => {
    const requester = await setup();

    const result = await compareRequestDetails(requester, requestId, paymentFields);

    // Every field agrees, but nothing has been approved, so there is no
    // authority to act on.
    expect(result.comparisons.every((entry) => entry.matches)).toBe(true);
    expect(result.status).toBe('PENDING');
    expect(result.matches).toBe(false);
  });
});
