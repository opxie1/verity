'use client';

import { Button } from '@verity/ui';
import { useState } from 'react';

export function CopyVerificationLink({ receiptId }: { receiptId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/receipts/${receiptId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard access can be refused; the address bar already shows the URL.
      setCopied(false);
    }
  }

  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        {copied ? 'Link copied' : 'Copy verification link'}
      </Button>
      <p className="mt-1 text-xs text-slate-500">
        Anyone you share this with still has to sign in to your organization to open it. The link is
        not a secret and grants nothing on its own.
      </p>
    </div>
  );
}
