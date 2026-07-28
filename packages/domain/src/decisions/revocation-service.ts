import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { prisma, type Prisma } from '@verity/database';
import type { AuthenticationResponseInput } from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import type { MembershipContext, RequestContext } from '../context';
import { generateNonce, generatePrefixedId } from '../crypto/tokens';
import { DomainError } from '../errors';
import { buildAuthenticationOptions, verifyAssertionSignature } from '../passkeys/passkey-service';
import type { WebAuthnConfig } from '../passkeys/webauthn-config';
import { assertTransition, effectiveStatus } from '../requests/state-machine';
import {
  buildDecisionChallengePayload,
  decisionChallengeBytes,
  hashChallengeString,
} from './challenge';

const REVOCATION_CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Revoking an approval (PRD 14.6, FR-018).
 *
 * Revocation withdraws an approval going forward; it does not erase it. The
 * original decision and its receipt stay exactly as they were, and a new
 * revocation record is added alongside. Anyone looking later can see both that
 * it was approved and that the approval was later withdrawn — which is the
 * honest account, and the one an auditor needs.
 *
 * It requires a passkey for the same reason approving does. If a stolen
 * session could revoke, an attacker could quietly cancel a legitimate approval
 * and stall a payment.
 */
export async function startRevocation(
  membership: MembershipContext,
  requestId: string,
  webAuthnConfig: WebAuthnConfig,
  ctx: RequestContext,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }> {
  const request = await loadRevocableRequest(membership, requestId, ctx);

  const challengeId = generatePrefixedId('chl');
  const expiresAt = new Date(Date.now() + REVOCATION_CHALLENGE_TTL_MS);

  const challengePayload = buildDecisionChallengePayload({
    requestId: request.id,
    payloadHash: request.payloadHash,
    decision: 'REVOKE',
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
      decision: 'REVOKE',
      challengeHash: hashChallengeString(options.challenge),
      payloadHash: request.payloadHash,
      expiresAt,
    },
  });

  return { options, challengeId };
}

export async function completeRevocation(
  membership: MembershipContext,
  requestId: string,
  input: { response: AuthenticationResponseInput; reason: string },
  webAuthnConfig: WebAuthnConfig,
  ctx: RequestContext,
): Promise<{ requestId: string; status: 'REVOKED'; revokedAt: Date }> {
  const request = await loadRevocableRequest(membership, requestId, ctx);

  const clientChallenge = readChallenge(input.response);
  const challengeHash = hashChallengeString(clientChallenge);

  const challenge = await prisma.approvalChallenge.findUnique({
    where: { challengeHash },
    select: {
      id: true,
      requestId: true,
      userId: true,
      decision: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (
    !challenge ||
    challenge.requestId !== requestId ||
    challenge.userId !== membership.user.id ||
    challenge.decision !== 'REVOKE'
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

  const assertion = await verifyAssertionSignature(membership.user, input.response, webAuthnConfig);
  const revokedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const current = await tx.verificationRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, expiresAt: true },
    });
    assertTransition(effectiveStatus(current.status, current.expiresAt), 'REVOKED');

    const updated = await tx.verificationRequest.updateMany({
      where: { id: request.id, status: 'APPROVED' },
      data: { status: 'REVOKED', revokedAt },
    });
    if (updated.count !== 1) {
      throw new DomainError('REQUEST_NOT_PENDING', {
        message: 'This request is no longer in a state that can be revoked.',
      });
    }

    // The original Decision row is untouched. This is a new record beside it.
    await tx.decision.create({
      data: {
        requestId: request.id,
        approverUserId: membership.user.id,
        credentialId: assertion.credential.id,
        decision: 'REVOKE',
        payloadHash: request.payloadHash,
        webauthnAssertionMetadata: {
          credentialLabel: assertion.credential.label,
          challengeId: challenge.id,
          verifiedAt: revokedAt.toISOString(),
        } as Prisma.InputJsonValue,
        reason: input.reason,
      },
    });

    await tx.revocation.create({
      data: {
        requestId: request.id,
        revokedByUserId: membership.user.id,
        reason: input.reason,
        credentialId: assertion.credential.id,
      },
    });

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: membership.user.id,
        eventType: 'APPROVAL_REVOKED',
        targetType: 'VerificationRequest',
        targetId: request.id,
        metadata: { reason: input.reason, credentialLabel: assertion.credential.label },
        previousState: 'APPROVED',
        newState: 'REVOKED',
        ctx,
      },
      tx,
    );

    return { requestId: request.id, status: 'REVOKED' as const, revokedAt };
  });
}

/**
 * Loads a request this member may revoke.
 *
 * The original approver may withdraw their own approval. An administrator may
 * too, because otherwise an approval could not be withdrawn once that person
 * left the company — but it is recorded under their own name and needs their
 * own passkey, so it is never anonymous and never on someone else's behalf
 * (PRD 12.1, 14.6).
 */
async function loadRevocableRequest(
  membership: MembershipContext,
  requestId: string,
  ctx: RequestContext,
) {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      assignedApproverUserId: true,
      status: true,
      payloadHash: true,
      expiresAt: true,
    },
  });

  if (!request || request.organizationId !== membership.organizationId) {
    throw new DomainError('REQUEST_NOT_FOUND');
  }

  const isOriginalApprover = request.assignedApproverUserId === membership.user.id;
  const isAdministrator = membership.role === 'ORG_ADMIN';

  if (!isOriginalApprover && !isAdministrator) {
    await recordAuditEvent({
      organizationId: membership.organizationId,
      actorUserId: membership.user.id,
      eventType: 'AUTHORIZATION_FAILURE',
      targetType: 'VerificationRequest',
      targetId: request.id,
      metadata: { reason: 'not_permitted_to_revoke' },
      ctx,
    });
    throw new DomainError('UNAUTHORIZED', {
      message: 'Only the approver who granted this, or an administrator, can revoke it.',
    });
  }

  const status = effectiveStatus(request.status, request.expiresAt);
  if (status !== 'APPROVED') {
    assertTransition(status, 'REVOKED');
  }

  const passkeyCount = await prisma.passkeyCredential.count({
    where: { userId: membership.user.id, revokedAt: null },
  });
  if (passkeyCount === 0) {
    throw new DomainError('PASSKEY_REQUIRED');
  }

  return request;
}

function readChallenge(response: AuthenticationResponseInput): string {
  try {
    const parsed = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: unknown };
    if (typeof parsed.challenge !== 'string') {
      throw new Error('missing challenge');
    }
    return parsed.challenge;
  } catch {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: 'revocation client data was not valid',
    });
  }
}
