import { listAuditEvents, requirePermission } from '@verity/domain';
import { auditEventTypeSchema, type AuditEventTypeValue } from '@verity/schemas';
import { Card, CardBody, EmptyState, PageHeader } from '@verity/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { membershipForSlug } from '@/lib/org';
import { requireSessionUser } from '@/lib/session';
import { AuditFilters } from './audit-filters';

export const metadata: Metadata = { title: 'Audit log' };

const EVENT_DESCRIPTIONS: Record<AuditEventTypeValue, string> = {
  ORGANIZATION_CREATED: 'Organization created',
  ORGANIZATION_SETTINGS_UPDATED: 'Organization settings changed',
  POLICY_UPDATED: 'Approval policy changed',
  INVITATION_CREATED: 'Invitation sent',
  INVITATION_RESENT: 'Invitation resent',
  INVITATION_REVOKED: 'Invitation revoked',
  INVITATION_ACCEPTED: 'Invitation accepted',
  ROLE_CHANGED: 'Role changed',
  USER_DISABLED: 'Member disabled',
  USER_REACTIVATED: 'Member reactivated',
  PASSKEY_ADDED: 'Passkey registered',
  PASSKEY_REMOVED: 'Passkey removed',
  REQUEST_CREATED: 'Request created',
  REQUEST_SUBMITTED: 'Request sent for approval',
  REQUEST_VIEWED: 'Request opened by the approver',
  REQUEST_APPROVED: 'Request approved with a passkey',
  REQUEST_DENIED: 'Request denied with a passkey',
  REQUEST_EXPIRED: 'Request expired',
  REQUEST_CANCELED: 'Request canceled',
  APPROVAL_REVOKED: 'Approval revoked',
  RECEIPT_VIEWED: 'Receipt viewed',
  FAILED_APPROVAL_ATTEMPT: 'A decision attempt failed',
  AUTHORIZATION_FAILURE: 'Access refused',
};

/** Events worth reading as security signals rather than routine activity. */
const NOTABLE = new Set<AuditEventTypeValue>([
  'FAILED_APPROVAL_ATTEMPT',
  'AUTHORIZATION_FAILURE',
  'APPROVAL_REVOKED',
  'USER_DISABLED',
  'ROLE_CHANGED',
  'PASSKEY_REMOVED',
]);

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ eventType?: string; cursor?: string }>;
}) {
  const user = await requireSessionUser();
  const { slug } = await params;
  const membership = await membershipForSlug(user, slug);

  try {
    requirePermission(membership, 'audit:read');
  } catch {
    notFound();
  }

  const query = await searchParams;
  const eventType = auditEventTypeSchema.safeParse(query.eventType);

  const result = await listAuditEvents({
    organizationId: membership.organizationId,
    ...(eventType.success ? { eventType: eventType.data } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    limit: 100,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every consequential event in this organization, in the order it happened. Records here cannot be edited or deleted by anyone, including us."
      />

      <AuditFilters slug={slug} selected={eventType.success ? eventType.data : undefined} />

      <Card className="mt-4">
        <CardBody className={result.events.length === 0 ? undefined : 'p-0'}>
          {result.events.length === 0 ? (
            <EmptyState title="No events match">
              Try clearing the filter, or check back after some activity.
            </EmptyState>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Audit events</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-5 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    Who
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((event) => (
                  <tr key={event.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">
                      {event.createdAt.toLocaleString()}
                    </td>
                    <td className="px-5 py-2">
                      <span
                        className={
                          NOTABLE.has(event.eventType)
                            ? 'font-medium text-red-800'
                            : 'text-slate-900'
                        }
                      >
                        {EVENT_DESCRIPTIONS[event.eventType]}
                      </span>
                      {event.previousState && event.newState ? (
                        <span className="ml-1 text-slate-500">
                          ({event.previousState} → {event.newState})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-2 text-slate-700">
                      {event.actor?.name ?? event.actor?.email ?? (
                        <span className="text-slate-500">automatic</span>
                      )}
                    </td>
                    <td className="px-5 py-2">
                      <span className="text-slate-600">{event.targetType}</span>
                      {event.targetId ? (
                        <span className="ml-1 font-mono text-xs text-slate-500">
                          {event.targetId}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {result.nextCursor ? (
        <p className="mt-4 text-sm">
          <a
            href={`/o/${slug}/audit?${new URLSearchParams({
              ...(eventType.success ? { eventType: eventType.data } : {}),
              cursor: result.nextCursor,
            }).toString()}`}
            className="text-sky-700 underline"
          >
            Older events
          </a>
        </p>
      ) : null}
    </>
  );
}
