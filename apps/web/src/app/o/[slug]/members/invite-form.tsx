'use client';

import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS, type OrgRoleValue } from '@verity/schemas';
import { Alert, Button, Field, Input, Select } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

const ROLES: OrgRoleValue[] = ['REQUESTER', 'APPROVER', 'ORG_ADMIN', 'AUDITOR'];

export function InviteForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRoleValue>('REQUESTER');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    setSentTo(undefined);
    setFieldErrors({});

    try {
      await apiFetch(`/api/organizations/${organizationId}/invitations`, {
        method: 'POST',
        body: { email, role },
      });
      setSentTo(email);
      setEmail('');
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
      {sentTo ? <Alert tone="success">Invitation sent to {sentTo}.</Alert> : null}

      <Field label="Email address" htmlFor="invite-email" error={fieldErrors.email?.[0]}>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="colleague@company.com"
          aria-invalid={Boolean(fieldErrors.email)}
        />
      </Field>

      <Field label="Role" htmlFor="invite-role" hint={ORG_ROLE_DESCRIPTIONS[role]}>
        <Select
          id="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as OrgRoleValue)}
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ORG_ROLE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" disabled={pending || email.length === 0} className="w-full">
        {pending ? 'Sending…' : 'Send invitation'}
      </Button>

      <p className="text-xs text-slate-500">
        The invitation link expires in seven days, works once, and only works for the address you
        enter here.
      </p>
    </form>
  );
}
