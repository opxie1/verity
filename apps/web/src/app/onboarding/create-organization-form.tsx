'use client';

import { Alert, Button, Field, Input } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

interface CreateOrganizationResponse {
  organization: { id: string; slug: string };
}

export function CreateOrganizationForm({
  defaultAdministratorName,
  disabled,
}: {
  defaultAdministratorName: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [administratorName, setAdministratorName] = useState(defaultAdministratorName);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    setFieldErrors({});

    try {
      const result = await apiFetch<CreateOrganizationResponse>('/api/organizations', {
        method: 'POST',
        body: {
          name,
          administratorName,
          ...(domain.trim() ? { domain: domain.trim() } : {}),
        },
      });
      router.push(`/o/${result.organization.slug}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFailure(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFailure('Something went wrong. Try again.');
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Field label="Organization name" htmlFor="name" error={fieldErrors.name?.[0]}>
        <Input
          id="name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Consulting"
          aria-invalid={Boolean(fieldErrors.name)}
        />
      </Field>

      <Field
        label="Your name"
        htmlFor="administratorName"
        error={fieldErrors.administratorName?.[0]}
        hint="Shown to approvers so they can see who asked for a decision."
      >
        <Input
          id="administratorName"
          required
          maxLength={120}
          value={administratorName}
          onChange={(event) => setAdministratorName(event.target.value)}
          placeholder="Alex Rivera"
          aria-invalid={Boolean(fieldErrors.administratorName)}
        />
      </Field>

      <Field
        label="Business email domain (optional)"
        htmlFor="domain"
        error={fieldErrors.domain?.[0]}
        hint="Recorded for your reference. It does not grant anyone access on its own."
      >
        <Input
          id="domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="acme.com"
          aria-invalid={Boolean(fieldErrors.domain)}
        />
      </Field>

      <Button type="submit" disabled={disabled || pending} className="w-full">
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
