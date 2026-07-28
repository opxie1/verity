'use client';

import {
  ORG_ROLE_LABELS,
  type InvitationStatusValue,
  type OrgRoleValue,
} from '@verity/schemas';
import { Alert, Button, EmptyState, StatusBadge } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export interface InvitationRow {
  invitationId: string;
  email: string;
  role: OrgRoleValue;
  status: InvitationStatusValue;
  expiresAt: string;
  createdAt: string;
}

const STATUS_TONE = {
  PENDING: 'pending',
  ACCEPTED: 'approved',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;

const STATUS_LABEL: Record<InvitationStatusValue, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

export function InvitationList({
  organizationId,
  invitations,
}: {
  organizationId: string;
  invitations: InvitationRow[];
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  async function act(invitationId: string, action: 'resend' | 'revoke', email: string) {
    setBusyId(invitationId);
    setFailure(undefined);
    setNotice(undefined);
    try {
      await apiFetch(
        `/api/organizations/${organizationId}/invitations/${invitationId}/${action}`,
        { method: 'POST' },
      );
      setNotice(
        action === 'resend'
          ? `A new invitation link was sent to ${email}. The previous link no longer works.`
          : `The invitation to ${email} was revoked.`,
      );
      router.refresh();
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
      );
    } finally {
      setBusyId(undefined);
    }
  }

  if (invitations.length === 0) {
    return (
      <div className="p-5">
        <EmptyState title="No invitations yet">
          Invite the people who will create and approve requests.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      {failure || notice ? (
        <div className="px-5 pt-4">
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
        </div>
      ) : null}

      <ul>
        {invitations.map((invitation) => (
          <li
            key={invitation.invitationId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm last:border-0"
          >
            <div>
              <div className="font-medium text-slate-900">{invitation.email}</div>
              <div className="text-slate-500">
                {ORG_ROLE_LABELS[invitation.role]} · expires{' '}
                {new Date(invitation.expiresAt).toLocaleString()}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge tone={STATUS_TONE[invitation.status]}>
                {STATUS_LABEL[invitation.status]}
              </StatusBadge>

              {invitation.status === 'PENDING' || invitation.status === 'EXPIRED' ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === invitation.invitationId}
                    onClick={() => void act(invitation.invitationId, 'resend', invitation.email)}
                  >
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === invitation.invitationId}
                    onClick={() => void act(invitation.invitationId, 'revoke', invitation.email)}
                  >
                    Revoke
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
