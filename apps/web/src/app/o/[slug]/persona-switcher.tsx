'use client';

import { Button } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Lets a demo visitor move between the two people in their sandbox.
 *
 * Deliberately prominent. The single most common way a demo of this product
 * fails is the viewer not registering that the person approving is a
 * different person from the one who asked — which is the entire idea.
 */
export function PersonaSwitcher({
  current,
  otherName,
  otherRole,
}: {
  current: 'requester' | 'approver';
  otherName: string;
  otherRole: 'requester' | 'approver';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchTo() {
    setPending(true);
    try {
      const response = await fetch('/api/demo/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: otherRole }),
      });
      if (!response.ok) throw new Error('failed');
      const result = (await response.json()) as { organizationSlug: string };
      router.push(`/o/${result.organizationSlug}`);
      router.refresh();
    } catch {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
        <p className="text-sm text-amber-900">
          <span className="font-semibold">Demo.</span> You are acting as the{' '}
          <strong>{current === 'requester' ? 'finance manager' : 'chief executive'}</strong>.{' '}
          {current === 'requester'
            ? 'Create a request, then switch to Jane to decide it.'
            : 'Approve or deny with your passkey, then switch back to see the receipt.'}
        </p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void switchTo()}>
          {pending ? 'Switching…' : `Switch to ${otherName}`}
        </Button>
      </div>
    </div>
  );
}
