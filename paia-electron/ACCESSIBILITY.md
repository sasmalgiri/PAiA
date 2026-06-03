# PAiA — Accessibility notes

This document describes the **intended** accessibility contract for
PAiA's UI surfaces and where it's been statically audited. Items
marked **needs verification** still require a human screen-reader pass
(NVDA on Windows, VoiceOver on macOS) before we can claim conformance.

The codebase already targets WCAG 2.1 AA as a baseline; this is a
practical reader's guide for someone testing or contributing.

---

## Keyboard navigation contract

### Ball view
- `Click` or `Enter` on the focused ball → expand to panel
- `Ctrl+Alt+P` (system-wide hotkey) → toggle visibility
- The ball window itself has no focusable elements when collapsed.

### Panel
- `Tab` cycles forward through: persona button → composer → attach → capture → canvas → settings → close.
- `Shift+Tab` reverses.
- `Esc` closes the panel (returns to ball).
- `Ctrl+K` / `⌘K` opens the command palette.
- `Ctrl+,` / `⌘,` opens Settings.
- `?` (when not focused in an input) opens the shortcut help overlay.
- `Enter` in the composer sends; `Shift+Enter` inserts a newline.
- `/` starts a slash command (works at any cursor position because the menu opens on `/`).

### Settings
- `Tab` order: search input → group/tab buttons → tab body controls.
- `Esc` returns to panel.
- Sub-tabs are buttons, not links — they take `Enter` / `Space`.

### Modals (Confirm, Input, Council, Map-reduce, Persona picker, Trial expired, Upgrade prompt, Cloud consent, Voice confirm, MCP approval, Command palette)
- Open → focus moves into the modal.
- `Tab` is **trapped** inside the modal (`useFocusTrap` hook).
- `Esc` closes (cancel semantics for destructive modals).
- On close, focus restores to the element that opened the modal.

### Banners (Escalation prompt, Route chip, Ambient toast, Undo toast, Chat error toast, Tip card)
- **Not** focus-trapped — they're non-blocking notifications.
- Primary action is auto-focused on open (Escalation).
- `Esc` dismisses Escalation and Tip card.
- Toasts dismiss on click or after a timeout.

---

## ARIA roles + landmarks

| Surface | role | aria-modal | label source |
|---|---|---|---|
| Confirm modal | `alertdialog` | true | `aria-labelledby` → `#confirm-modal-title` |
| Input modal | `dialog` | true | `aria-label` |
| Council panel | `dialog` | true | `aria-labelledby` → `#council-panel-title` |
| Map-reduce panel | `dialog` | true | `aria-labelledby` → `#mapreduce-panel-title` |
| Persona picker | `dialog` | true | `aria-label="Select persona"` |
| Command palette | `dialog` | true | `aria-modal` + `aria-activedescendant` |
| MCP approval | `alertdialog` | true | `aria-labelledby` + `aria-describedby` |
| Escalation prompt | `alertdialog` | implicit | `aria-labelledby` → `#escalation-title` |
| Tip card | `status` (non-modal) | — | aria-live polite |
| Chat error toast | `alert` | — | content read on insert |
| Undo toast | `status` | — | aria-live polite |
| Activity bar (chat streaming) | `log` (`<div role="log" aria-live="polite">`) | — | message list narration |
| Route chip | `status` | — | content read on insert |

---

## Live regions

- **Chat message list**: `role="log" aria-live="polite"` — screen readers
  announce streamed tokens as they arrive without interrupting.
- **Council synthesis**: appears inside a `polite` region; per-expert
  answers appear silently below.
- **Map-reduce final answer**: `polite`. The progress bar and per-chunk
  status are visual-only (`role="progressbar"` would over-announce).
- **Tip card**: `role="status" aria-live="polite"`. Auto-dismiss tips
  do not re-announce.
- **Toasts**: undo + route chip use `polite`; chat-error uses `alert`.

