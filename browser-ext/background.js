// PAiA browser extension — background service worker (MV3).
//
// Registers a context menu on text selections and on the page itself.
// On click, opens the popup with the selection (or current page URL +
// title) pre-filled.
//
// Routing model:
//   contextMenu click → store the prefill in chrome.storage.session →
//   open the popup → popup reads the prefill and sends it to PAiA.
//
// We do NOT auto-send on context-menu click — the user explicitly
// confirms in the popup. Reduces accidental leaks of sensitive
// selections.

const MENU_SELECTION = 'paia-ask-selection';
const MENU_PAGE = 'paia-ask-page';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION,
    title: 'Ask PAiA: "%s"',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: MENU_PAGE,
    title: 'Ask PAiA about this page',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let prefill = '';
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    prefill = info.selectionText;
  } else if (info.menuItemId === MENU_PAGE) {
    const title = tab?.title ?? '';
    const url = tab?.url ?? '';
    prefill = `Page: ${title}\nURL: ${url}\n\nQuestion: `;
  }
  if (prefill) {
    await chrome.storage.session.set({ paiaPrefill: prefill });
    // Open the action popup. MV3 doesn't expose chrome.action.openPopup
    // reliably across browsers, so we set a badge to nudge the user to
    // click — and in supporting browsers, try the API directly.
    try {
      // @ts-ignore — chrome.action.openPopup is Chrome 127+
      if (chrome.action && typeof chrome.action.openPopup === 'function') {
        await chrome.action.openPopup();
      } else {
        chrome.action.setBadgeText({ text: '•' });
        chrome.action.setBadgeBackgroundColor({ color: '#5b9dd9' });
      }
    } catch {
      chrome.action.setBadgeText({ text: '•' });
      chrome.action.setBadgeBackgroundColor({ color: '#5b9dd9' });
    }
  }
});

// Clear the badge whenever the popup opens (signalled by the popup
// sending a "popup-opened" message).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.kind === 'popup-opened') {
    chrome.action.setBadgeText({ text: '' });
  }
});
