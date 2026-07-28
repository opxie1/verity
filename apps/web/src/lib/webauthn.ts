import 'server-only';
import type { WebAuthnConfig } from '@verity/domain';
import { expectedOrigins, serverEnv } from './env';

/**
 * Relying-party settings, built once from validated environment variables.
 *
 * `rpId` and the origin list are the two values that decide which sites may
 * produce an assertion Verity will accept, so they come from the server
 * environment and never from a request.
 */
export const webAuthnConfig: WebAuthnConfig = {
  rpId: serverEnv.RP_ID,
  rpName: serverEnv.RP_NAME,
  expectedOrigins,
};
