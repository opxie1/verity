'use client';

import { Alert, Button, Field, Input } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

interface AcceptResponse {
  organization: { slug: string };
}

export function AcceptInvitationForm({
  token,
  organizationName,
  needsDisplayName,
}: {
  token: string;
  organizationName: string;
  needsDisplayName: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    try {
      const result = await apiFetch<AcceptResponse>('/api/invitations/accept', {
        method: 'POST',
        body: {
          token,
          ...(needsDisplayName && displayName.trim() ? { displayName: displayName.trim() } : {}),
        },
      });
      router.push(`/o/${result.organization.slug}`);
      router.refresh();
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      {needsDisplayName ? (
        <Field
          label="Your name"
          htmlFor="displayName"
          hint="Shown to colleagues on requests and receipts."
        >
          <Input
            id="displayName"
            required
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Jane Smith"
          />
        </Field>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Joining…' : `Join ${organizationName}`}
      </Button>
    </form>
  );
}
