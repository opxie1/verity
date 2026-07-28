'use client';

import { startAuthentication, WebAuthnError } from '@simplewebauthn/browser';
import { Alert, Button, Field, Textarea } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

type Decision = 'APPROVE' | 'DENY';

interface DecisionOptionsResponse {
  options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
}

interface DecisionResultResponse {
  status: 'APPROVED' | 'DENIED';
  receiptId: string;
}

function describeError(error: unknown): string {
  if (error instanceof WebAuthnError) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'The passkey prompt was cancelled or timed out. Nothing was recorded. Try again.';
      case 'AbortError':
        return 'The passkey prompt was cancelled. Nothing was recorded.';
      default:
        return 'Your device could not complete the request. Nothing was recorded. Try again.';
    }
  }
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return 'Something went wrong and nothing was recorded. Try again.';
}

export function DecisionPanel({
  organizationId,
  requestId,
  summary,
}: {
  organizationId: string;
  requestId: string;
  summary: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Decision>();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string>();

  async function decide(decision: Decision) {
    setPending(decision);
    setFailure(undefined);

    try {
      // The challenge is issued by the server and binds this request, these
      // exact details and this answer. The browser only relays it.
      const { options } = await apiFetch<DecisionOptionsResponse>(
        `/api/requests/${requestId}/decision/options`,
        { method: 'POST', body: { organizationId, decision } },
      );

      const response = await startAuthentication({ optionsJSON: options });

      const result = await apiFetch<DecisionResultResponse>(
        `/api/requests/${requestId}/decision/verify`,
        {
          method: 'POST',
          body: {
            organizationId,
            decision,
            response,
            ...(decision === 'DENY' && reason.trim() ? { reason: reason.trim() } : {}),
          },
        },
      );

      router.push(`/receipts/${result.receiptId}`);
      router.refresh();
    } catch (error) {
      setFailure(describeError(error));
      setPending(undefined);
    }
  }

  return (
    <section className="mt-8 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {failure ? (
        <Alert tone="danger" className="mb-4">
          {failure}
        </Alert>
      ) : null}

      <p className="text-sm font-medium text-slate-900">
        Approving confirms that you authorize the exact action shown above.
      </p>
      <p className="mt-1 text-sm text-slate-600">
        It does not confirm that the action is a good idea, and it covers these details only. If any
        of them change afterwards, this approval no longer applies to them.
      </p>

      {denying ? (
        <div className="mt-5">
          <Field
            label="Why are you denying this? (optional)"
            htmlFor="deny-reason"
            hint="The requester sees this. If something looks wrong, saying so helps them act on it."
          >
            <Textarea
              id="deny-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="I did not send this request, and I have not changed our bank details."
            />
          </Field>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          variant="approve"
          size="lg"
          disabled={pending !== undefined}
          onClick={() => void decide('APPROVE')}
        >
          {pending === 'APPROVE' ? 'Waiting for your passkey…' : 'Approve with passkey'}
        </Button>

        {denying ? (
          <Button
            variant="destructive"
            size="lg"
            disabled={pending !== undefined}
            onClick={() => void decide('DENY')}
          >
            {pending === 'DENY' ? 'Waiting for your passkey…' : 'Confirm denial with passkey'}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            disabled={pending !== undefined}
            onClick={() => setDenying(true)}
          >
            Deny
          </Button>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Your device will ask you to confirm. It signs a message naming this request and this answer,
        so the confirmation cannot be reused for anything else.
      </p>

      <p className="sr-only">You are deciding: {summary}</p>
    </section>
  );
}
