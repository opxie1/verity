import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { toTestDatabaseUrl } from './test-database-url';

/**
 * Prepares a dedicated test database, then applies the real migrations to it.
 *
 * `migrate deploy` rather than `db push`, so the tests exercise exactly the SQL
 * that will run in production — including the append-only triggers, which are
 * plain SQL in a migration and would be missed by a schema-only sync.
 */
export default async function globalSetup() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('DATABASE_URL is not set for the integration test run.');
  }

  // Global setup runs in Vitest's main process, where `test.env` has not been
  // applied yet, so the test URL is derived here rather than read from the
  // environment.
  const url = toTestDatabaseUrl(sourceUrl);
  const testUrl = new URL(url);
  const testDatabase = testUrl.pathname.replace(/^\//, '');
  if (!testDatabase.endsWith('_test')) {
    // A misconfigured URL must never point the reset at a real database.
    throw new Error(
      `Refusing to reset "${testDatabase}": the integration test database name must end in _test.`,
    );
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDatabase],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
    await admin.query(`CREATE DATABASE "${testDatabase}"`);
  } finally {
    await admin.end();
  }

  try {
    execFileSync(
      process.execPath,
      [
        'packages/database/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema',
        'packages/database/prisma/schema.prisma',
      ],
      {
        cwd: process.cwd(),
        // Prisma also reads the root `.env`, but dotenv does not overwrite
        // variables that are already set, so this value wins.
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(`Could not migrate the integration test database:\n${detail}`);
  }
}
