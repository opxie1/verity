/**
 * Stands in for the `server-only` package under Vitest.
 *
 * `server-only` deliberately throws when it is resolved outside a server
 * context, which is exactly what makes it useful in the app and useless in a
 * plain Node test runner.
 */
export {};
