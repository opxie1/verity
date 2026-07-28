import 'server-only';
import { prisma } from '@verity/database';
import { DomainError, type SessionUser } from '@verity/domain';
import { auth } from './auth';

/**
 * Loads the authenticated user from the database on every call.
 *
 * The session cookie only supplies an ID; status, role and email verification
 * are read fresh, so an administrator disabling an account takes effect on the
 * account's next request rather than when its session happens to expire.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, status: true, emailVerified: true },
  });

  if (!user || user.status === 'DISABLED') {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerified,
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new DomainError('UNAUTHENTICATED');
  }
  return user;
}
