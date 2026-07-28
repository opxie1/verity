/**
 * Derives the integration test database URL from the development one.
 *
 * Shared by the Vitest config (which sets it for the test workers) and by the
 * global setup (which runs in the main process, where `test.env` does not
 * apply). Deriving it in one place is what stops those two from disagreeing
 * and pointing the reset at the development database.
 */
export function toTestDatabaseUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  const database = url.pathname.replace(/^\//, '');
  url.pathname = `/${database.endsWith('_test') ? database : `${database}_test`}`;
  return url.toString();
}
