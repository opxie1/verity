import { prisma } from '@verity/database';
import { listMembers, listRequests, roleHasPermission } from '@verity/domain';
import type { ActionTypeValue, RequestStatusValue } from '@verity/schemas';
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from '@verity/ui';
import Link from 'next/link';
import { RequestList, type RequestListItem } from '@/components/request-list';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireSessionUser();
  const { slug } = await params;
  const membership = await membershipForSlug(user, slug);

  const canCreate = roleHasPermission(membership.role, 'request:create');
  const canManage = membership.role === 'ORG_ADMIN';

  const [passkeyCount, memberCount, allRequests, members] = await Promise.all([
    prisma.passkeyCredential.count({ where: { userId: user.id, revokedAt: null } }),
    prisma.organizationMember.count({
      where: { organizationId: membership.organizationId, status: 'ACTIVE' },
    }),
    listRequests(membership, { limit: 100 }),
    canManage ? listMembers(membership) : Promise.resolve([]),
  ]);

  const toItem = (request: (typeof allRequests.requests)[number]): RequestListItem => ({
    id: request.id,
    status: request.status as RequestStatusValue,
    actionType: request.actionType as ActionTypeValue,
    displayTitle: request.displayTitle,
    requesterName: request.requester.name ?? request.requester.email,
    approverName: request.approver.name ?? request.approver.email,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  });

  const awaitingMe = allRequests.requests
    .filter((request) => request.viewerIsApprover && request.status === 'PENDING')
    .map(toItem);

  const mine = allRequests.requests
    .filter((request) => request.viewerIsRequester)
    .slice(0, 10)
    .map(toItem);

  const recent = allRequests.requests.slice(0, 10).map(toItem);

  const approversWithoutPasskeys = members.filter(
    (member) =>
      (member.role === 'APPROVER' || member.role === 'ORG_ADMIN') &&
      member.status === 'ACTIVE' &&
      !member.hasEnrolledPasskey,
  );

  return (
    <>
      <PageHeader
        title={membership.organizationName}
        description="Requests, approvals and receipts for your organization."
        actions={
          canCreate ? (
            <Link href={`/o/${slug}/requests/new`}>
              <Button>New verification request</Button>
            </Link>
          ) : null
        }
      />

      {passkeyCount === 0 ? (
        <Alert tone="warning" title="You have not registered a passkey" className="mb-6">
          <p>
            A passkey is what proves a decision came from you rather than from someone with access
            to your mailbox. You cannot approve or deny a request until you register one.
          </p>
          <p className="mt-2">
            <Link href="/security" className="font-medium underline">
              Register a passkey
            </Link>
          </p>
        </Alert>
      ) : null}

      {approversWithoutPasskeys.length > 0 ? (
        <Alert tone="warning" title="Some approvers cannot approve yet" className="mb-6">
          {approversWithoutPasskeys.map((member) => member.displayName ?? member.email).join(', ')}{' '}
          {approversWithoutPasskeys.length === 1 ? 'has' : 'have'} no registered passkey. Assigning a
          request to them will leave it waiting.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Requests needing your approval
              {awaitingMe.length > 0 ? ` (${awaitingMe.length})` : ''}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <RequestList
              slug={slug}
              requests={awaitingMe}
              emptyTitle="Nothing is waiting on you"
              emptyBody="Requests assigned to you for a decision appear here."
            />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your security</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p className="text-slate-600">
                Registered passkeys: <strong className="text-slate-900">{passkeyCount}</strong>
              </p>
              {passkeyCount === 1 ? (
                <p className="text-slate-600">
                  Register a second passkey on another device so losing one does not lock you out.
                </p>
              ) : null}
              <Link href="/security" className="inline-block font-medium text-sky-700 underline">
                Manage passkeys
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p className="text-slate-600">
                Active members: <strong className="text-slate-900">{memberCount}</strong>
              </p>
              {canManage ? (
                <Link
                  href={`/o/${slug}/members`}
                  className="inline-block font-medium text-sky-700 underline"
                >
                  Manage members
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Requests you created</CardTitle>
        </CardHeader>
        <CardBody>
          <RequestList
            slug={slug}
            requests={mine}
            emptyTitle="You have not created any requests"
            emptyBody="Create one when you receive a payment instruction, a bank-account change, or another consequential ask that you want confirmed by the person who supposedly sent it."
          />
        </CardBody>
      </Card>

      {canManage || membership.role === 'AUDITOR' ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent organization activity</CardTitle>
          </CardHeader>
          <CardBody>
            <RequestList
              slug={slug}
              requests={recent}
              emptyTitle="No requests yet"
              emptyBody="Everything raised in this organization appears here."
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
