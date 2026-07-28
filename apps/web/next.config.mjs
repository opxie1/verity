import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// One `.env` at the repository root serves every workspace package, so the
// database URL and signing keys are not duplicated across apps. In a real
// deployment the platform supplies these and the file is absent.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source and are compiled by Next.
  transpilePackages: ['@verity/ui', '@verity/domain', '@verity/database', '@verity/schemas'],

  // Prisma must not be bundled into the server output.
  serverExternalPackages: ['@prisma/client', '.prisma/client'],

  // File tracing decides which files ship alongside each serverless function.
  // In a pnpm monorepo it defaults to this app's directory, which excludes
  // everything under `packages/` — including the Prisma query engine.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  outputFileTracingIncludes: {
    // The engine is a native binary, not an import, so tracing cannot infer it
    // from the code. Naming it explicitly is what stops the build succeeding
    // and then failing on the first query.
    '/**': ['../../packages/database/generated/client/**/*'],
  },

  poweredByHeader: false,

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    /**
     * Content Security Policy.
     *
     * `frame-ancestors 'none'` matters most here: the approval page must never
     * be loadable inside somebody else's frame, or an attacker could overlay
     * their own text above a real approve button (PRD NFR-001).
     *
     * `'unsafe-eval'` is present in development only, because the dev-mode
     * React refresh runtime needs it. Production gets neither that nor any
     * remote script origin.
     */
    const csp = [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts, so 'unsafe-inline' cannot be
      // dropped without switching to nonce-based CSP, which Next does not yet
      // support for the App Router without a custom server.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      ...(isDev ? [] : ['upgrade-insecure-requests']),
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            // `publickey-credentials-get` must stay enabled for this origin:
            // it is what allows WebAuthn assertions on the approval page.
            value: 'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Nothing under the API is cacheable: every response depends on who is
        // asking, and a cached approval status would be actively dangerous.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
