import { listInvitations, listMembers, requirePermission } from '@verity/domain';
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';
import { InviteForm } from './invite-form';
import { InvitationList } from './invitation-list';
import { MemberList } from './member-list';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireSessionUser();
  const { slug } = await params;
  const membership = await membershipForSlug(user, slug);

  try {
    requirePermission(membership, 'org:member:update');
  } catch {
    notFound();
  }

  const [members, invitations] = await Promise.all([
    listMembers(membership),
    listInvitations(membership),
  ]);

  return (
    <>
      <PageHeader
        title="Members"
        description="Who belongs to this organization, what they may do, and whether they can approve."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <MemberList
                organizationId={membership.organizationId}
                currentUserId={user.id}
                members={members.map((member) => ({
                  ...member,
                  joinedAt: member.joinedAt.toISOString(),
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <InvitationList
                organizationId={membership.organizationId}
                invitations={invitations.map((invitation) => ({
                  ...invitation,
                  expiresAt: invitation.expiresAt.toISOString(),
                  createdAt: invitation.createdAt.toISOString(),
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <CardBody>
            <InviteForm organizationId={membership.organizationId} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
