import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { toTestDatabaseUrl } from './tests/integration/setup/test-database-url';

loadEnv({ path: '.env' });

/**
 * Integration tests run against a real PostgreSQL database, not a mock.
 *
 * Half of what this system promises — organization isolation, single-use
 * invitations, append-only audit records — is enforced by database constraints
 * and triggers. A mocked client would report those as passing while proving
 * nothing.
 */
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) {
  throw new Error('DATABASE_URL must be set (see .env.example) to run integration tests.');
}

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup/global-setup.ts'],
    env: {
      DATABASE_URL: toTestDatabaseUrl(sourceUrl),
      NODE_ENV: 'test',
    },
    // Each file creates its own fixtures against one shared database, and the
    // global setup rebuilds that database once per run.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
