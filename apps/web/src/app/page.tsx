import { listOrganizationsForUser } from '@verity/domain';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

/**
 * Sends the visitor wherever they actually need to be: sign in, create their
 * first organization, or their dashboard.
 */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/signin');
  }

  const organizations = await listOrganizationsForUser(user.id);
  if (organizations.length === 0) {
    redirect('/onboarding');
  }

  redirect(`/o/${organizations[0]!.slug}`);
}
