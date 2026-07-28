import { randomBytes } from 'node:crypto';
import { prisma } from '@verity/database';
import { NextResponse } from 'next/server';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_PERSONAS,
  assertDemoEnabled,
  isDemoEnabled,
  startDemoSession,
} from '@/lib/demo';

/**
 * Creates a private sandbox and signs the visitor in as the requester.
 *
 * A whole organization per visitor rather than one shared demo account,
 * because passkeys are registered per device: two people sharing an approver
 * account would each see the other's credentials offered and neither could
 * use them. Separate organizations also mean one visitor never sees another's
 * requests, which is the same isolation real customers get.
 */
export async function POST() {
  if (!isDemoEnabled) {
    return new NextResponse('Not found', { status: 404 });
  }
  assertDemoEnabled();

  const suffix = randomBytes(6).toString('hex');

  const organization = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: 'Acme Consulting',
        slug: `demo-${suffix}`,
        policy: {
          create: {
            // A payment above this is flagged in the interface, so the demo
            // shows the warning without anyone having to configure it.
            verificationRecommendedThresholdMinor: BigInt(500_000),
          },
        },
      },
      select: { id: true, slug: true },
    });

    for (const [key, persona] of Object.entries(DEMO_PERSONAS)) {
      await tx.user.create({
        data: {
          email: `${key}-${suffix}@${DEMO_EMAIL_DOMAIN}`,
          name: persona.name,
          // Verified because in this sandbox the address is issued by us, not
          // claimed by a visitor. Organization creation and invitations both
          // require a verified address.
          emailVerified: new Date(),
          status: 'ACTIVE',
          memberships: {
            create: { organizationId: created.id, role: persona.role, status: 'ACTIVE' },
          },
        },
      });
    }

    return created;
  });

  const requester = await prisma.user.findFirstOrThrow({
    where: { email: `requester-${suffix}@${DEMO_EMAIL_DOMAIN}` },
    select: { id: true },
  });

  await startDemoSession(requester.id);

  return NextResponse.json({ organizationSlug: organization.slug });
}
