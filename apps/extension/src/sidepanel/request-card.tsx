import { useEffect, useState } from 'react';
import { ExtensionApiError, cancelRequest, getRequestStatus, webAppUrl } from '../shared/api';
import type { ThreadRequestSummary } from '../shared/types';
import { Banner, Button, StatusPill } from './ui';

/**
 * One request's state, as shown in the Gmail panel (PRD 23.4).
 *
 * The panel shows status and never renders the approve or deny controls. A
 * decision is always taken on the Verity page, where the details are loaded
 * straight from the server — so an extension that had been tampered with could
 * not show one action while the approver authorized another (PRD 18.9).
 */
export function RequestCard({
  request,
  organizationId,
  onChanged,
}: {
  request: ThreadRequestSummary;
  organizationId: string;
  onChanged: () => Promise<void>;
}) {
  const [remaining, setRemaining] = useState(() => timeLeft(request.expiresAt));
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (request.status !== 'PENDING') return;
    const timer = window.setInterval(() => setRemaining(timeLeft(request.expiresAt)), 30_000);
    return () => window.clearInterval(timer);
  }, [request.status, request.expiresAt]);

  async function refresh() {
    setRefreshing(true);
    setFailure(undefined);
    try {
      await getRequestStatus(organizationId, request.id);
      await onChanged();
    } catch (error) {
      setFailure(error instanceof ExtensionApiError ? error.message : 'Could not refresh.');
    } finally {
      setRefreshing(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    setFailure(undefined);
    try {
      await cancelRequest(organizationId, request.id);
      setConfirmingCancel(false);
      await onChanged();
    } catch (error) {
      setFailure(error instanceof ExtensionApiError ? error.message : 'Could not cancel.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="rounded-md bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{request.displayTitle}</p>
        <StatusPill status={request.status} />
      </div>

      <p className="mt-1 text-[11px] text-slate-500">
        Approver: {request.approverName}
        {request.status === 'PENDING' ? ` · ${remaining}` : ''}
      </p>

      {request.status === 'APPROVED' ? (
        <Banner tone="success" className="mt-2">
          Before you act, open the receipt and check that every detail matches what you are about to
          enter. The approval covers those details and nothing else.
        </Banner>
      ) : null}

      {request.status === 'DENIED' ? (
        <Banner tone="danger" className="mt-2">
          {request.approverName} denied this.
          {request.deniedReason ? ` Reason given: ${request.deniedReason}` : ''} Do not act on the
          original message.
        </Banner>
      ) : null}

      {request.status === 'REVOKED' ? (
        <Banner tone="danger" className="mt-2">
          This approval was withdrawn after it was given. Do not act on it.
        </Banner>
      ) : null}

      {request.status === 'EXPIRED' ? (
        <Banner tone="warning" className="mt-2">
          Nobody decided this before it lapsed. Raise it again if it is still needed.
        </Banner>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="h-8 px-2 text-xs"
          onClick={() => void chrome.tabs.create({ url: webAppUrl(`/r/${request.id}`) })}
        >
          Open request
        </Button>

        {request.receiptId ? (
          <Button
            variant="secondary"
            className="h-8 px-2 text-xs"
            onClick={() =>
              void chrome.tabs.create({ url: webAppUrl(`/receipts/${request.receiptId}`) })
            }
          >
            View receipt
          </Button>
        ) : null}

        {request.status === 'PENDING' ? (
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Checking…' : 'Refresh'}
          </Button>
        ) : null}

        {request.status === 'PENDING' && !confirmingCancel ? (
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setConfirmingCancel(true)}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      {confirmingCancel ? (
        <div className="mt-2 rounded-md bg-slate-100 p-2">
          <p className="text-[11px] text-slate-700">
            Withdraw this request? The approver is told, and it can no longer be approved.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              className="h-7 px-2 text-[11px]"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {cancelling ? 'Cancelling…' : 'Yes, withdraw it'}
            </Button>
            <Button
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              disabled={cancelling}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep it open
            </Button>
          </div>
        </div>
      ) : null}

      {failure ? (
        <Banner tone="danger" className="mt-2">
          {failure}
        </Banner>
      ) : null}
    </div>
  );
}

function timeLeft(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'expired';
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h left` : `${Math.floor(hours / 24)} d left`;
}
