import type { ExtensionMessage, GmailMessageContext } from '../shared/types';

/**
 * Reads identifying metadata from the Gmail message currently on screen.
 *
 * Scope is the point of this file. It reads a handful of attributes and the
 * visible subject line, and never touches the message body. Gmail's markup is
 * not a stable API, so every lookup is allowed to fail and returns null rather
 * than guessing (PRD 14.3, NFR-002).
 */

function firstAttribute(selector: string, attribute: string): string | null {
  const element = document.querySelector(selector);
  const value = element?.getAttribute(attribute);
  return value && value.length > 0 ? value : null;
}

function readSenderEmail(): string | null {
  // Gmail marks sender chips with an `email` attribute. The last open message
  // in a thread is the one on screen.
  const chips = document.querySelectorAll<HTMLElement>('span[email]');
  const last = chips[chips.length - 1];
  const email = last?.getAttribute('email')?.trim().toLowerCase() ?? null;
  return email && email.includes('@') ? email : null;
}

function readSubject(): string | null {
  const heading =
    document.querySelector<HTMLElement>('h2[data-thread-perm-id]') ??
    document.querySelector<HTMLElement>('h2.hP');
  const text = heading?.textContent?.trim() ?? '';
  // Bounded, so an unusual page cannot push an unbounded string through the
  // messaging channel.
  return text.length > 0 ? text.slice(0, 500) : null;
}

export function captureContext(): GmailMessageContext {
  return {
    messageId: firstAttribute('[data-legacy-message-id]', 'data-legacy-message-id'),
    threadId:
      firstAttribute('[data-legacy-thread-id]', 'data-legacy-thread-id') ??
      firstAttribute('h2[data-thread-perm-id]', 'data-thread-perm-id'),
    senderEmail: readSenderEmail(),
    subject: readSubject(),
    url: window.location.href.slice(0, 2000),
    capturedAt: new Date().toISOString(),
  };
}

let lastSerialized = '';

function publishIfChanged(): void {
  const context = captureContext();
  const serialized = JSON.stringify(context);
  if (serialized === lastSerialized) {
    return;
  }
  lastSerialized = serialized;

  const message: ExtensionMessage = { kind: 'GMAIL_CONTEXT_CHANGED', context };
  // The panel may not be open; a rejected send is expected and not an error.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

// Gmail is a single-page application, so navigation does not reload the page.
// Polling is used rather than a MutationObserver over the whole document,
// because the observer would fire constantly on an active mailbox.
const POLL_INTERVAL_MS = 1000;
window.setInterval(publishIfChanged, POLL_INTERVAL_MS);
publishIfChanged();

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionMessage) => void) => {
    if (message.kind === 'REQUEST_GMAIL_CONTEXT') {
      sendResponse({ kind: 'GMAIL_CONTEXT_RESULT', context: captureContext() });
    }
    return undefined;
  },
);
