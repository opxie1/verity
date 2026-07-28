import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { prisma } from '@verity/database';

/**
 * A software WebAuthn authenticator for tests.
 *
 * Produces genuine ES256 assertions, so the approval path is verified by the
 * same signature checking that runs in production rather than by a stub. That
 * matters here more than in most systems: "the approver's device signed this"
 * is the entire claim Verity makes, and a mocked signature would let a broken
 * verification pass its own tests.
 */
export class VirtualAuthenticator {
  readonly credentialId: string;
  private readonly privateKeyPem: string;
  private readonly publicKeyCose: Buffer;
  private counter = 0;

  constructor(readonly rpId = 'localhost', readonly origin = 'http://localhost:3000') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.publicKeyCose = encodeCoseEc2PublicKey(
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from(jwk.y, 'base64url'),
    );

    this.credentialId = randomBytes(32).toString('base64url');
  }

  /** Registers this authenticator's credential for a user. */
  async register(userId: string, label = 'Virtual key') {
    return prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: this.credentialId,
        publicKey: this.publicKeyCose,
        counter: BigInt(0),
        transports: ['internal'],
        label,
        backedUp: false,
        deviceType: 'singleDevice',
      },
      select: { id: true, credentialId: true, label: true },
    });
  }

  /** Produces an assertion over a challenge, in the shape the browser sends. */
  assert(challenge: string, options: { origin?: string; userVerified?: boolean } = {}) {
    const clientData = {
      type: 'webauthn.get',
      challenge,
      origin: options.origin ?? this.origin,
      crossOrigin: false,
    };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData), 'utf8');

    this.counter += 1;

    const rpIdHash = createHash('sha256').update(this.rpId, 'utf8').digest();
    const flags = Buffer.from([
      // User present, plus user verified unless the test asks otherwise.
      options.userVerified === false ? 0x01 : 0x05,
    ]);
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([rpIdHash, flags, counterBytes]);

    const signed = Buffer.concat([
      authenticatorData,
      createHash('sha256').update(clientDataJSON).digest(),
    ]);
    const signature = createSign('SHA256').update(signed).sign(this.privateKeyPem);

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
    };
  }
}

/**
 * Encodes a P-256 public key as a COSE_Key, which is the format WebAuthn
 * credential public keys are stored in.
 *
 * Written out byte by byte rather than pulled from a CBOR library, because it
 * is one fixed five-entry map and the explicit form documents the structure:
 *   1 (kty) = 2 (EC2), 3 (alg) = -7 (ES256), -1 (crv) = 1 (P-256),
 *   -2 (x) and -3 (y) = 32-byte coordinates.
 */
function encodeCoseEc2PublicKey(x: Buffer, y: Buffer): Buffer {
  if (x.length !== 32 || y.length !== 32) {
    throw new Error('P-256 coordinates must be 32 bytes');
  }
  return Buffer.concat([
    Buffer.from([0xa5]), // map of 5 pairs
    Buffer.from([0x01, 0x02]), // 1: 2
    Buffer.from([0x03, 0x26]), // 3: -7
    Buffer.from([0x20, 0x01]), // -1: 1
    Buffer.from([0x21, 0x58, 0x20]), // -2: byte string of length 32
    x,
    Buffer.from([0x22, 0x58, 0x20]), // -3: byte string of length 32
    y,
  ]);
}
