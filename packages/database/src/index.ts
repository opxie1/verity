import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/client';

/**
 * Next.js dev-mode hot reload re-evaluates modules, which would otherwise open
 * a new connection pool on every edit until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { verityPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }

  // Queries go through the `pg` driver rather than Prisma's native engine
  // binary. The binary is platform-specific and has to be copied next to the
  // bundle by whatever builds the application; a JavaScript driver is just an
  // import, so it cannot be left behind.
  const pool = new Pool({
    connectionString,
    // Serverless functions are short-lived and numerous. A small ceiling per
    // instance keeps a burst of them from exhausting the database's own limit.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.verityPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.verityPrisma = prisma;
}

/**
 * The client shape available inside `prisma.$transaction(async (tx) => ...)`.
 * Domain services accept this so callers can compose several state changes
 * into one atomic transaction (PRD section 15, NFR-003).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type DbClient = PrismaClient | PrismaTransactionClient;

export * from '../generated/client';
