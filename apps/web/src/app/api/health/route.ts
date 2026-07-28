import { prisma } from '@verity/database';
import { NextResponse } from 'next/server';
import { isDemoEnabled } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/**
 * Reports whether the application can actually reach its database.
 *
 * Worth having because almost every page renders fine without a database: a
 * signed-out visitor triggers no query, so the site can look healthy while
 * being completely unable to store anything. This is the cheapest way to tell
 * those two states apart.
 *
 * The reason for a failure is included only in demo deployments, which hold no
 * real data. Elsewhere it reports up or down and nothing more.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, database: 'reachable' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[verity] health check failed', error);

    return NextResponse.json(
      {
        ok: false,
        database: 'unreachable',
        ...(isDemoEnabled ? { reason: reason.slice(0, 500) } : {}),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
