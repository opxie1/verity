'use client';

import {
  ORG_ROLE_LABELS,
  type MemberStatusValue,
  type OrgRoleValue,
} from '@verity/schemas';
import { Alert, Badge, Button, Select } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export interface MemberRow {
  memberId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: OrgRoleValue;
  status: MemberStatusValue;
  passkeyCount: number;
  hasEnrolledPasskey: boolean;
  joinedAt: string;
}

const ROLES: OrgRoleValue[] = ['ORG_ADMIN', 'REQUESTER', 'APPROVER', 'AUDITOR'];

export function MemberList({
  organizationId,
  currentUserId,
  members,
}: {
  organizationId: string;
  currentUserId: string;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string>();
  const [busyMemberId, setBusyMemberId] = useState<string>();

  async function mutate(memberId: string, body: Record<string, unknown>) {
    setBusyMemberId(memberId);
    setFailure(undefined);
    try {
      await apiFetch(`/api/organizations/${organizationId}/members/${memberId}`, {
        method: 'PATCH',
        body,
      });
      router.refresh();
    } catch (error) {
      setFailure(
        error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
      );
    } finally {
      setBusyMemberId(undefined);
    }
  }

  return (
    <div>
      {failure ? (
        <div className="px-5 pt-4">
          <Alert tone="danger">{failure}</Alert>
        </div>
      ) : null}

      <table className="w-full text-sm">
        <caption className="sr-only">Organization members, their roles and passkey status</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-5 py-2 font-medium">
              Member
            </th>
            <th scope="col" className="px-5 py-2 font-medium">
              Role
            </th>
            <th scope="col" className="px-5 py-2 font-medium">
              Passkey
            </th>
            <th scope="col" className="px-5 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const busy = busyMemberId === member.memberId;
            return (
              <tr key={member.memberId} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">
                    {member.displayName ?? member.email}
                    {isSelf ? <span className="ml-2 text-xs text-slate-500">(you)</span> : null}
                  </div>
                  <div className="text-slate-500">{member.email}</div>
                  {member.status === 'DISABLED' ? (
                    <Badge className="mt-1 bg-red-100 text-red-900 ring-red-200">Disabled</Badge>
                  ) : null}
                </td>

                <td className="px-5 py-3">
                  <Select
                    aria-label={`Role for ${member.displayName ?? member.email}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void mutate(member.memberId, { role: event.target.value as OrgRoleValue })
                    }
                    className="w-40"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ORG_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                </td>

                <td className="px-5 py-3">
                  {member.hasEnrolledPasskey ? (
                    <span className="text-slate-700">
                      {member.passkeyCount} registered
                      {member.passkeyCount === 1 ? (
                        <span className="block text-xs text-amber-700">No backup passkey</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-amber-800">None — cannot approve</span>
                  )}
                </td>

                <td className="px-5 py-3 text-right">
                  <Button
                    size="sm"
                    variant={member.status === 'ACTIVE' ? 'secondary' : 'primary'}
                    disabled={busy}
                    onClick={() =>
                      void mutate(member.memberId, {
                        status: member.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                  >
                    {member.status === 'ACTIVE' ? 'Disable' : 'Reactivate'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
        Disabling a member blocks their next request immediately, including any approval they were
        part-way through. It does not remove records they already created.
      </p>
    </div>
  );
}
