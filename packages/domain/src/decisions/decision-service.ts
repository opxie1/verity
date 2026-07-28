import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { prisma, type DecisionType, type Prisma } from '@verity/database';
import type { AuthenticationResponseInput } from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import { requirePermission } from '../authz/guards';
import type { MembershipContext, RequestContext } from '../context';
import { generateNonce, generatePrefixedId } from '../crypto/tokens';
import { DomainError } from '../errors';
import {
  buildAuthenticationOptions,
  verifyAssertionSignature,
} from '../passkeys/passkey-service';
import type { WebAuthnConfig } from '../passkeys/webauthn-config';
import { createReceipt } from '../receipts/receipt-service';
import type { ReceiptSigningConfig } from '../receipts/signing';
import { assertTransition, effectiveStatus } from '../requests/state-machine';
import {
  buildDecisionChallengePayload,
  decisionChallengeBytes,
  hashChallengeString,
} from './challenge';

/** A decision challenge is deliberately short-lived (PRD NFR-001). */
const DECISION_CHALLENGE_TTL_MS = 2 * 60 * 1000;

export interface DecisionOptions {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
  /** Echoed so the interface can show what is about to be signed. */
  payloadHash: string;
  expiresAt: Date;
}

/**
 * Issues a challenge for approving or denying a request (PRD 14.4, FR-010).
 *
 * Everything the decision means is folded into the challenge before the
 * authenticator ever sees it, so the resulting signature cannot be lifted onto
 * a different request or a different answer.
 */
export async function startDecision(
  membership: MembershipContext,
  requestId: string,
  decision: Exclude<DecisionType, 'REVOKE'>,
  webAuthnConfig: WebAuthnConfig,
  ctx: RequestContext,
): Promise<DecisionOptions> {
  requirePermission(membership, 'request:decide');

  const request = await loadDecidableRequest(membership, requestId, ctx);

  const challengeId = generatePrefixedId('chl');
  const expiresAt = new Date(Date.now() + DECISION_CHALLENGE_TTL_MS);

  const challengePayload = buildDecisionChallengePayload({
    requestId: request.id,
    payloadHash: request.payloadHash,
    decision,
    nonce: generateNonce(),
    challengeId,
    expiresAt,
  });

  const options = await buildAuthenticationOptions(
    membership.user,
    webAuthnConfig,
    decisionChallengeBytes(challengePayload),
  );

  await prisma.approvalChallenge.create({
    data: {
      id: challengeId,
      requestId: request.id,
      userId: membership.user.id,
      decision,
      // Only the digest of the issued challenge is stored, matching how
      // invitation tokens are handled (PRD 20.7).
      challengeHash: hashChallengeString(options.challenge),
      payloadHash: request.payloadHash,
      expiresAt,
    },
  });

  return { options, challengeId, payloadHash: request.payloadHash, expiresAt };
}

export interface CompleteDecisionInput {
  decision: Exclude<DecisionType, 'REVOKE'>;
  response: AuthenticationResponseInput;
  reason?: string | undefined;
}

export interface DecisionResult {
  requestId: string;
  status: 'APPROVED' | 'DENIED';
  receiptId: string;
  decidedAt: Date;
  approver: { id: string; displayName: string | null };
}

/**
 * Records a decision (PRD 14.4, FR-011).
 *
 * The order of operations matters. The challenge is spent first and
 * independently, so a failed attempt cannot be retried against it. Only then
 * is the signature checked, and only then does the request change state —
 * inside one transaction, conditional on the request still being pending, so
 * that a failed passkey attempt leaves the request exactly as it was.
 */
