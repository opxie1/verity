import { API_BASE_URL } from './config';
import type { ExtensionSession, GmailMessageContext, ThreadRequestSummary } from './types';

export class ExtensionApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ExtensionApiError';
  }
}

/**
 * Calls the Verity API using the browser's existing session cookie.
 *
 * The extension stores no token of its own. If the user is not signed in to
 * the web application, calls fail with UNAUTHENTICATED and the panel offers to
 * open it — which is also what makes the extension useless to anyone who
 * installs it without an account (PRD FR-014).
 */
async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    credentials: 'include',
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string } } | null)?.error;
    throw new ExtensionApiError(
      error?.message ?? 'Verity could not be reached.',
      error?.code ?? 'INTERNAL_ERROR',
      response.status,
    );
  }

  return payload as T;
}

export function getSession(): Promise<ExtensionSession> {
  return call<ExtensionSession>('/api/extension/session');
}

export function getThreadRequests(
  organizationId: string,
  threadId: string,
): Promise<{ requests: ThreadRequestSummary[] }> {
  return call(
    `/api/extension/threads/${encodeURIComponent(threadId)}/requests?organizationId=${encodeURIComponent(organizationId)}`,
  );
}

export function getRequestStatus(
  organizationId: string,
  requestId: string,
): Promise<ThreadRequestSummary> {
  return call(
    `/api/extension/requests/${encodeURIComponent(requestId)}/status?organizationId=${encodeURIComponent(organizationId)}`,
  );
}

export function createRequest(input: {
  organizationId: string;
  assignedApproverUserId: string;
  actionType: string;
  expiresInMinutes: number;
  fields: Record<string, unknown>;
  source: GmailMessageContext;
}): Promise<{ request: { id: string; displaySummary: string } }> {
  return call('/api/extension/requests', {
    method: 'POST',
    body: {
      organizationId: input.organizationId,
      assignedApproverUserId: input.assignedApproverUserId,
      actionType: input.actionType,
      expiresInMinutes: input.expiresInMinutes,
      fields: input.fields,
      source: {
        type: 'GMAIL',
        messageId: input.source.messageId ?? undefined,
        threadId: input.source.threadId ?? undefined,
        senderEmail: input.source.senderEmail ?? undefined,
        subject: input.source.subject ?? undefined,
        // Gmail URLs are https; anything else is dropped rather than stored.
        url: input.source.url.startsWith('https://') ? input.source.url : undefined,
      },
    },
  });
}

export function getApprovers(
  organizationId: string,
): Promise<{ approvers: { userId: string; email: string; displayName: string | null; hasEnrolledPasskey: boolean }[] }> {
  return call(`/api/extension/approvers?organizationId=${encodeURIComponent(organizationId)}`);
}

export function cancelRequest(
  organizationId: string,
  requestId: string,
  reason?: string,
): Promise<{ request: { id: string; status: string } }> {
  return call(`/api/extension/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    body: { organizationId, ...(reason ? { reason } : {}) },
  });
}

export function webAppUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
