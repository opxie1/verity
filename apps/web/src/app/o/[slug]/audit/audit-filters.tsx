'use client';

import type { AuditEventTypeValue } from '@verity/schemas';
import { Select } from '@verity/ui';
import { useRouter } from 'next/navigation';

const FILTERS: { value: AuditEventTypeValue | ''; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'REQUEST_APPROVED', label: 'Approvals' },
  { value: 'REQUEST_DENIED', label: 'Denials' },
  { value: 'APPROVAL_REVOKED', label: 'Revocations' },
  { value: 'FAILED_APPROVAL_ATTEMPT', label: 'Failed decision attempts' },
  { value: 'AUTHORIZATION_FAILURE', label: 'Refused access' },
  { value: 'ROLE_CHANGED', label: 'Role changes' },
  { value: 'USER_DISABLED', label: 'Members disabled' },
  { value: 'PASSKEY_REMOVED', label: 'Passkeys removed' },
  { value: 'RECEIPT_VIEWED', label: 'Receipt views' },
];

export function AuditFilters({
  slug,
  selected,
}: {
  slug: string;
  selected?: AuditEventTypeValue;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="audit-filter" className="text-sm font-medium text-slate-700">
        Show
      </label>
      <Select
        id="audit-filter"
        className="w-64"
        value={selected ?? ''}
        onChange={(event) => {
          const value = event.target.value;
          // Paging resets when the filter changes, so a stale cursor from the
          // previous filter cannot be carried over.
          router.push(value ? `/o/${slug}/audit?eventType=${value}` : `/o/${slug}/audit`);
        }}
      >
        {FILTERS.map((filter) => (
          <option key={filter.value} value={filter.value}>
            {filter.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
