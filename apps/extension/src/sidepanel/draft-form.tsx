import { useState } from 'react';
import { ExtensionApiError } from '../shared/api';
import type { GmailMessageContext } from '../shared/types';
import { Banner, Button, Field, Input, Select } from './ui';

interface Approver {
  userId: string;
  email: string;
  displayName: string | null;
  hasEnrolledPasskey: boolean;
}

interface FieldSpec {
  name: string;
  label: string;
  kind: 'text' | 'amount' | 'date' | 'lastFour' | 'currency';
  required: boolean;
  placeholder?: string;
}

/**
 * Only the two action types the MVP commits to are offered here (PRD 13).
 * Anything more elaborate is created on the Verity page, where there is room
 * to show the consequences properly.
 */
const FIELDS: Record<string, FieldSpec[]> = {
  PAYMENT_REQUEST: [
    { name: 'amountMinor', label: 'Amount', kind: 'amount', required: true, placeholder: '25000.00' },
    { name: 'currency', label: 'Currency', kind: 'currency', required: true, placeholder: 'USD' },
    {
      name: 'recipientLegalName',
      label: 'Recipient legal name',
      kind: 'text',
      required: true,
      placeholder: 'ABC Consulting LLC',
    },
    { name: 'accountLastFour', label: 'Account ending', kind: 'lastFour', required: true },
    {
      name: 'paymentReason',
      label: 'Reason',
      kind: 'text',
      required: true,
      placeholder: 'July consulting invoice',
    },
    { name: 'requestedCompletionDate', label: 'Complete by', kind: 'date', required: true },
  ],
  BANK_ACCOUNT_CHANGE: [
    { name: 'subjectName', label: 'Vendor or employee', kind: 'text', required: true },
    { name: 'previousAccountLastFour', label: 'Previous account ending', kind: 'lastFour', required: false },
    { name: 'newAccountLastFour', label: 'New account ending', kind: 'lastFour', required: true },
    { name: 'effectiveDate', label: 'Effective date', kind: 'date', required: true },
    { name: 'changeReason', label: 'Reason for change', kind: 'text', required: true },
  ],
};

const LABELS: Record<string, string> = {
  PAYMENT_REQUEST: 'Payment request',
  BANK_ACCOUNT_CHANGE: 'Bank-account change',
};

const EXPIRY_CHOICES = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
];

/** String arithmetic, so 25000.10 does not become 2500009 through a float. */
function toMinorUnits(input: string): number | null {
  const match = /^(\d{1,15})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number.parseInt(match[1]!, 10) * 100 + Number.parseInt((match[2] ?? '0').padEnd(2, '0'), 10);
}

export function DraftForm({
  organizationId,
  approvers,
  enabledActionTypes,
  context,
  onCancel,
  onCreated,
  onSubmit,
}: {
  organizationId: string;
  approvers: Approver[];
  enabledActionTypes: string[];
  context: GmailMessageContext;
  onCancel: () => void;
  onCreated: () => Promise<void>;
  onSubmit: (input: {
    organizationId: string;
    assignedApproverUserId: string;
    actionType: string;
    expiresInMinutes: number;
    fields: Record<string, unknown>;
    source: GmailMessageContext;
  }) => Promise<{ request: { id: string; displaySummary: string } }>;
}) {
  const available = enabledActionTypes.filter((type) => type in FIELDS);
  const [actionType, setActionType] = useState(available[0] ?? 'PAYMENT_REQUEST');
  const [values, setValues] = useState<Record<string, string>>({ currency: 'USD' });
  const [approverUserId, setApproverUserId] = useState(approvers[0]?.userId ?? '');
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [fieldError, setFieldError] = useState<{ name: string; message: string }>();

  const specs = FIELDS[actionType] ?? [];

  async function submit() {
    setFailure(undefined);
    setFieldError(undefined);

    const fields: Record<string, unknown> = {};
    for (const spec of specs) {
      const raw = (values[spec.name] ?? '').trim();
      if (raw === '') {
        if (spec.required) {
          setFieldError({ name: spec.name, message: `${spec.label} is required.` });
          return;
        }
        continue;
      }
      if (spec.kind === 'amount') {
        const minor = toMinorUnits(raw);
        if (minor === null || minor <= 0) {
          setFieldError({ name: spec.name, message: 'Enter an amount such as 25000.00' });
          return;
        }
        fields[spec.name] = minor;
      } else {
        fields[spec.name] = raw;
      }
    }

    if (!approverUserId) {
      setFailure('Choose who has to approve this.');
      return;
    }

    setPending(true);
    try {
      await onSubmit({
        organizationId,
        assignedApproverUserId: approverUserId,
        actionType,
        expiresInMinutes,
        fields,
        source: context,
      });
      await onCreated();
    } catch (error) {
      setFailure(
        error instanceof ExtensionApiError ? error.message : 'Could not create the request.',
      );
      setPending(false);
    }
  }

  if (approvers.length === 0) {
    return (
      <div>
        <Banner tone="warning">
          Nobody in your organization can approve requests yet. An administrator needs to give
          someone the Approver role, and that person needs to register a passkey.
        </Banner>
        <Button variant="ghost" className="mt-3 w-full" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  const selected = approvers.find((approver) => approver.userId === approverUserId);

  return (
    <div className="space-y-3">
      {failure ? <Banner tone="danger">{failure}</Banner> : null}

      <Banner tone="warning">
        Type these from the invoice or contract, not from the email. The email is what you are
        checking, so it cannot be the source of the details.
      </Banner>

      <Field label="What is being requested?" htmlFor="actionType">
        <Select
          id="actionType"
          value={actionType}
          onChange={(event) => {
            setActionType(event.target.value);
            setValues({ currency: 'USD' });
          }}
        >
          {available.map((type) => (
            <option key={type} value={type}>
              {LABELS[type] ?? type}
            </option>
          ))}
        </Select>
      </Field>

      {specs.map((spec) => (
        <Field
          key={spec.name}
          label={spec.required ? spec.label : `${spec.label} (optional)`}
          htmlFor={`field-${spec.name}`}
          error={fieldError?.name === spec.name ? fieldError.message : undefined}
        >
          <Input
            id={`field-${spec.name}`}
            type={spec.kind === 'date' ? 'date' : 'text'}
            inputMode={
              spec.kind === 'amount' ? 'decimal' : spec.kind === 'lastFour' ? 'numeric' : undefined
            }
            maxLength={spec.kind === 'lastFour' ? 4 : spec.kind === 'currency' ? 3 : 300}
            placeholder={spec.placeholder}
            value={values[spec.name] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [spec.name]: event.target.value }))
            }
          />
        </Field>
      ))}

      <Field
        label="Who must approve?"
        htmlFor="approver"
        hint={
          selected && !selected.hasEnrolledPasskey
            ? 'This person has no passkey yet, so they cannot approve anything.'
            : undefined
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
              {approver.hasEnrolledPasskey ? '' : ' — no passkey'}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Expires after" htmlFor="expiry">
        <Select
          id="expiry"
          value={expiresInMinutes}
          onChange={(event) => setExpiresInMinutes(Number(event.target.value))}
        >
          {EXPIRY_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="rounded-md bg-slate-100 p-3">
        <p className="text-[11px] font-medium text-slate-700">What gets sent to Verity</p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
          <li>The details you typed above.</li>
          <li>This message&apos;s ID, thread ID, sender address and subject.</li>
          <li className="font-medium">Not the message body, and not any attachment.</li>
        </ul>
      </div>

      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={pending} onClick={() => void submit()}>
          {pending ? 'Sending…' : 'Send for approval'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
