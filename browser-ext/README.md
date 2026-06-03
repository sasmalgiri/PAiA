# PAiA browser extension (MV3)

Right-click any selection or page → "Ask PAiA". Talks to the PAiA desktop
app's local API server on 127.0.0.1; no data leaves your machine unless
you've enabled cloud providers in the desktop app.

## Status

MVP. Sideload from disk only. Chrome Web Store submission is planned for
once the pairing flow + popup UX are stable.

## Install (developer / beta)

1. Open the PAiA desktop app → Settings → API server → enable it.
2. Copy the endpoint (e.g. `http://127.0.0.1:8744`) and the API key.
3. In Chrome: `chrome://extensions` → enable Developer mode → "Load
   unpacked" → pick this `browser-ext/` folder.
4. Pin the PAiA icon in your toolbar (puzzle-piece menu).
5. Click the icon → it opens the Options page on first run; paste the
   endpoint + key and click Save & test.

## Use

- **Right-click a selection** → "Ask PAiA: <selection>" → the popup
  opens with the selection pre-filled.
- **Right-click on a page** → "Ask PAiA about this page" → the popup
  opens with the page title + URL pre-filled.
- **Ctrl/⌘+Shift+P** → opens the popup directly with no prefill.
- In the popup: type your question, Ctrl/⌘+Enter or click Send. The
  reply streams inline.

## Privacy

- The extension stores only the endpoint + API key + last-used threadId
  in `chrome.storage.local`.
- Every request goes to `http://127.0.0.1:<port>` only. The
  `host_permissions` in `manifest.json` are limited to loopback.
- The PAiA desktop app's bearer-token auth gates every call. Wrong key =
  immediate 401.
- The extension never sends data to PAiA's servers, AI providers, or any
  third party.

## Files

- `manifest.json` — MV3 manifest
- `background.js` — service worker (context menus, badge)
- `popup.html` / `popup.css` / `popup.js` — toolbar popup UI
- `options.html` / `options.js` — pairing options page
- `icons/` — toolbar icons (16/48/128 — same SVG source as the desktop app)
