'use client';

import { Alert, Button } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DemoEntry() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  async function start() {
    setPending(true);
    setFailure(undefined);
    try {
      const response = await fetch('/api/demo/start', { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as
        | { organizationSlug?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `The server answered ${response.status}.`);
      }
      if (!payload?.organizationSlug) {
        throw new Error('The server did not return a sandbox.');
      }

      router.push(`/o/${payload.organizationSlug}`);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The demo could not be started.');
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Button size="lg" className="w-full" disabled={pending} onClick={() => void start()}>
        {pending ? 'Setting up your sandbox…' : 'Open the demo'}
      </Button>

      <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">You will be two people</p>
        <p className="mt-1">
          Verity only means something when one person asks and a different person confirms. So you
          get a private company with both: <strong>Alex</strong> in finance, who receives a
          suspicious payment request, and <strong>Jane</strong>, the chief executive it claims to be
          from. You can switch between them at any time.
        </p>
        <p className="mt-2">
          Nothing is shared with other visitors, and no email is involved.
        </p>
      </div>

      <p className="text-xs text-slate-500">
        You will be asked for a passkey when you approve as Jane — your fingerprint, face or device
        PIN. That part is real, not simulated: it is the whole point of the product. Your device
        keeps the key and Verity never sees your biometrics.
      </p>
    </div>
  );
}
