import { z } from 'zod';
import { credentialIdSchema, requiredText } from './common';

export const passkeyLabelSchema = requiredText(60, 'Give this passkey a name');

/**
 * The browser's WebAuthn response is passed through to the verification
 * library, which does the real structural and cryptographic checking. These
 * schemas reject obviously malformed bodies early so a garbage payload never
 * reaches it, but they are not the security boundary.
 */
const base64UrlString = z.string().min(1).max(6000);

export const registrationResponseSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  response: z.object({
    clientDataJSON: base64UrlString,
    attestationObject: base64UrlString,
    transports: z.array(z.string().max(20)).max(10).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: base64UrlString.optional(),
    authenticatorData: base64UrlString.optional(),
  }),
});
export type RegistrationResponseInput = z.infer<typeof registrationResponseSchema>;

export const authenticationResponseSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  response: z.object({
    clientDataJSON: base64UrlString,
    authenticatorData: base64UrlString,
    signature: base64UrlString,
    userHandle: base64UrlString.optional(),
  }),
});
export type AuthenticationResponseInput = z.infer<typeof authenticationResponseSchema>;

export const verifyPasskeyRegistrationSchema = z.object({
  label: passkeyLabelSchema,
  response: registrationResponseSchema,
});
export type VerifyPasskeyRegistrationInput = z.infer<typeof verifyPasskeyRegistrationSchema>;

export const credentialIdParamSchema = z.object({ credentialId: credentialIdSchema });

export const passkeySummarySchema = z.object({
  credentialId: credentialIdSchema,
  label: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  deviceType: z.string().nullable(),
  backedUp: z.boolean(),
  transports: z.array(z.string()),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;
