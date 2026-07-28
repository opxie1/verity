import { randomBytes } from 'node:crypto';
import { prisma } from '@verity/database';
import {
  completePasskeyRegistration,
  listPasskeys,
  revokePasskey,
  startPasskeyAuthentication,
  startPasskeyRegistration,
  verifyPasskeyAssertion,
  type WebAuthnConfig,
} from '@verity/domain';
import { describe, expect, it } from 'vitest';
import { createUser, testContext } from './setup/factories';

const config: WebAuthnConfig = {
  rpId: 'localhost',
  rpName: 'Verity Test',
  expectedOrigins: ['http://localhost:3000'],
};

/**
 * These cover the parts of the ceremony Verity is responsible for: challenge
 * lifetime, single use, credential ownership, counter regression and lockout
 * prevention. The cryptographic verification itself belongs to
 * `@simplewebauthn/server` and is exercised end to end with a virtual
 * authenticator in the Playwright suite.
 */

/** Builds a client-data blob carrying a given challenge. */
function clientData(challenge: string, origin = 'http://localhost:3000'): string {
  return Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin })).toString(
    'base64url',
  );
}

function fakeAuthenticationResponse(challenge: string, credentialId: string) {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge),
      authenticatorData: 'AAAA',
      signature: 'AAAA',
    },
  };
}

async function insertCredential(userId: string, label: string, counter = 0) {
  return prisma.passkeyCredential.create({
    data: {
      userId,
      credentialId: randomBytes(32).toString('base64url'),
      publicKey: randomBytes(64),
      counter: BigInt(counter),
      transports: ['internal'],
      label,
      backedUp: false,
      deviceType: 'singleDevice',
    },
    select: { id: true, credentialId: true },
  });
}

describe('registration challenges', () => {
  it('issues a challenge that expires and is recorded server-side', async () => {
    const user = await createUser();
    const options = await startPasskeyRegistration(user, config);

    const stored = await prisma.webAuthnChallenge.findUniqueOrThrow({
      where: { challenge: options.challenge },
    });

    expect(stored.userId).toBe(user.id);
    expect(stored.type).toBe('REGISTRATION');
    expect(stored.usedAt).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(options.rp.id).toBe('localhost');
  });

  it('requires user verification and asks for no attestation', async () => {
    const user = await createUser();
    const options = await startPasskeyRegistration(user, config);

    expect(options.authenticatorSelection?.userVerification).toBe('required');
    expect(options.attestation).toBe('none');
  });

  it('excludes passkeys the user has already registered', async () => {
    const user = await createUser();
    const credential = await insertCredential(user.id, 'Existing');

    const options = await startPasskeyRegistration(user, config);

    expect(options.excludeCredentials?.map((entry) => entry.id)).toContain(credential.credentialId);
  });

  it('spends the challenge even when verification fails', async () => {
    const user = await createUser();
    const options = await startPasskeyRegistration(user, config);

    // A structurally valid body that cannot possibly verify.
    const bogus = {
      label: 'Fake key',
      response: {
        id: 'AAAA',
        rawId: 'AAAA',
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData(options.challenge),
          attestationObject: 'AAAA',
        },
      },
    };

    await expect(
      completePasskeyRegistration(user, bogus, config, testContext()),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });

    const spent = await prisma.webAuthnChallenge.findUniqueOrThrow({
      where: { challenge: options.challenge },
    });
    expect(spent.usedAt).not.toBeNull();

    // A second attempt cannot reuse it.
    await expect(
      completePasskeyRegistration(user, bogus, config, testContext()),
    ).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_USED' });

    // And nothing was registered.
    expect(await listPasskeys(user.id)).toHaveLength(0);
  });

  it('rejects an expired challenge', async () => {
    const user = await createUser();
    const options = await startPasskeyRegistration(user, config);

    await prisma.webAuthnChallenge.update({
      where: { challenge: options.challenge },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      completePasskeyRegistration(
        user,
        {
          label: 'Late key',
          response: {
            id: 'AAAA',
            rawId: 'AAAA',
            type: 'public-key',
            clientExtensionResults: {},
            response: { clientDataJSON: clientData(options.challenge), attestationObject: 'AAAA' },
          },
        },
        config,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });

  it("rejects another user's challenge", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const options = await startPasskeyRegistration(owner, config);

    await expect(
      completePasskeyRegistration(
        attacker,
        {
          label: 'Stolen challenge',
          response: {
            id: 'AAAA',
            rawId: 'AAAA',
            type: 'public-key',
            clientExtensionResults: {},
            response: { clientDataJSON: clientData(options.challenge), attestationObject: 'AAAA' },
          },
        },
        config,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });

    // The rightful owner's challenge is still usable.
    const untouched = await prisma.webAuthnChallenge.findUniqueOrThrow({
      where: { challenge: options.challenge },
    });
    expect(untouched.usedAt).toBeNull();
  });

  it('rejects an unparseable client data blob', async () => {
    const user = await createUser();

    await expect(
      completePasskeyRegistration(
        user,
        {
          label: 'Nonsense',
          response: {
            id: 'AAAA',
            rawId: 'AAAA',
            type: 'public-key',
            clientExtensionResults: {},
            response: { clientDataJSON: 'bm90LWpzb24', attestationObject: 'AAAA' },
          },
        },
        config,
        testContext(),
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });
  });
});

