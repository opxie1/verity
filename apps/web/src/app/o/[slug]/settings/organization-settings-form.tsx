'use client';

import { Alert, Button, Field, Input } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export function OrganizationSettingsForm({
  organizationId,
  name: initialName,
  domain: initialDomain,
}: {
  organizationId: string;
  name: string;
  domain: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [domain, setDomain] = useState(initialDomain ?? '');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    setSaved(false);
    setFieldErrors({});

    try {
      await apiFetch(`/api/organizations/${organizationId}`, {
        method: 'PATCH',
        body: { name, domain: domain.trim() === '' ? null : domain.trim() },
      });
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFailure(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFailure('Something went wrong. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {saved ? <Alert tone="success">Saved.</Alert> : null}

      <Field label="Organization name" htmlFor="org-name" error={fieldErrors.name?.[0]}>
        <Input
          id="org-name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(fieldErrors.name)}
        />
      </Field>

      <Field
        label="Business email domain"
        htmlFor="org-domain"
        error={fieldErrors.domain?.[0]}
        hint="Recorded for reference only. Sharing a domain does not grant anyone access."
      >
        <Input
          id="org-domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="acme.com"
          aria-invalid={Boolean(fieldErrors.domain)}
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
