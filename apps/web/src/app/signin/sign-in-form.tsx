'use client';

import { Alert, Button, Field, Input } from '@verity/ui';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export function SignInForm({ errorMessage }: { errorMessage?: string }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(errorMessage);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    try {
      await signIn('resend', { email, callbackUrl: '/' });
    } catch {
      setFailure('The sign-in link could not be sent. Try again in a moment.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Field
        label="Work email"
        htmlFor="email"
        hint="We send a link that signs you in. There is no password to remember or to steal."
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />
      </Field>

      <Button type="submit" disabled={pending || email.length === 0} className="w-full">
        {pending ? 'Sending link…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
