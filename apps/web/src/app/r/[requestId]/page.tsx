import { prisma } from '@verity/database';
import { requireMembership } from '@verity/domain';
import { requestIdSchema } from '@verity/schemas';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

/**
 * A short link to a request that does not need the organization slug.
 *
 * Emails and the Gmail panel use it, since neither knows the slug. It resolves
 * to the full page only for someone who is actually a member; for anyone else
 * it is indistinguishable from a request that does not exist.
 */
export default async function RequestShortLink({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    notFound();
  }

  const user = await getSessionUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/r/${parsed.data}`)}`);
  }

  const request = await prisma.verificationRequest.findUnique({
    where: { id: parsed.data },
    select: { organizationId: true, organization: { select: { slug: true } } },
  });
  if (!request) {
    notFound();
  }

  try {
    await requireMembership(user, request.organizationId);
  } catch {
    notFound();
  }

  redirect(`/o/${request.organization.slug}/requests/${parsed.data}`);
}
