import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { prisma, type DbClient, type PasskeyCredential } from '@verity/database';
import type {
  AuthenticationResponseInput,
  VerifyPasskeyRegistrationInput,
} from '@verity/schemas';
import { recordAuditEvent } from '../audit/audit-service';
import type { RequestContext, SessionUser } from '../context';
import { DomainError } from '../errors';
import { consumeChallenge, decodeClientData } from './challenge-store';
import {
  AUTHENTICATION_CHALLENGE_TTL_MS,
  REGISTRATION_CHALLENGE_TTL_MS,
  type WebAuthnConfig,
} from './webauthn-config';

/**
 * Passkey registration and authentication (PRD 14.2, FR-005).
 *
 * All cryptography is delegated to `@simplewebauthn/server`. Nothing here
 * parses attestation, verifies signatures, or implements COSE decoding by
 * hand — PRD section 25 forbids exactly that, and it is where hand-rolled
 * WebAuthn implementations go wrong.
 *
 * Private key material never reaches this server. Neither does biometric data:
 * the fingerprint or face is matched by the authenticator itself, which only
 * reports that user verification succeeded.
 */

export async function startPasskeyRegistration(
  user: SessionUser,
  config: WebAuthnConfig,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await prisma.passkeyCredential.findMany({
    where: { userId: user.id, revokedAt: null },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    // Verity stores no attestation statement: it does not need to know the
    // authenticator's make and model, and collecting it would be data it has
    // no use for (PRD NFR-002).
    attestationType: 'none',
    // Stops the same authenticator being enrolled twice, which would look like
    // a backup passkey without being one.
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      // The whole product rests on the approver being present and verified,
      // so user verification is required rather than preferred.
      userVerification: 'required',
    },
    timeout: REGISTRATION_CHALLENGE_TTL_MS,
  });

  await prisma.webAuthnChallenge.create({
    data: {
      userId: user.id,
      type: 'REGISTRATION',
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + REGISTRATION_CHALLENGE_TTL_MS),
    },
  });

  return options;
}

type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export async function completePasskeyRegistration(
  user: SessionUser,
  input: VerifyPasskeyRegistrationInput,
  config: WebAuthnConfig,
  ctx: RequestContext,
): Promise<{ credentialId: string; label: string }> {
  const clientData = decodeClientData(input.response.response.clientDataJSON);

  // Spend the challenge before anything else, and outside the transaction
  // below, so that a failed ceremony cannot be retried against it.
  await consumeChallenge(user.id, 'REGISTRATION', clientData.challenge);

  return prisma.$transaction(async (tx) => {
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: clientData.challenge,
        expectedOrigin: [...config.expectedOrigins],
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
        internalDetail: error instanceof Error ? error.message : 'registration verification threw',
        cause: error,
      });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new DomainError('PASSKEY_VERIFICATION_FAILED');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const alreadyRegistered = await tx.passkeyCredential.findUnique({
      where: { credentialId: credential.id },
      select: { id: true },
    });
    if (alreadyRegistered) {
      throw new DomainError('CONFLICT', {
        message: 'That passkey is already registered.',
      });
    }

    const created = await tx.passkeyCredential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        label: input.label,
      },
      select: { id: true, label: true },
    });

    await recordAuditEvent(
      {
        organizationId: null,
        actorUserId: user.id,
        eventType: 'PASSKEY_ADDED',
        targetType: 'PasskeyCredential',
        targetId: created.id,
        // The label is the user's own words; the credential ID and public key
        // are not recorded here because the credential row already holds them.
        metadata: { label: created.label, deviceType: credentialDeviceType },
        ctx,
      },
      tx,
    );

    return { credentialId: created.id, label: created.label };
  });
}

export async function listPasskeys(userId: string) {
  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      deviceType: true,
      backedUp: true,
      transports: true,
    },
  });

  return credentials.map((credential) => ({
    credentialId: credential.id,
    label: credential.label,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    transports: credential.transports,
  }));
}

export async function countActivePasskeys(userId: string): Promise<number> {
  return prisma.passkeyCredential.count({ where: { userId, revokedAt: null } });
}

/**
 * Revokes a passkey.
 *
 * Refuses to remove the last one. Doing so would leave the account unable to
 * approve anything with no way back in without administrator help, which
 * PRD 14.2 calls out as needing a recovery flow that the MVP does not have.
 * The row is marked revoked rather than deleted, so decisions that reference
 * it keep pointing at a real credential.
 */
export async function revokePasskey(
  user: SessionUser,
  credentialId: string,
  ctx: RequestContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const credential = await tx.passkeyCredential.findUnique({
      where: { id: credentialId },
      select: { id: true, userId: true, label: true, revokedAt: true },
    });

    // A passkey belonging to someone else is reported as missing, not as
    // forbidden, so credential IDs cannot be probed.
    if (!credential || credential.userId !== user.id) {
      throw new DomainError('PASSKEY_NOT_FOUND');
    }
    if (credential.revokedAt) {
      return;
    }

    const remaining = await tx.passkeyCredential.count({
      where: { userId: user.id, revokedAt: null, id: { not: credential.id } },
    });
    if (remaining === 0) {
      throw new DomainError('CONFLICT', {
        message:
          'This is your only passkey. Register another one first, so that removing this one cannot lock you out.',
      });
    }

    await tx.passkeyCredential.update({
      where: { id: credential.id },
      data: { revokedAt: new Date() },
    });

    await recordAuditEvent(
      {
        organizationId: null,
        actorUserId: user.id,
        eventType: 'PASSKEY_REMOVED',
        targetType: 'PasskeyCredential',
        targetId: credential.id,
        metadata: { label: credential.label },
        ctx,
      },
      tx,
    );
  });
}

