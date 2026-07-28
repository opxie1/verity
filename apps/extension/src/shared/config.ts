/**
 * Where the extension talks to Verity.
 *
 * Baked in at build time rather than configurable at runtime: an extension
 * that could be pointed at an arbitrary origin would be a way to exfiltrate a
 * session, and the API host is not something a user should be choosing.
 */
export const API_BASE_URL = (import.meta.env.VITE_VERITY_API_URL as string | undefined)
  ?? 'http://localhost:3000';

export const GMAIL_ORIGIN = 'https://mail.google.com';
