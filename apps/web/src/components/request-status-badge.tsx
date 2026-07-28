import { REQUEST_STATUS_LABELS, type RequestStatusValue } from '@verity/schemas';
import { StatusBadge } from '@verity/ui';

const TONES = {
  DRAFT: 'neutral',
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  EXPIRED: 'expired',
  CANCELED: 'expired',
  REVOKED: 'revoked',
} as const;

export function RequestStatusBadge({ status }: { status: RequestStatusValue }) {
  return <StatusBadge tone={TONES[status]}>{REQUEST_STATUS_LABELS[status]}</StatusBadge>;
}
