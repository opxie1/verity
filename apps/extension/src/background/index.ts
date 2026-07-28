import { GMAIL_ORIGIN } from '../shared/config';

/**
 * Opens the side panel when the toolbar icon is clicked, and only on Gmail.
 *
 * The worker holds no session material and makes no API calls. Everything that
 * needs the user's identity happens in the panel against the web application,
 * so there is no long-lived credential here to steal (PRD FR-014, 18.9).
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

async function enablePanelForTab(tabId: number, url: string | undefined): Promise<void> {
  const onGmail = Boolean(url?.startsWith(GMAIL_ORIGIN));
  await chrome.sidePanel.setOptions({
    tabId,
    path: 'sidepanel.html',
    enabled: onGmail,
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    void enablePanelForTab(tabId, tab.url).catch(() => undefined);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => enablePanelForTab(tabId, tab.url))
    .catch(() => undefined);
});
