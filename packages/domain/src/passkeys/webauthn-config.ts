/**
 * Relying-party settings for WebAuthn.
 *
 * Passed in by the caller rather than read from `process.env` here, so the
 * domain layer stays free of environment coupling and tests can exercise
 * origin and RP-ID mismatches directly.
 */
export interface WebAuthnConfig {
  /** Registrable domain, with no scheme and no port. `localhost` in development. */
  rpId: string;
  rpName: string;
  /** Every origin permitted to produce an assertion for this relying party. */
  expectedOrigins: readonly string[];
}

/** How long a registration ceremony may take before its challenge is stale. */
export const REGISTRATION_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Authentication challenges live briefly. A decision is a deliberate act taken
 * in front of the screen, so a short window costs the user nothing and gives
 * an attacker who captured a challenge almost no time to use it (PRD 18.5).
 */
export const AUTHENTICATION_CHALLENGE_TTL_MS = 2 * 60 * 1000;
