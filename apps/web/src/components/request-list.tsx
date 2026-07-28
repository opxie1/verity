import type { ActionTypeValue, RequestStatusValue } from '@verity/schemas';
import { EmptyState } from '@verity/ui';
import Link from 'next/link';
import { RequestStatusBadge } from './request-status-badge';

export interface RequestListItem {
  id: string;
  status: RequestStatusValue;
  actionType: ActionTypeValue;
  displayTitle: string;
  requesterName: string;
  approverName: string;
  createdAt: string;
  expiresAt: string;
}

/** Countdown text, phrased so an approver can see urgency at a glance. */
function timeRemaining(expiresAt: string, now: number): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) {
    return 'expired';
  }
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) {
    return `${minutes} min left`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h left` : `${Math.floor(hours / 24)} d left`;
}

export function RequestList({
  slug,
  requests,
  emptyTitle,
  emptyBody,
}: {
  slug: string;
  requests: RequestListItem[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (requests.length === 0) {
    return <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>;
  }

  const now = Date.now();

  return (
    <ul className="divide-y divide-slate-100">
      {requests.map((request) => (
        <li key={request.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/o/${slug}/requests/${request.id}`}
                className="font-medium text-slate-900 underline-offset-2 hover:underline"
              >
                {request.displayTitle}
              </Link>
              <p className="mt-0.5 text-sm text-slate-500">
                Raised by {request.requesterName} · approver {request.approverName}
                {request.status === 'PENDING'
                  ? ` · ${timeRemaining(request.expiresAt, now)}`
                  : ''}
              </p>
            </div>
            <RequestStatusBadge status={request.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
