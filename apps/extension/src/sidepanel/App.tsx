import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExtensionApiError,
  createRequest,
  getApprovers,
  getSession,
  getThreadRequests,
  webAppUrl,
} from '../shared/api';
import type {
  ExtensionMessage,
  ExtensionSession,
  GmailMessageContext,
  ThreadRequestSummary,
} from '../shared/types';
import { DraftForm } from './draft-form';
import { RequestCard } from './request-card';
import { Banner, Button, Spinner } from './ui';

type Screen = 'loading' | 'signed-out' | 'no-message' | 'list' | 'draft';

export function App() {
  const [session, setSession] = useState<ExtensionSession>();
  const [context, setContext] = useState<GmailMessageContext | null>(null);
  const [requests, setRequests] = useState<ThreadRequestSummary[]>([]);
  const [approvers, setApprovers] = useState<
    { userId: string; email: string; displayName: string | null; hasEnrolledPasskey: boolean }[]
  >([]);
  const [screen, setScreen] = useState<Screen>('loading');
  const [failure, setFailure] = useState<string>();
  const [drafting, setDrafting] = useState(false);

  const organization = useMemo(
    () => session?.organizations.find((entry) => entry.canCreateRequests) ?? session?.organizations[0],
    [session],
  );

  /** Asks the Gmail tab what is on screen right now. */
  const refreshContext = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://mail.google.com')) {
      setContext(null);
      return;
    }
    try {
      const response = (await chrome.tabs.sendMessage(tab.id, {
        kind: 'REQUEST_GMAIL_CONTEXT',
      } satisfies ExtensionMessage)) as ExtensionMessage;
      setContext(response.kind === 'GMAIL_CONTEXT_RESULT' ? response.context : null);
    } catch {
      // The content script may not have loaded yet on a freshly opened tab.
      setContext(null);
    }
  }, []);

  const refreshRequests = useCallback(async () => {
    if (!organization || !context?.threadId) {
      setRequests([]);
      return;
    }
    try {
      const result = await getThreadRequests(organization.organizationId, context.threadId);
      setRequests(result.requests);
    } catch (error) {
      if (error instanceof ExtensionApiError && error.code === 'UNAUTHENTICATED') {
        setScreen('signed-out');
        return;
      }
      setFailure(error instanceof Error ? error.message : 'Could not load requests.');
    }
  }, [organization, context?.threadId]);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await getSession();
        setSession(loaded);
        if (!loaded.signedIn) {
          setScreen('signed-out');
          return;
        }
        await refreshContext();
      } catch (error) {
        if (error instanceof ExtensionApiError && error.code === 'UNAUTHENTICATED') {
          setScreen('signed-out');
        } else {
          setFailure('Verity could not be reached. Check that it is running.');
          setScreen('signed-out');
        }
      }
    })();
  }, [refreshContext]);

  useEffect(() => {
    if (!session?.signedIn) return;
    setScreen(context?.threadId ? 'list' : 'no-message');
    void refreshRequests();
  }, [session, context, refreshRequests]);

  // The content script announces navigation, so the panel follows along as the
  // user moves between messages.
  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.kind === 'GMAIL_CONTEXT_CHANGED') {
        setContext(message.context);
        setDrafting(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!drafting || !organization) return;
    void getApprovers(organization.organizationId)
      .then((result) => setApprovers(result.approvers))
      .catch(() => setApprovers([]));
  }, [drafting, organization]);

  if (screen === 'loading') {
    return (
      <Shell>
        <Spinner label="Checking your Verity session" />
      </Shell>
    );
  }

  if (screen === 'signed-out' || !session?.signedIn) {
    return (
      <Shell>
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
        <p className="text-sm text-slate-600">
          Sign in to Verity to require verified approval for the requests you receive here.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={() => void chrome.tabs.create({ url: webAppUrl('/signin') })}
        >
          Open Verity to sign in
        </Button>
        <p className="mt-3 text-xs text-slate-500">
          The extension holds no password and no key of its own. It uses the session in this
          browser, and everything consequential happens on the Verity page.
        </p>
      </Shell>
    );
  }

  if (!organization) {
    return (
      <Shell>
        <Banner tone="warning">
          Your account is not in an organization yet. Create or join one in Verity first.
        </Banner>
        <Button
          className="mt-4 w-full"
          onClick={() => void chrome.tabs.create({ url: webAppUrl('/') })}
        >
          Open Verity
        </Button>
      </Shell>
    );
  }

  if (screen === 'no-message') {
    return (
      <Shell organizationName={organization.name}>
        <p className="text-sm text-slate-600">
          Open a message to require verified approval for what it asks for.
        </p>
      </Shell>
    );
  }

  if (drafting && context) {
    return (
      <Shell organizationName={organization.name}>
        <DraftForm
          organizationId={organization.organizationId}
          approvers={approvers}
          enabledActionTypes={session.enabledActionTypes}
          context={context}
          onCancel={() => setDrafting(false)}
          onCreated={async () => {
            setDrafting(false);
            await refreshRequests();
          }}
          onSubmit={createRequest}
        />
      </Shell>
    );
  }

  return (
    <Shell organizationName={organization.name}>
      {failure ? <Banner tone="danger">{failure}</Banner> : null}

      {context?.senderEmail ? (
        <p className="mb-3 truncate text-xs text-slate-500" title={context.senderEmail}>
          Viewing a message from {context.senderEmail}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <>
          <p className="text-sm text-slate-700">
            Nothing in this thread has been verified.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            If this message asks for a payment, a change of bank details, or anything else
            consequential, ask the person who supposedly sent it to confirm the exact details with
            their passkey.
          </p>
          {organization.canCreateRequests ? (
            <Button className="mt-4 w-full" onClick={() => setDrafting(true)}>
              Require verified approval
            </Button>
          ) : (
            <Banner tone="warning" className="mt-4">
              Your role does not allow creating requests.
            </Banner>
          )}
        </>
      ) : (
        <>
          <ul className="space-y-3">
            {requests.map((request) => (
              <li key={request.id}>
                <RequestCard
                  request={request}
                  organizationId={organization.organizationId}
                  onChanged={refreshRequests}
                />
              </li>
            ))}
          </ul>
          {organization.canCreateRequests ? (
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setDrafting(true)}>
              Create another request
            </Button>
          ) : null}
        </>
      )}
    </Shell>
  );
}

function Shell({
  children,
  organizationName,
}: {
  children: React.ReactNode;
  organizationName?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-semibold tracking-wide text-slate-500">VERITY</p>
        {organizationName ? (
          <p className="truncate text-sm font-medium text-slate-900">{organizationName}</p>
        ) : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
      <footer className="border-t border-slate-200 px-4 py-2">
        <p className="text-[11px] leading-snug text-slate-500">
          Verity records who authorized an action. It does not move money and never reads your
          messages.
        </p>
      </footer>
    </div>
  );
}
