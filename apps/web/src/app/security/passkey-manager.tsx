'use client';

import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import { Alert, Badge, Button, Field, Input } from '@verity/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/client/api-client';

export interface PasskeyRow {
  credentialId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[];
}

/**
 * Turns a WebAuthn failure into something a person can act on.
 *
 * The browser deliberately gives vague errors so that a page cannot probe
 * which authenticators a user has, so these map the few distinguishable cases
 * to concrete next steps rather than restating the error (PRD NFR-005).
 */
function describeWebAuthnError(error: unknown): string {
  if (error instanceof WebAuthnError) {
    switch (error.name) {
      case 'InvalidStateError':
        return 'That device already has a passkey for Verity. Try another device, or use the passkey you already registered.';
      case 'NotAllowedError':
        return 'The request was cancelled or timed out. Try again, and confirm on your device when prompted.';
      case 'AbortError':
        return 'The request was cancelled. Try again when you are ready.';
      default:
        return 'Your device could not complete the request. Try again, or try another device.';
    }
  }
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function PasskeyManager({ initialPasskeys }: { initialPasskeys: PasskeyRow[] }) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  useEffect(() => {
    setPasskeys(initialPasskeys);
  }, [initialPasskeys]);

  async function refresh() {
    const result = await apiFetch<{ passkeys: PasskeyRow[] }>('/api/passkeys');
    setPasskeys(result.passkeys);
    router.refresh();
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(undefined);
    setNotice(undefined);

    try {
      const { options } = await apiFetch<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
        '/api/passkeys/register/options',
        { method: 'POST' },
      );

      const response = await startRegistration({ optionsJSON: options });

      await apiFetch('/api/passkeys/register/verify', {
        method: 'POST',
        body: { label: label.trim(), response },
      });

      setLabel('');
      setNotice('Passkey registered. You can now approve and deny requests.');
      await refresh();
    } catch (error) {
      setFailure(describeWebAuthnError(error));
    } finally {
      setPending(false);
    }
  }

  async function testPasskey() {
    setBusyId('test');
    setFailure(undefined);
    setNotice(undefined);
    try {
      const { options } = await apiFetch<{
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      }>('/api/passkeys/authenticate/options', { method: 'POST' });

      const response = await startAuthentication({ optionsJSON: options });

      const result = await apiFetch<{ credential: { label: string } }>(
        '/api/passkeys/authenticate/verify',
        { method: 'POST', body: response },
      );

      setNotice(`Verified with "${result.credential.label}". That passkey works.`);
      await refresh();
    } catch (error) {
      setFailure(describeWebAuthnError(error));
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(credentialId: string, credentialLabel: string) {
    setBusyId(credentialId);
    setFailure(undefined);
    setNotice(undefined);
    try {
      await apiFetch(`/api/passkeys/${credentialId}`, { method: 'DELETE' });
      setNotice(`Removed "${credentialLabel}".`);
      await refresh();
    } catch (error) {
      setFailure(describeWebAuthnError(error));
    } finally {
      setBusyId(undefined);
    }
  }

  if (!supported) {
    return (
      <Alert tone="danger" title="This browser does not support passkeys">
        Use a current version of Chrome, Edge, Safari or Firefox on a device with a screen lock, or
        a security key.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {passkeys.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {passkeys.map((passkey) => (
            <li
              key={passkey.credentialId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="text-sm">
                <div className="font-medium text-slate-900">
                  {passkey.label}
                  {passkey.backedUp ? (
                    <Badge className="ml-2">Synced across your devices</Badge>
                  ) : (
                    <Badge className="ml-2">This device only</Badge>
                  )}
                </div>
                <div className="text-slate-500">
                  Added {new Date(passkey.createdAt).toLocaleDateString()} ·{' '}
                  {passkey.lastUsedAt
                    ? `last used ${new Date(passkey.lastUsedAt).toLocaleString()}`
                    : 'never used'}
                </div>
              </div>

              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === passkey.credentialId}
                onClick={() => void remove(passkey.credentialId, passkey.label)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">You have not registered a passkey yet.</p>
      )}

      {passkeys.length > 0 ? (
        <Button variant="secondary" size="sm" disabled={busyId === 'test'} onClick={() => void testPasskey()}>
          {busyId === 'test' ? 'Waiting for your device…' : 'Check that a passkey works'}
        </Button>
      ) : null}

      <form onSubmit={register} className="space-y-4 border-t border-slate-200 pt-6">
        <Field
          label="Name this passkey"
          htmlFor="passkey-label"
          hint="Something you will recognise later, such as Work laptop, iPhone, or YubiKey."
        >
          <Input
            id="passkey-label"
            required
            maxLength={60}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Work laptop"
          />
        </Field>

        <Button type="submit" disabled={pending || label.trim().length === 0}>
          {pending ? 'Waiting for your device…' : 'Register a passkey'}
        </Button>
      </form>
    </div>
  );
}
