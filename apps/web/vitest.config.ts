import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    alias: {
      // `server-only` exists to fail loudly when imported into a client bundle.
      // Under Node it would fail here too, so it is stubbed for tests.
      'server-only': new URL('./src/test/server-only-stub.ts', import.meta.url).pathname,
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://verity:verity@127.0.0.1:5433/verity_test?schema=public',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
      RP_ID: 'localhost',
      RP_NAME: 'Verity',
      EXPECTED_ORIGIN: 'http://localhost:3000',
      EMAIL_FROM: 'Verity <no-reply@example.test>',
    },
  },
});
