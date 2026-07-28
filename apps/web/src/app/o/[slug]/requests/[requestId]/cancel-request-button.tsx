'use client';

import { Alert, Button, Field, Textarea } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export function CancelRequestButton({
  organizationId,
  requestId,
}: {
  organizationId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  async function cancel() {
    setPending(true);
    setFailure(undefined);
    try {
      await apiFetch(`/api/requests/${requestId}/cancel`, {
        method: 'POST',
        body: { organizationId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      router.refresh();
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
      );
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Cancel this request
        </Button>
        <p className="text-xs text-slate-500">
          The approver is told it was withdrawn, and it can no longer be approved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Field label="Why are you cancelling? (optional)" htmlFor="cancel-reason">
        <Textarea
          id="cancel-reason"
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Confirmed with the vendor by phone; no payment needed."
        />
      </Field>

      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending} onClick={() => void cancel()}>
          {pending ? 'Cancelling…' : 'Confirm cancellation'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Keep it open
        </Button>
      </div>
    </div>
  );
}
