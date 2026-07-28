import { PrismaClient } from '@prisma/client';

/**
 * Next.js dev-mode hot reload re-evaluates modules, which would otherwise open
 * a new connection pool on every edit until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { verityPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.verityPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

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

export * from '@prisma/client';