---

## Forced-colors / Windows High Contrast

`@media (forced-colors: active)` block in `styles.css` ensures:
- Every button keeps a `1px solid ButtonText` border.
- Accent-bordered cards (Model Store recommended, Council panel,
  Confirm modal, Escalation prompt, Tip card, Route chip) get a
  `2px solid Highlight` border with `forced-color-adjust: none`.
- Tip arrow is hidden in forced-colors (would render in the wrong
  system color otherwise).
- Badges (`accent` / `ok`) re-map to system `Highlight` / `ButtonText`.
- Model Store progress bar keeps a border around the empty track.

**Needs verification**: actual screen-reader announcement of Council
panel and Map-reduce progress in High Contrast mode — the visual
contract is in place but real-world testing was not done.

---

## Reduced motion

`@media (prefers-reduced-motion: reduce)` disables animations on:
- Council backdrop fade
- Confirm modal backdrop fade
- Escalation prompt slide-in
- Route chip slide-in
- Tip card fade
- (Plus all v0.9 animations from the prior pass.)

Streaming token rendering still progresses — it's content, not chrome.

---

## Heading hierarchy

Each major panel scope owns one `<h1>` (typically the panel title);
sub-sections use `<h2>`–`<h4>`. Specific concerns and known gaps:

- **Settings tab body**: each tab is implicitly a section but no `<h1>`.
  Group titles are visual-only. **Consider adding a programmatically-
  associated `<h1>` per tab for screen-reader orientation.**
- **Council panel**: synthesis section header is `<h4>` because the
  panel itself acts as the dialog title. Acceptable for an alertdialog.

---

## Specific component audits

### Sidebar (thread list)
- Threads are buttons (focusable). ✓
- "Detach" affordance is hidden until hover — **needs verification**
  it surfaces on keyboard focus for keyboard-only users.

### Composer
- Textarea has `aria-label` for the message input.
- Attach button is a `<label>` wrapping a hidden `<input type=file>` —
  works with assistive tech, but **verify VoiceOver rotor sees it as
  a button**.
- Capture / mic / send buttons all have `title` + `aria-label`.

### Persona picker
- Search input is auto-focused. ✓
- Category tabs are buttons. Active state uses CSS — **also expose
  via `aria-pressed`** (TODO).
- Cards are buttons; selected card uses `aria-pressed` only via CSS
  class — **add explicit `aria-pressed={active}`** (TODO).

### Model Store
- Recommendation cards are `<article>` elements with `<h4>` titles.
- Install button has a descriptive label including the size (good).
- "Re-probe" has a `title` but no `aria-label` — verify it gets read
  correctly.

---

## Manual verification still required

The static pass above covers the contract. The following items need a
human screen-reader run before we can claim full WCAG 2.1 AA:

1. End-to-end flow: open ball → send first message → switch persona → open Settings → adjust router mode → run a council.
2. Council panel during streaming: synthesis tokens should be announced
   politely, expert columns should not interfere.
3. Long-read map-reduce: progress should not over-announce; final
   answer streamed into a single polite region.
4. Tip cards: anchored positioning + dismissal don't strand keyboard
   focus.
5. Cloud-escalation banner: primary action is announced as an alert.
6. Modal nesting: opening Confirm from within Settings → closing
   restores focus to the originating button.
7. High-Contrast end-to-end: every interactive element remains
   distinguishable from background.

If you find an issue, please open an issue with the screen reader + OS
+ exact steps. Linear tag: `a11y`.

---

## Where to look in code

- `src/renderer/lib/focusTrap.ts` — focus trap hook
- `src/renderer/styles.css` `@media (forced-colors: active)` block
- `src/renderer/styles.css` `@media (prefers-reduced-motion: reduce)` blocks
- `src/renderer/components/*Modal*.tsx` — every modal pattern
- `src/renderer/components/Panel.tsx` — keyboard shortcut handling
