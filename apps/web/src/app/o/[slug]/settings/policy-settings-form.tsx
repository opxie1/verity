'use client';

import { Alert, Button, Field, Input, Select } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export interface PolicyValues {
  allowSelfApproval: boolean;
  defaultExpirationMinutes: number;
  maximumExpirationMinutes: number;
  requirePasskeyEnrollment: boolean;
  verificationRecommendedThresholdMinor: number | null;
  currency: string;
}

const EXPIRATION_CHOICES = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '24 hours' },
];

/** Converts a decimal string such as "25000.00" into minor units. */
function toMinorUnits(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return Number.NaN;
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
  return major * 100 + minor;
}

function fromMinorUnits(value: number | null): string {
  if (value === null) return '';
  return (value / 100).toFixed(2);
}

export function PolicySettingsForm({
  organizationId,
  policy,
}: {
  organizationId: string;
  policy: PolicyValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(policy);
  const [threshold, setThreshold] = useState(
    fromMinorUnits(policy.verificationRecommendedThresholdMinor),
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(undefined);
    setSaved(false);
    setFieldErrors({});

    const thresholdMinor = toMinorUnits(threshold);
    if (Number.isNaN(thresholdMinor)) {
      setFieldErrors({ verificationRecommendedThresholdMinor: ['Enter an amount such as 10000.00'] });
      return;
    }

    setPending(true);
    try {
      await apiFetch(`/api/organizations/${organizationId}/policy`, {
        method: 'PATCH',
        body: { ...values, verificationRecommendedThresholdMinor: thresholdMinor },
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
    <form onSubmit={onSubmit} className="space-y-5">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {saved ? <Alert tone="success">Saved.</Alert> : null}

      <Field
        label="Default expiration"
        htmlFor="default-expiration"
        hint="How long a new request waits for a decision before it expires."
      >
        <Select
          id="default-expiration"
          value={values.defaultExpirationMinutes}
          onChange={(event) =>
            setValues({ ...values, defaultExpirationMinutes: Number(event.target.value) })
          }
        >
          {EXPIRATION_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Maximum expiration"
        htmlFor="maximum-expiration"
        error={fieldErrors.defaultExpirationMinutes?.[0]}
        hint="The longest a requester may keep a request open. Shorter windows give an attacker less time to reuse an approval."
      >
        <Select
          id="maximum-expiration"
          value={values.maximumExpirationMinutes}
          onChange={(event) =>
            setValues({ ...values, maximumExpirationMinutes: Number(event.target.value) })
          }
        >
          {EXPIRATION_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Amount above which verification is recommended"
        htmlFor="threshold"
        error={fieldErrors.verificationRecommendedThresholdMinor?.[0]}
        hint={`In ${values.currency}. Payments at or above this amount are flagged in the interface. Verity does not block anything outside itself.`}
      >
        <Input
          id="threshold"
          inputMode="decimal"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          placeholder="10000.00"
          aria-invalid={Boolean(fieldErrors.verificationRecommendedThresholdMinor)}
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-900">Rules</legend>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={values.requirePasskeyEnrollment}
            onChange={(event) =>
              setValues({ ...values, requirePasskeyEnrollment: event.target.checked })
            }
          />
          <span>
            <span className="font-medium text-slate-900">Require a passkey to approve</span>
            <span className="block text-slate-600">
              Keep this on. Without it there is nothing distinguishing a real approver from someone
              who reached their inbox.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={values.allowSelfApproval}
            onChange={(event) => setValues({ ...values, allowSelfApproval: event.target.checked })}
          />
          <span>
            <span className="font-medium text-slate-900">
              Allow a requester to approve their own request
            </span>
            <span className="block text-slate-600">
              Off by default. Turning it on removes the second pair of eyes that makes a
              verification meaningful.
            </span>
          </span>
        </label>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save policy'}
      </Button>
    </form>
  );
}
