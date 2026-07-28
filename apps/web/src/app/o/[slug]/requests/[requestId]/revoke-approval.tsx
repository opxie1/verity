'use client';

import { startAuthentication, WebAuthnError } from '@simplewebauthn/browser';
import { Alert, Button, Field, Textarea } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export function RevokeApproval({
  organizationId,
  requestId,
}: {
  organizationId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  async function revoke() {
    if (reason.trim().length === 0) {
      setFailure('Say why you are revoking this approval.');
      return;
    }

    setPending(true);
    setFailure(undefined);
    try {
      const { options } = await apiFetch<{
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      }>(`/api/requests/${requestId}/revoke/options`, {
        method: 'POST',
        body: { organizationId },
      });

      const response = await startAuthentication({ optionsJSON: options });

      await apiFetch(`/api/requests/${requestId}/revoke/verify`, {
        method: 'POST',
        body: { organizationId, response, reason: reason.trim() },
      });

      router.refresh();
    } catch (error) {
      if (error instanceof WebAuthnError) {
        setFailure('The passkey prompt was cancelled. Nothing was changed.');
      } else {
        setFailure(
          error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
        );
      }
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Revoke this approval
        </Button>
        <p className="text-xs text-slate-500">
          Withdraws the approval going forward. The original decision and its receipt stay on the
          record; the receipt will show that it was valid and is no longer in force.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Alert tone="warning">
        Somebody may already have acted on this approval. Revoking tells the requester and every
        administrator immediately, but it cannot undo anything done outside Verity.
      </Alert>

      <Field
        label="Why are you revoking this?"
        htmlFor="revoke-reason"
        hint="Everyone notified sees this. Be specific enough that they know what to do."
      >
        <Textarea
          id="revoke-reason"
          rows={3}
          maxLength={500}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="The vendor confirmed by phone that they did not change their bank details."
        />
      </Field>

      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending} onClick={() => void revoke()}>
          {pending ? 'Waiting for your passkey…' : 'Revoke with passkey'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Keep the approval
        </Button>
      </div>
    </div>
  );
}
