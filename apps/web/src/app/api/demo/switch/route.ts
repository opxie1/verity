import { prisma } from '@verity/database';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { endCurrentSession, isDemoEnabled, isDemoUser, startDemoSession } from '@/lib/demo';
import { getSessionUser } from '@/lib/session';

const bodySchema = z.object({ persona: z.enum(['requester', 'approver']) });

/**
 * Swaps the visitor between the two people in their own sandbox.
 *
 * Scoped to the organization the current demo user already belongs to, so this
 * can only ever move somebody between accounts they were already given. It is
 * not a way to become an arbitrary user.
 */
export async function POST(request: Request) {
  if (!isDemoEnabled) {
    return new NextResponse('Not found', { status: 404 });
  }

  const current = await getSessionUser();
  if (!current || !isDemoUser(current.email)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unknown persona' }, { status: 400 });
  }

  const membership = await prisma.organizationMember.findFirstOrThrow({
    where: { userId: current.id },
    select: { organizationId: true, organization: { select: { slug: true } } },
  });

  const target = await prisma.organizationMember.findFirstOrThrow({
    where: {
      organizationId: membership.organizationId,
      role: parsed.data.persona === 'requester' ? 'REQUESTER' : 'ORG_ADMIN',
    },
    select: { user: { select: { id: true, email: true, name: true } } },
  });

  if (!isDemoUser(target.user.email)) {
    return new NextResponse('Not found', { status: 404 });
  }

  await endCurrentSession();
  await startDemoSession(target.user.id);

  return NextResponse.json({
    displayName: target.user.name,
    organizationSlug: membership.organization.slug,
  });
}
