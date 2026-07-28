import { isDomainError, listOrganizationsForUser } from '@verity/domain';
import { ORG_ROLE_LABELS } from '@verity/schemas';
import { Badge } from '@verity/ui';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DEMO_PERSONAS, isDemoEnabled, isDemoUser, personaForRole } from '@/lib/demo';
import { membershipForSlug } from '@/lib/org';
import { getSessionUser } from '@/lib/session';
import { OrgNav } from './org-nav';
import { PersonaSwitcher } from './persona-switcher';
import { SignOutButton } from './sign-out-button';

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/signin');
  }

  const { slug } = await params;

  let membership;
  try {
    membership = await membershipForSlug(user, slug);
  } catch (error) {
    if (isDomainError(error)) {
      // A slug in another organization is indistinguishable from one that does
      // not exist.
      notFound();
    }
    throw error;
  }

  const organizations = await listOrganizationsForUser(user.id);

  const inDemo = isDemoEnabled && isDemoUser(user.email);
  const actingAs = personaForRole(membership.role);
  const other = actingAs === 'requester' ? 'approver' : 'requester';

  return (
    <div className="min-h-screen">
      {inDemo ? (
        <PersonaSwitcher
          current={actingAs}
          otherName={DEMO_PERSONAS[other].name.split(' ')[0] ?? 'the other person'}
          otherRole={other}
        />
      ) : null}

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href={`/o/${slug}`} className="text-sm font-semibold tracking-wide text-slate-500">
              VERITY
            </Link>
            <span aria-hidden="true" className="text-slate-300">
              /
            </span>
            <span className="font-medium text-slate-900">{membership.organizationName}</span>
            <Badge>{ORG_ROLE_LABELS[membership.role]}</Badge>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {organizations.length > 1 ? (
              <nav aria-label="Switch organization" className="flex items-center gap-2">
                {organizations
                  .filter((organization) => organization.slug !== slug)
                  .map((organization) => (
                    <Link
                      key={organization.organizationId}
                      href={`/o/${organization.slug}`}
                      className="text-slate-600 underline hover:text-slate-900"
                    >
                      {organization.name}
                    </Link>
                  ))}
              </nav>
            ) : null}
            <span className="text-slate-600">{user.displayName ?? user.email}</span>
            <SignOutButton />
          </div>
        </div>

        <OrgNav slug={slug} role={membership.role} />
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
