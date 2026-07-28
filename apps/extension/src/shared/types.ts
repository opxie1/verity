/**
 * Metadata captured from an open Gmail message (PRD 14.3 step 3).
 *
 * This is the complete list of what the extension is allowed to read. The
 * message body is deliberately absent: Verity does not ingest email content,
 * and a request is built from details the person types from the source
 * document, not from the message (PRD NFR-002).
 */
export interface GmailMessageContext {
  messageId: string | null;
  threadId: string | null;
  senderEmail: string | null;
  subject: string | null;
  url: string;
  capturedAt: string;
}

export interface ExtensionSession {
  signedIn: boolean;
  user: { id: string; email: string; displayName: string | null } | null;
  organizations: {
    organizationId: string;
    name: string;
    slug: string;
    role: string;
    canCreateRequests: boolean;
  }[];
  enabledActionTypes: string[];
}

export interface ThreadRequestSummary {
  id: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELED' | 'REVOKED';
  actionType: string;
  displayTitle: string;
  displaySummary: string;
  approverName: string;
  requesterName: string;
  createdAt: string;
  expiresAt: string;
  receiptId: string | null;
  deniedReason: string | null;
}

/** Messages exchanged between the content script, background worker and panel. */
export type ExtensionMessage =
  | { kind: 'GMAIL_CONTEXT_CHANGED'; context: GmailMessageContext }
  | { kind: 'REQUEST_GMAIL_CONTEXT' }
  | { kind: 'GMAIL_CONTEXT_RESULT'; context: GmailMessageContext | null };