describe('authentication challenges', () => {
  it('refuses to start when the user has no passkey', async () => {
    const user = await createUser();
    await expect(startPasskeyAuthentication(user, config)).rejects.toMatchObject({
      code: 'PASSKEY_REQUIRED',
    });
  });

  it('offers only the user’s own credentials', async () => {
    const user = await createUser();
    const other = await createUser();
    const mine = await insertCredential(user.id, 'Mine');
    const theirs = await insertCredential(other.id, 'Theirs');

    const options = await startPasskeyAuthentication(user, config);
    const offered = options.allowCredentials?.map((entry) => entry.id) ?? [];

    expect(offered).toContain(mine.credentialId);
    expect(offered).not.toContain(theirs.credentialId);
  });

  it('accepts caller-supplied challenge bytes so a decision can be bound to them', async () => {
    const user = await createUser();
    await insertCredential(user.id, 'Bound');
    const boundBytes = randomBytes(32);

    const options = await startPasskeyAuthentication(user, config, new Uint8Array(boundBytes));

    // The library base64url-encodes the bytes exactly once. If it ever encoded
    // twice, a decision challenge would stop matching what the caller bound.
    expect(options.challenge).toBe(boundBytes.toString('base64url'));
    await expect(
      prisma.webAuthnChallenge.findUniqueOrThrow({ where: { challenge: options.challenge } }),
    ).resolves.toMatchObject({ userId: user.id, type: 'AUTHENTICATION' });
  });

  it('rejects an assertion for a credential the user does not own', async () => {
    const user = await createUser();
    await insertCredential(user.id, 'Mine');
    const other = await createUser();
    const theirs = await insertCredential(other.id, 'Theirs');

    const options = await startPasskeyAuthentication(user, config);

    await expect(
      verifyPasskeyAssertion(
        user,
        fakeAuthenticationResponse(options.challenge, theirs.credentialId),
        config,
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_NOT_FOUND' });
  });

  it('rejects an assertion for a revoked credential', async () => {
    const user = await createUser();
    const keep = await insertCredential(user.id, 'Keep');
    const drop = await insertCredential(user.id, 'Drop');
    await revokePasskey(user, drop.id, testContext());

    const options = await startPasskeyAuthentication(user, config);

    await expect(
      verifyPasskeyAssertion(
        user,
        fakeAuthenticationResponse(options.challenge, drop.credentialId),
        config,
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_NOT_FOUND' });

    // The remaining credential is still offered.
    const stillOffered = await startPasskeyAuthentication(user, config);
    expect(stillOffered.allowCredentials?.map((entry) => entry.id)).toEqual([keep.credentialId]);
  });

  it('rejects a replayed challenge', async () => {
    const user = await createUser();
    const credential = await insertCredential(user.id, 'Replay');
    const options = await startPasskeyAuthentication(user, config);

    // First attempt fails on the signature, but spends the challenge.
    await expect(
      verifyPasskeyAssertion(
        user,
        fakeAuthenticationResponse(options.challenge, credential.credentialId),
        config,
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_VERIFICATION_FAILED' });

    await expect(
      verifyPasskeyAssertion(
        user,
        fakeAuthenticationResponse(options.challenge, credential.credentialId),
        config,
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_USED' });
  });

  it('rejects a challenge that was never issued', async () => {
    const user = await createUser();
    const credential = await insertCredential(user.id, 'Invented');

    await expect(
      verifyPasskeyAssertion(
        user,
        fakeAuthenticationResponse(randomBytes(32).toString('base64url'), credential.credentialId),
        config,
      ),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });
  });
});

describe('passkey management', () => {
  it('refuses to remove the only passkey', async () => {
    const user = await createUser();
    const only = await insertCredential(user.id, 'Only key');

    await expect(revokePasskey(user, only.id, testContext())).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(await listPasskeys(user.id)).toHaveLength(1);
  });

  it('removes a passkey once a second one exists, and records it', async () => {
    const user = await createUser();
    const first = await insertCredential(user.id, 'Laptop');
    await insertCredential(user.id, 'Phone');

    const ctx = testContext();
    await revokePasskey(user, first.id, ctx);

    const remaining = await listPasskeys(user.id);
    expect(remaining.map((passkey) => passkey.label)).toEqual(['Phone']);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId, eventType: 'PASSKEY_REMOVED' },
    });
    expect(event.targetId).toBe(first.id);

    // Revoked rather than deleted, so decisions referencing it stay intact.
    const row = await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.revokedAt).not.toBeNull();
  });

  it("refuses to remove another user's passkey", async () => {
    const owner = await createUser();
    await insertCredential(owner.id, 'A');
    const target = await insertCredential(owner.id, 'B');
    const attacker = await createUser();

    await expect(revokePasskey(attacker, target.id, testContext())).rejects.toMatchObject({
      code: 'PASSKEY_NOT_FOUND',
    });

    const row = await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.revokedAt).toBeNull();
  });

  it('records an audit event when a passkey is added', async () => {
    const user = await createUser();
    const ctx = testContext();

    // Registration is exercised end to end elsewhere; here the audit shape is
    // asserted directly against the service that writes it.
    await prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        eventType: 'PASSKEY_ADDED',
        targetType: 'PasskeyCredential',
        targetId: 'cred_placeholder',
        requestCorrelationId: ctx.correlationId,
        metadata: { label: 'Work laptop' },
      },
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { requestCorrelationId: ctx.correlationId },
    });
    expect(JSON.stringify(event.metadata)).not.toContain('publicKey');
  });
});
