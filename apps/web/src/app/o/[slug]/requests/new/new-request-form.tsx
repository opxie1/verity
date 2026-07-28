'use client';

import { ACTION_TYPE_LABELS, type ActionTypeValue } from '@verity/schemas';
import { Alert, Button, Field, Input, Select, Textarea } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';
import {
  ACTION_FIELDS,
  EXPIRATION_CHOICES,
  parseAmountToMinor,
  type FieldDefinition,
} from './field-definitions';

export interface ApproverOption {
  userId: string;
  email: string;
  displayName: string | null;
  hasEnrolledPasskey: boolean;
}

interface CreatedRequest {
  request: { id: string; displaySummary: string; payloadHash: string };
}

export function NewRequestForm({
  organizationId,
  slug,
  approvers,
  enabledActionTypes,
  defaultExpirationMinutes,
  maximumExpirationMinutes,
  thresholdMinor,
  policyCurrency,
  source,
}: {
  organizationId: string;
  slug: string;
  approvers: ApproverOption[];
  enabledActionTypes: ActionTypeValue[];
  defaultExpirationMinutes: number;
  maximumExpirationMinutes: number;
  thresholdMinor: number | null;
  policyCurrency: string;
  source?: { type: 'GMAIL'; messageId?: string; threadId?: string; senderEmail?: string; subject?: string; url?: string };
}) {
  const router = useRouter();
  const [actionType, setActionType] = useState<ActionTypeValue>(enabledActionTypes[0]!);
  const [values, setValues] = useState<Record<string, string>>({ currency: policyCurrency });
  const [approverUserId, setApproverUserId] = useState(approvers[0]?.userId ?? '');
  const [expiresInMinutes, setExpiresInMinutes] = useState(defaultExpirationMinutes);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const definitions = ACTION_FIELDS[actionType] ?? [];
  const selectedApprover = approvers.find((approver) => approver.userId === approverUserId);

  const amountMinor = useMemo(
    () => (values.amountMinor ? parseAmountToMinor(values.amountMinor) : null),
    [values.amountMinor],
  );

  const aboveThreshold =
    thresholdMinor !== null && amountMinor !== null && amountMinor >= thresholdMinor;

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function buildFields(): Record<string, unknown> | null {
    const fields: Record<string, unknown> = {};
    for (const definition of definitions) {
      const raw = (values[definition.name] ?? '').trim();
      if (raw === '') {
        if (definition.required) {
          setFieldErrors({ [definition.name]: [`${definition.label} is required.`] });
          return null;
        }
        continue;
      }
      if (definition.kind === 'amount') {
        const minor = parseAmountToMinor(raw);
        if (minor === null || minor <= 0) {
          setFieldErrors({ [definition.name]: ['Enter an amount such as 25000.00'] });
          return null;
        }
        fields[definition.name] = minor;
      } else {
        fields[definition.name] = raw;
      }
    }
    return fields;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(undefined);
    setFieldErrors({});

    const fields = buildFields();
    if (!fields) {
      return;
    }

    setPending(true);
    try {
      const result = await apiFetch<CreatedRequest>('/api/requests', {
        method: 'POST',
        body: {
          organizationId,
          assignedApproverUserId: approverUserId,
          actionType,
          expiresInMinutes,
          fields,
          ...(source ? { source } : {}),
        },
      });
      router.push(`/o/${slug}/requests/${result.request.id}`);
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

  if (approvers.length === 0) {
    return (
      <Alert tone="warning" title="Nobody can approve requests yet">
        An administrator needs to give someone the Approver role, and that person needs to register
        a passkey, before a request can be verified.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Field label="What is being requested?" htmlFor="actionType">
        <Select
          id="actionType"
          value={actionType}
          onChange={(event) => {
            setActionType(event.target.value as ActionTypeValue);
            setValues({ currency: policyCurrency });
            setFieldErrors({});
          }}
        >
          {enabledActionTypes.map((type) => (
            <option key={type} value={type}>
              {ACTION_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-slate-900">
          Details the approver will confirm
        </legend>
        <p className="text-sm text-slate-600">
          Type these from the source document, not by copying the email. Every value here is bound
          into the approval, so changing any of them afterwards invalidates it.
        </p>

        {definitions.map((definition) => (
          <RequestField
            key={definition.name}
            definition={definition}
            value={values[definition.name] ?? ''}
            error={fieldErrors[definition.name]?.[0]}
            onChange={(value) => setValue(definition.name, value)}
          />
        ))}
      </fieldset>

      {aboveThreshold ? (
        <Alert tone="warning" title="This is above your organization's review threshold">
          Your organization asked to be reminded about payments at or above this amount. Confirm the
          account details with the recipient through a channel you already trust, not one from this
          request.
        </Alert>
      ) : null}

      <Field
        label="Who must approve this?"
        htmlFor="approver"
        error={fieldErrors.assignedApproverUserId?.[0]}
        hint={
          selectedApprover && !selectedApprover.hasEnrolledPasskey
            ? 'This person has not registered a passkey, so they cannot approve anything yet.'
            : 'The person who supposedly made this request. They approve on their own device.'
        }
      >
        <Select
          id="approver"
          value={approverUserId}
          onChange={(event) => setApproverUserId(event.target.value)}
        >
          {approvers.map((approver) => (
            <option key={approver.userId} value={approver.userId}>
              {approver.displayName ?? approver.email}
              {approver.hasEnrolledPasskey ? '' : ' — no passkey yet'}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="How long should this stay open?"
        htmlFor="expiry"
        hint="After this it expires and cannot be approved. A short window limits how long an approval is worth stealing."
      >
        <Select
          id="expiry"
          value={expiresInMinutes}
          onChange={(event) => setExpiresInMinutes(Number(event.target.value))}
        >
          {EXPIRATION_CHOICES.filter((choice) => choice.minutes <= maximumExpirationMinutes).map(
            (choice) => (
              <option key={choice.minutes} value={choice.minutes}>
                {choice.label}
              </option>
            ),
          )}
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send for approval'}
        </Button>
        <p className="text-sm text-slate-500">
          {selectedApprover?.displayName ?? selectedApprover?.email} will be emailed a link and must
          confirm with their passkey.
        </p>
      </div>
    </form>
  );
}

function RequestField({
  definition,
  value,
  error,
  onChange,
}: {
  definition: FieldDefinition;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${definition.name}`;
  const common = {
    id,
    value,
    required: definition.required,
    'aria-invalid': Boolean(error),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };

  return (
    <Field
      label={definition.required ? definition.label : `${definition.label} (optional)`}
      htmlFor={id}
      error={error}
      hint={definition.hint}
    >
      {definition.kind === 'longtext' ? (
        <Textarea {...common} rows={3} maxLength={500} placeholder={definition.placeholder} />
      ) : definition.kind === 'date' ? (
        <Input {...common} type="date" />
      ) : definition.kind === 'lastFour' ? (
        <Input
          {...common}
          inputMode="numeric"
          maxLength={4}
          pattern="\d{4}"
          placeholder={definition.placeholder}
          className="w-32"
        />
      ) : definition.kind === 'currency' ? (
        <Input {...common} maxLength={3} className="w-24 uppercase" placeholder="USD" />
      ) : definition.kind === 'amount' ? (
        <Input {...common} inputMode="decimal" placeholder={definition.placeholder} />
      ) : (
        <Input {...common} maxLength={300} placeholder={definition.placeholder} />
      )}
    </Field>
  );
}