/**
 * Issues an authentication challenge for re-confirming presence.
 *
 * `challengeBytes` lets a caller bind extra meaning into the challenge: the
 * decision flow passes the digest of a payload naming the request, its payload
 * hash and the decision, so the authenticator signs over exactly that
 * (PRD FR-010).
 *
 * Bytes, not a string. A WebAuthn challenge is a byte sequence and the library
 * base64url-encodes whatever it is handed, so passing an already-encoded string
 * would encode it twice and `options.challenge` would no longer be the value
 * the caller bound.
 */
export async function buildAuthenticationOptions(
  user: SessionUser,
  config: WebAuthnConfig,
  challengeBytes?: Uint8Array<ArrayBuffer>,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId: user.id, revokedAt: null },
    select: { credentialId: true, transports: true },
  });

  if (credentials.length === 0) {
    throw new DomainError('PASSKEY_REQUIRED');
  }

  return generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'required',
    timeout: AUTHENTICATION_CHALLENGE_TTL_MS,
    ...(challengeBytes ? { challenge: challengeBytes } : {}),
  });
}

/**
 * Generic presence check, recorded in the shared challenge table.
 *
 * The decision flow does not use this. It keeps its own challenge records,
 * because a decision challenge additionally has to remember which request,
 * which payload hash and which decision it was issued for (PRD 20.7).
 */
export async function startPasskeyAuthentication(
  user: SessionUser,
  config: WebAuthnConfig,
  challengeBytes?: Uint8Array<ArrayBuffer>,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await buildAuthenticationOptions(user, config, challengeBytes);

  await prisma.webAuthnChallenge.create({
    data: {
      userId: user.id,
      type: 'AUTHENTICATION',
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + AUTHENTICATION_CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export interface VerifiedAssertion {
  credential: Pick<PasskeyCredential, 'id' | 'label' | 'credentialId'>;
  /** The challenge the authenticator actually signed over. */
  challenge: string;
}

/**
 * Verifies an assertion against the user's registered credentials.
 *
 * `db` may be a transaction client so that a caller can make the assertion and
 * whatever it authorizes commit together, or not at all.
 */
export async function verifyPasskeyAssertion(
  user: SessionUser,
  response: AuthenticationResponseInput,
  config: WebAuthnConfig,
  db: DbClient = prisma,
): Promise<VerifiedAssertion> {
  const clientData = decodeClientData(response.response.clientDataJSON);
  await consumeChallenge(user.id, 'AUTHENTICATION', clientData.challenge);
  return verifyAssertionSignature(user, response, config, db);
}

/**
 * Verifies the signature, the origin, the RP ID and the counter, and records
 * that the credential was used.
 *
 * Does *not* consume a challenge: the caller is responsible for having already
 * established that the challenge in the client data was issued to this user,
 * for this purpose, and has not been spent. Splitting it this way is what lets
 * the decision flow enforce single use against its own challenge table while
 * reusing exactly the same verification.
 */
export async function verifyAssertionSignature(
  user: SessionUser,
  response: AuthenticationResponseInput,
  config: WebAuthnConfig,
  db: DbClient = prisma,
): Promise<VerifiedAssertion> {
  const clientData = decodeClientData(response.response.clientDataJSON);

  const credential = await db.passkeyCredential.findUnique({
    where: { credentialId: response.id },
    select: {
      id: true,
      userId: true,
      label: true,
      credentialId: true,
      publicKey: true,
      counter: true,
      transports: true,
      revokedAt: true,
    },
  });

  if (!credential || credential.userId !== user.id || credential.revokedAt) {
    throw new DomainError('PASSKEY_NOT_FOUND');
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: clientData.challenge,
      expectedOrigin: [...config.expectedOrigins],
      expectedRPID: config.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
  } catch (error) {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      internalDetail: error instanceof Error ? error.message : 'assertion verification threw',
      cause: error,
    });
  }

  if (!verification.verified) {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED');
  }

  // A counter that fails to advance can indicate a cloned authenticator. Many
  // platform authenticators report 0 permanently, so this only rejects the
  // case where a counter that was previously non-zero has gone backwards.
  const newCounter = verification.authenticationInfo.newCounter;
  const storedCounter = Number(credential.counter);
  if (storedCounter > 0 && newCounter <= storedCounter) {
    throw new DomainError('PASSKEY_VERIFICATION_FAILED', {
      message: 'This passkey could not be verified. Contact your administrator.',
      internalDetail: `counter did not advance: stored ${storedCounter}, presented ${newCounter}`,
    });
  }

  await db.passkeyCredential.update({
    where: { id: credential.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
  });

  return {
    credential: { id: credential.id, label: credential.label, credentialId: credential.credentialId },
    challenge: clientData.challenge,
  };
}

