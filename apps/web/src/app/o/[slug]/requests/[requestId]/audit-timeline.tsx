import type { AuditEventTypeValue } from '@verity/schemas';

/**
 * Append-only history of a request (PRD 23.2).
 *
 * Rendered in the order events happened, with nothing hidden or merged, so the
 * timeline reads as a record rather than a summary.
 */
const EVENT_DESCRIPTIONS: Partial<Record<AuditEventTypeValue, string>> = {
  REQUEST_CREATED: 'Request created',
  REQUEST_SUBMITTED: 'Sent to the approver',
  REQUEST_VIEWED: 'Opened by the approver',
  REQUEST_APPROVED: 'Approved with a passkey',
  REQUEST_DENIED: 'Denied with a passkey',
  REQUEST_EXPIRED: 'Expired without a decision',
  REQUEST_CANCELED: 'Canceled by the requester',
  APPROVAL_REVOKED: 'Approval revoked',
  RECEIPT_VIEWED: 'Receipt viewed',
  FAILED_APPROVAL_ATTEMPT: 'A decision attempt failed',
  AUTHORIZATION_FAILURE: 'Someone was refused access',
};

export interface TimelineEvent {
  id: string;
  eventType: AuditEventTypeValue;
  createdAt: string;
  actorName: string | null;
  previousState: string | null;
  newState: string | null;
}

export function AuditTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-600">Nothing recorded yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
          <div>
            <p className="text-slate-900">
              {EVENT_DESCRIPTIONS[event.eventType] ?? event.eventType}
              {event.previousState && event.newState ? (
                <span className="text-slate-500">
                  {' '}
                  ({event.previousState} → {event.newState})
                </span>
              ) : null}
            </p>
            <p className="text-slate-500">
              {new Date(event.createdAt).toLocaleString()}
              {event.actorName ? ` · ${event.actorName}` : ' · automatic'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