export async function completeDecision(
  membership: MembershipContext,
  requestId: string,
  input: CompleteDecisionInput,
  webAuthnConfig: WebAuthnConfig,
  signingConfig: ReceiptSigningConfig,
  ctx: RequestContext,
): Promise<DecisionResult> {
  requirePermission(membership, 'request:decide');

  try {
    const clientChallenge = readChallengeFromResponse(input.response);
    const challenge = await consumeDecisionChallenge(
      membership,
      requestId,
      input.decision,
      clientChallenge,
    );

    const request = await loadDecidableRequest(membership, requestId, ctx);

    // The details must not have changed since the challenge was issued. They
    // cannot, since a submitted payload is immutable, but checking makes the
    // guarantee explicit rather than incidental (PRD FR-011).
    if (challenge.payloadHash !== request.payloadHash) {
      throw new DomainError('PAYLOAD_HASH_MISMATCH');
    }

    const assertion = await verifyAssertionSignature(
      membership.user,
      input.response,
      webAuthnConfig,
    );

    const decidedAt = new Date();
    const nextStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
    const receiptId = generatePrefixedId('rcpt');

    return await prisma.$transaction(async (tx) => {
      const current = await tx.verificationRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { status: true, expiresAt: true, payloadHash: true },
      });

      assertTransition(effectiveStatus(current.status, current.expiresAt), nextStatus);
      if (current.payloadHash !== challenge.payloadHash) {
        throw new DomainError('PAYLOAD_HASH_MISMATCH');
      }

      // Conditional on PENDING, so two decisions racing cannot both land.
      const updated = await tx.verificationRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: {
          status: nextStatus,
          ...(input.decision === 'APPROVE'
            ? { approvedAt: decidedAt }
            : { deniedAt: decidedAt }),
        },
      });
      if (updated.count !== 1) {
        throw new DomainError('REQUEST_ALREADY_DECIDED');
      }

      await tx.decision.create({
        data: {
          requestId: request.id,
          approverUserId: membership.user.id,
          credentialId: assertion.credential.id,
          decision: input.decision,
          payloadHash: request.payloadHash,
          // Enough to show which credential signed and when, without storing
          // the assertion blob itself.
          webauthnAssertionMetadata: {
            credentialLabel: assertion.credential.label,
            challengeId: challenge.id,
            verifiedAt: decidedAt.toISOString(),
          } as Prisma.InputJsonValue,
          reason: input.reason ?? null,
        },
      });

      // A receipt is produced for a denial as well as an approval: "Jane
      // refused this" is evidence worth being able to prove (PRD 31).
      await createReceipt(
        tx,
        {
          receiptId,
          requestId: request.id,
          organizationId: request.organizationId,
          requesterUserId: request.requesterUserId,
          approverUserId: membership.user.id,
          decision: input.decision === 'APPROVE' ? 'APPROVED' : 'DENIED',
          actionType: request.actionType,
          payloadHash: request.payloadHash,
          credentialId: assertion.credential.id,
          decidedAt,
        },
        signingConfig,
      );

      await recordAuditEvent(
        {
          organizationId: request.organizationId,
          actorUserId: membership.user.id,
          eventType: input.decision === 'APPROVE' ? 'REQUEST_APPROVED' : 'REQUEST_DENIED',
          targetType: 'VerificationRequest',
          targetId: request.id,
          metadata: {
            payloadHash: request.payloadHash,
            receiptId,
            credentialLabel: assertion.credential.label,
          },
          previousState: 'PENDING',
          newState: nextStatus,
          ctx,
        },
        tx,
      );

      return {
        requestId: request.id,
        status: nextStatus,
        receiptId,
        decidedAt,
        approver: { id: membership.user.id, displayName: membership.user.displayName },
      };
    });
  } catch (error) {
    // Every refused attempt is recorded, whether it was a mistyped device, an
    // expired challenge, or somebody trying to approve on another person's
    // behalf. The request itself is untouched.
    await recordAuditEvent({
      organizationId: membership.organizationId,
      actorUserId: membership.user.id,
      eventType: 'FAILED_APPROVAL_ATTEMPT',
      targetType: 'VerificationRequest',
      targetId: requestId,
      metadata: {
        decision: input.decision,
        reason: error instanceof DomainError ? error.code : 'UNEXPECTED',
      },
      ctx,
    }).catch(() => undefined);

    throw error;
  }
}

/**
 * Loads a request this member may actually decide, checking every condition
 * PRD FR-011 lists.
 */
async function loadDecidableRequest(
  membership: MembershipContext,
  requestId: string,
  ctx: RequestContext,
) {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      requesterUserId: true,
      assignedApproverUserId: true,
      actionType: true,
      status: true,
      payloadHash: true,
      expiresAt: true,
    },
  });

  if (!request || request.organizationId !== membership.organizationId) {
    throw new DomainError('REQUEST_NOT_FOUND');
  }

  if (request.assignedApproverUserId !== membership.user.id) {
    await recordAuditEvent({
      organizationId: membership.organizationId,
      actorUserId: membership.user.id,
      eventType: 'AUTHORIZATION_FAILURE',
      targetType: 'VerificationRequest',
      targetId: request.id,
      metadata: { reason: 'not_the_assigned_approver' },
      ctx,
    });
    throw new DomainError('APPROVER_MISMATCH');
  }

  const status = effectiveStatus(request.status, request.expiresAt);
  if (status !== 'PENDING') {
    assertTransition(status, 'APPROVED');
  }

  const passkeyCount = await prisma.passkeyCredential.count({
    where: { userId: membership.user.id, revokedAt: null },
  });
  if (passkeyCount === 0) {
    throw new DomainError('PASSKEY_REQUIRED');
  }

  return request;
}

/**
 * Spends a decision challenge.
 *
 * Committed on its own, before the signature is checked, so that a rejected
 * attempt still burns the challenge (PRD 18.5). It is matched on the request,
 * the user *and* the decision, so a challenge issued for a denial cannot be
 * answered with an approval.
 */
async function consumeDecisionChallenge(
  membership: MembershipContext,
  requestId: string,
  decision: DecisionType,
  clientChallenge: string,
) {
  const challengeHash = hashChallengeString(clientChallenge);

  const challenge = await prisma.approvalChallenge.findUnique({
    where: { challengeHash },
    select: {
      id: true,
      requestId: true,
      userId: true,
      decision: true,
      payloadHash: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (
    !challenge ||
    challenge.requestId !== requestId ||
    challenge.userId !== membership.user.id ||
    challenge.decision !== decision
  ) {
    throw new DomainError('CHALLENGE_NOT_FOUND');
  }
  if (challenge.usedAt) {
    throw new DomainError('CHALLENGE_ALREADY_USED');
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new DomainError('CHALLENGE_EXPIRED');
  }

  const claimed = await prisma.approvalChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new DomainError('CHALLENGE_ALREADY_USED');
  }

  return challenge;
}

/** Extracts the challenge from client data so it can be looked up. */
function readChallengeFromResponse(response: AuthenticationResponseInput): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
    );
  } catch {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: 'decision client data was not valid base64url JSON',
    });
  }

  const challenge = (parsed as { challenge?: unknown }).challenge;
  if (typeof challenge !== 'string') {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: 'decision client data carried no challenge',
    });
  }
  return challenge;
}
