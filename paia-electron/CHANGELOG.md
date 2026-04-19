# PAiA changelog

All notable changes to PAiA will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and this project loosely follows [Semantic Versioning](https://semver.org/).

---

## v0.4.0 — 2026-04-19

The "agentic" release. PAiA stops being "a chat window with extras" and becomes
an assistant that can plan, use tools, iterate, and take durable action on your
machine — with a strict per-action approval gate that matches the privacy posture.

### Added

**Agent orchestrator** (new `src/main/agent.ts`, `src/main/tools.ts`)
- Multi-step plan → act → observe loop driven by the selected LLM
- Built-in tool registry covering every major surface the app already exposes:
  `web.search`, `web.fetch`, `fs.read`, `fs.write`, `fs.list`, `shell.exec`,
  `screen.capture`, `screen.ocr`, `clipboard.read`, `clipboard.write`,
  `window.active`, `window.openUrl`, `rag.query`, `memory.save`, `memory.recall`,
  `artifact.create`, `artifact.update`
- MCP tools and connector tools fold in automatically — same approval flow
- Three autonomy tiers (`manual`, `assisted`, `autonomous`) that gate auto-approval
  by tool risk (`safe` / `low` / `medium` / `high`)
- Configurable step budget, FS allow-list, shell enable/disable
- Every step (plan / thought / tool call / final / error) persisted in `agent_steps`
  so the UI can reconstruct the trace on reload
- Live renderer panel (`AgentPanel.tsx`) streams each step, shows tool args +
  results, exposes an abort button and inline approval prompts
- New slash command: `/agent <goal>`

**Deep Research pipeline** (new `src/main/research.ts`, `ResearchPanel.tsx`)
- Query decomposition → multi-pass web search → page fetching → cited synthesis
- Tunable depth (1–3) and max-source count from Settings → Research
- Streaming progress events and token-by-token report rendering
- Run history persisted in `research_runs`
- New slash command: `/research <question>`

**Canvas / artifacts** (new `src/main/artifacts.ts`, `Canvas.tsx`)
- Versioned artifact store — code, markdown, html, svg, json
- Side panel with list + editor/preview, `Copy` / `Edit` / `Delete` / `+ New`
- HTML and SVG artifacts render inside a `sandbox=""` iframe
- Agent tools `artifact.create` / `artifact.update` so the model can iterate
- New slash command: `/canvas`; `🎨` button in panel header

**Cross-session memory** (new `src/main/memory.ts`, Settings → Memory tab)
- Four scopes: `user`, `preference`, `fact`, `episode`
- Auto-embedded on save via `nomic-embed-text` when Ollama is reachable;
  graceful fallback to LIKE search when not
- Pinned + user + preference entries automatically injected into every chat
- Semantic recall for `fact` / `episode` scopes based on the current user message
- New slash commands: `/remember <text>`, `/recall <query>`

**Connectors** (new `src/main/connectors/`)
- OAuth 2.0 + PKCE loopback flow (`oauth.ts`) — tokens never proxy through a
  third party, callback server is short-lived, state + verifier verified per run
- Five integrations: Gmail, Google Calendar, Google Drive, GitHub, Slack
- Tokens persisted in sqlite; automatic refresh 60s before expiry
- Per-service tool handlers auto-register with the agent once connected
- Settings → Connectors tab for client-ID config + connect / disconnect

**Scheduler** (new `src/main/scheduler.ts`)
- Three trigger kinds: cron (5-field subset with `*`, `*/N`, `a,b,c`, `a-b`),
  every-N-minutes interval, one-shot at a specific time
- Three action kinds: agent run, research run, or plain prompt
- Results land in a `Scheduled: <name>` thread so they don't pollute active conversations
- One-minute tick resolution
- Settings → Schedule tab for listing / creating / pausing / deleting / running-now

**Chat pipeline**
- Every user message now pulls relevant long-term memory and injects it ahead of
  the persona prompt (alongside the existing RAG + active-window context blocks)

### Changed

- `FeatureFlag` union gained `agent`, `deep-research`, `canvas`, `memory`,
  `connectors`, `scheduler`
- Database schema extended with seven new tables:
  `artifacts`, `artifact_versions`, `memory`, `agent_runs`, `agent_steps`,
  `research_runs`, `scheduled_tasks`, `connector_tokens`
- Settings extended with Agent / Research / Memory controls; all default to
  conservative values (assisted autonomy, fs on, shell off)
- `extractReadableText` extracted to `src/shared/html.ts` for reuse across
  agent + research paths and for unit-testing without Electron
- Cron parser extracted to `src/shared/cron.ts` for the same reason

### Tests

- 9 new unit tests (HTML extractor, cron parser) — total 57 tests

**Classroom / lab-control mode** (new `src/main/classroom.ts`, `src/renderer/components/Classroom.tsx`)
- Two roles: **teacher** (runs a LAN HTTP server with a 6-letter join code) and **student** (polls heartbeats + receives policy commands)
- Signed packets: PBKDF2-derived HMAC-SHA256 keys; join packets use a code-only key, heartbeats switch to a per-session key
- Teacher dashboard: live roster (online / offline / flags), scrolling activity feed, broadcast message bar, "end for all"
- Student lock: full-screen non-dismissible overlay showing the current policy, the student's active window, "on task" / "off task" state, and any incoming teacher messages
- Policy knobs: session title + duration, allowed apps, allowed URLs, blocked URLs, agent/shell/fs/web/cloud toggles, panel lock, heartbeat interval
- Agent integration: classroom policy is consulted at run-start and before every tool call; denied tools emit a `tool-denied` activity event to the teacher
- Cloud-provider integration: `providers.chat()` rejects cloud calls when the active classroom policy disallows them, even if the user has their own API key enabled
- Known limit (honestly surfaced in the UI): we cannot *prevent* a student from closing PAiA or from using a blocked app — we detect and report. True enforcement needs an OS-level / MDM install.

### Added IPC

- `paia:classroom-state`, `paia:classroom-default-policy`, `paia:classroom-start-teacher`, `paia:classroom-stop-teacher`, `paia:classroom-end-for-all`, `paia:classroom-broadcast`, `paia:classroom-join`, `paia:classroom-leave`
- Events: `paia:classroom-state`, `paia:classroom-activity`, `paia:classroom-message`

---

## v0.11.3 — 2026-04-19 (UX pass)

A focused UX audit pass targeted at first-time users and daily drivers. Biggest single win: the 24-tab Settings panel was genuinely unusable at 480px width; it's now grouped + searchable.

### Added

**Grouped + searchable Settings** (`Settings.tsx`)
- The 24 flat tabs are now organised into six meaningful groups: Basics, AI & chat, Power features, Network & devices, Classroom / lab, Account. Each group has an emoji + label and is collapsible visually.
- Live keyword search — typing `"gmail"`, `"cron"`, `"shortcut"`, or `"passphrase"` jumps straight to the matching tab without knowing its name. Matching extends to tab id, label, and a hand-curated keyword list per tab.
- Active-tab gets a proper accent-highlighted pill, not a bottom-border.
- Empty search state shows a friendly "No settings match" message.

**Reusable `InputModal` component** (`InputModal.tsx`)
- Replaces every `window.prompt()` call. Properly styled, focus-trapped (ESC to cancel), supports Enter to submit (Ctrl/⌘+Enter for multi-line).
- Supports one-click example prompts. Used for agent-goal / research-question / team-goal entry from the command palette, with 3 tailored example prompts each.

**Inline Panel notice system** (`Panel.tsx`)
- All 9 `alert()` calls in the slash-command path are gone. Replaced with a transient inline notice that appears above the chat, auto-dismisses after 4s (6s for errors), can be dismissed manually.
- Messages are actionable: "/agent requires a goal — e.g. `/agent summarise today's emails`" instead of the terse "Usage: /agent \<goal\>".

**Ctrl/⌘+, opens Settings** (`App.tsx`)
- Matches the VS Code / Obsidian convention every power user already knows. `ESC` still closes the palette.

**No-model empty-state guidance** (`Panel.tsx`)
- When zero models are configured, the chat empty state now shows a warn-toned notice pointing straight at Settings → Models. Distinguishes "Ollama not running" from "no models pulled".

**Upgrade prompt with mini pricing matrix** (`UpgradePrompt.tsx`)
- Instead of one line "this needs Pro", the upgrade modal now shows a 3-column Free / Pro / Team comparison with the target tier highlighted. The feature name is called out, and CTAs are split into "See full pricing" and "Activate licence".

**License state refreshes on window focus** (`TrialPill.tsx`)
- Activating a licence in Settings now shows "Pro" in the header pill instantly when you come back, instead of waiting up to 60 seconds.

**Better empty states** in Sidebar (first-thread CTA), Memory tab (example `/remember` usage), Schedule tab (example cron pattern), Canvas (prompt dialog instead of browser `prompt()`).

### Deliberately deferred (rationale noted)

- **Undo for thread delete** — the audit suggested 7-day soft delete. Meaningful feature, but requires a DB schema change and a trash view. Deferred.
- **Classroom button in main panel header** — the audit suggested surfacing this for teachers. Possible, but clutters the header for non-teacher users. The command palette already covers this.
- **Sidebar touch-friendly context menu** — only matters for the companion PWA, which has its own UI. Main panel is desktop-only.
- **Merging Memory + Knowledge tabs** — tempting for clarity but they have different mental models (memory is short facts, knowledge is document RAG). The new grouping puts them adjacent under "AI & chat" which lessens the IA pain.

---

## v0.11.2 — 2026-04-19 (security hardening)

A formal security audit pass across the main process, renderer, preload, and dependencies. Every finding graded high/critical is addressed here; medium+low noted and either fixed or explicitly deferred with reason. Lint clean, 59/59 tests pass (2 new regression tests on signature length + malformed envelope), build succeeds.

### Fixed — Critical

**PowerShell command injection via classroom-policy hostnames** (`src/main/enforcement.ts`)
- Hostnames for firewall blocks were interpolated into double-quoted PowerShell strings, so a hostname like `foo.com"; whoami; #` would have run `whoami` with UAC-elevated shell. `sanitizeHostname()` now strips shell metacharacters defensively AFTER the DNS-regex gate, and the generated script uses single-quoted PS strings throughout so `$`/backtick/semicolon can't expand even if the regex ever relaxed. Same treatment for `/etc/hosts` and iptables scripts.

**Classroom HMAC replay** (`src/main/classroom.ts`)
- Signed packets had a `ts` field that was never validated. A student could capture a colleague's valid heartbeat and replay it indefinitely, inflating "online / on-task" counts. Now `extractPacket()` enforces `|Date.now() - ts| <= 30s`; packets outside the window are rejected before the HMAC verify.

**Plugin symlink escape** (`src/main/plugins.ts`)
- The path-traversal guard used `path.relative()` on the resolved entry vs the plugin dir. A malicious manifest could point `main` through a symlinked subdirectory that escaped the plugin folder. Now uses `fs.realpathSync()` on both sides so the relative check is against real absolute paths.

**Arbitrary-protocol openExternal** (`src/main/main.ts`)
- `paia:open-external` blindly passed whatever URL the renderer sent to `shell.openExternal()`. A renderer-level XSS could therefore open `file:///etc/passwd` or `javascript:...` in the user's default browser. Now enforces a protocol whitelist (`http`, `https`, `mailto`) with a logged rejection for anything else.
- New dedicated `paia:open-user-path` IPC for the Plugins tab's "Open folder" button — validates the path stays inside `userData` and uses `shell.openPath()` instead of synthesising a `file://` URL.
- `will-navigate` + `setWindowOpenHandler` added on the main window and every detached-chat window: in-window navigation is blocked, `target="_blank"` is routed through the now-protocol-whitelisted `shell.openExternal()`.

### Fixed — High

**Constant-time token comparison** (`src/main/apiServer.ts`, `src/main/companion.ts`)
- Both local HTTP servers compared the bearer token with `!==`. A timing oracle on the LAN (companion server) or from a co-resident process (API server) could recover the 192-bit token in minutes. Now uses `crypto.timingSafeEqual` with explicit length pre-check.

**Research source URL filter** (`src/renderer/components/ResearchPanel.tsx`)
- Web-search results could in principle include `javascript:` or `data:` URLs. The button `onClick` passed them straight to `openExternal`. Now every rendered source is filtered through `isHttpUrl()`; disallowed ones are shown as plain text with a `(blocked non-http link)` note.

**Browser-agent goto scheme** (`src/main/browserAgent.ts`)
- The tool-level wrapper already rejected non-http URLs, but the internal `gotoUrl()` didn't — any future caller (plugin, test, misconfigured code path) could have loaded `file:` or `javascript:` in the hidden agent window. Now enforces the scheme check at the function boundary too (defence in depth).

**Feedback endpoint arbitrary headers** (`src/main/beta.ts`)
- `feedback-save-config` accepted unrestricted `headers: Record<string, string>` and spread them into every outbound feedback POST. A malicious renderer could persist `{ Authorization: "Bearer admin-token" }` and exfiltrate it. Now a strict `X-*` header allowlist + value-length cap + endpoint-must-be-http(s) gate enforced on every load and save.

**Signature malformed-input hardening** (`src/shared/licenseVerify.ts`, `src/main/license.ts`, `src/main/beta.ts`)
- License + beta-invite + trial-extension verifiers now explicitly check the decoded signature length is exactly 64 bytes (Ed25519 spec) and that the envelope has the expected field shapes before handing to `crypto.verify`. Two new vitest cases cover the short-sig / long-sig / empty-sig / null-envelope rejection paths.

### Fixed — Medium

**Renderer attachment DoS** (`src/renderer/components/Composer.tsx`)
- Dropped files had a text-content cap but no size gate on the incoming `File`. A 10 GB drop would peg renderer memory while `FileReader` ran. New 25 MB per-file cap with a hint if a file is skipped.

**Remote browser HTTP over LAN** (`src/main/remoteBrowser.ts`)
- If a user configures a non-loopback `http://` endpoint, the CDP WebSocket carries page DOM and the auth token in cleartext. We warn (not block — loopback and dev setups legitimately use HTTP) and log the endpoint when it's non-loopback HTTP.

### Dependencies

- `protobufjs@7.5.4` → `^7.5.5` (pinned via `package.json#overrides`) — GHSA-xq3m-2v4x-88gg (critical, arbitrary code execution)
- `hono@4.12.12` → `^4.12.14` (pinned via `package.json#overrides`) — GHSA-458j-xx4x-4375 (moderate, HTML injection)
- `npm audit --omit=dev` now reports zero vulnerabilities. devDep-only issues (vitest / tar / cacache chain) are present but don't ship in the packaged app.

### Findings explicitly NOT fixed (and why)

For the record — the audit surfaced these, but on review they don't warrant changes:

- **0.0.0.0 binding on companion server** — intentional. The whole point is reaching the desktop from your phone on the same LAN; binding to a single IP would break multi-NIC setups. Bearer auth + constant-time compare covers this.
- **CSP `style-src 'unsafe-inline'`** — removing it requires a React inline-style refactor across ~15 components. Worth doing later, not a live vector today.
- **`eval('require')` in plugins / wake-word** — both load hardcoded module paths, not user input. Switching to dynamic `import()` means making the whole call chain async for marginal gain.
- **Canvas iframe `sandbox=""` attribute** — the audit flagged it as "permissive". Per MDN, `sandbox=""` (empty string attribute PRESENT) is the MAXIMUM-restrictive mode. The presence of the attribute activates sandboxing with zero `allow-*` capabilities. This is actually correct.
- **`marked` without an explicit sanitizer** — marked v15 escapes raw HTML by default. Adding DOMPurify is belt-and-braces but adds 20+ KB of bundle for a theoretical second-line defence behind an already-strict CSP.

### Regression tests added

- `licenseVerify.test.ts` — 2 new tests covering signature-length rejection and malformed-envelope handling.

---

## v0.11.1 — 2026-04-19 (pre-launch bug pass)

A systematic audit of every main-process and renderer module for races, leaks, and logic bugs that static typecheck + existing tests wouldn't catch. Lint clean, 57/57 tests pass, build produces artifacts.

### Fixed

**Classroom — HMAC verification races** (`src/main/classroom.ts`)
- The `/classroom/join` and `/classroom/heartbeat` handlers read the request body asynchronously, then verified the HMAC against `teacherPublicKey!` / `teacherKey!`. A concurrent `stopTeacher()` could null those between the async read and the verify, leaving the `!` assertion to hand a null to `verify()`. Now we snapshot key + session at request entry and null-check before verification.

**Classroom — orphan intervals** (`src/main/classroom.ts`)
- The teacher liveness-sweep interval was held by a local variable, never cleared on `stopTeacher()`. A restart spawned a second interval on top. Now held in a module-level `teacherSweepInterval` and cleared by both `stopTeacher()` and the guard branch inside the sweep itself.
- `startStudentLoop()` cleared prior timers but the replacement had no tick-level guard — a stale tick could fire after `studentLeave()` and crash on null state. Added a `role !== 'student'` guard inside the tick.

**Ambient — restart race** (`src/main/ambient.ts`)
- `start()` / `restart()` created a new interval but prior in-flight `runTick()` promises would still complete and emit suggestions under the new settings. Added a monotonic `generation` counter; every `runTick` captures its generation and aborts early when stale.

**Remote browser — CDP pending map leak** (`src/main/remoteBrowser.ts`)
- On reconnect we replaced the `pending` map but didn't reject the promises in the old one. Callers waiting on the prior socket's message ids would hang forever. Now we reject every outstanding waiter with a clear "socket reconnected" error before swapping the map.

**License — status() disk reads** (`src/main/license.ts`)
- Every call synchronously read `license.json` + `trial.json`. Agent tool loops + metering can call `status()` hundreds of times per second, producing visible UI jank on slower disks. Added a 1-second TTL cache with `invalidateStatusCache()` called from `activate()`, `deactivate()`, and `redeemExtension()`.

**Composer — Whisper streaming subscription leak** (`src/renderer/components/Composer.tsx`)
- Each VAD segment registered `onWhisperToken` + `onWhisperDone` IPC handlers that only unsubscribed on `paia:whisper-done`. If the main-process transcription hung (backgrounded tab, model stall, network blip), the handlers lived forever and accumulated across every utterance. Added a 30-second safety timeout that forces `cleanup()` and a hint to the user.

**App.tsx — stale-closure model resolution** (`src/renderer/App.tsx`)
- `startAgent` / `startResearch` could read `currentThread?.model` from a stale closure after `api.createThread()` had populated a different thread. Now snapshots `threadModel` before any await and threads the local through.

**App.tsx — double-send race** (`src/renderer/App.tsx`)
- A fast double-tap on Send (or Enter / Enter while a reply was streaming) spawned two concurrent `onChatToken` subscriptions on the same thread; both appended to the same assistant message, producing duplicated tokens. Added a `sendingRef` guard that wraps the entire function in a try/finally so it releases on every exit path (early return, mid-create throw, inner rethrow).

### Removed

- Dead `paia:classroom-record` IPC handler — declared but never called from any preload caller; reduced attack surface by an unreachable endpoint.

### Bug classes deliberately NOT flagged as bugs

For the record — these showed up in the audit but on review are not actually bugs:

- `settings.ts` cache invalidation: already correct; every `save()` mutates the cache.
- `metering.ts` TOCTOU between cap-read and record: the tier transitions being imperceptible in human time, and the race window is a single sync call.
- `media.ts` `Math.random()` seed: image gen seeds don't need cryptographic randomness.
- Canvas.tsx dependency arrays: already correct on re-read.
- `Composer.tsx voiceContinuous` effect: dep array is present; toggling in settings does re-arm.
- `Panel.tsx` provider-refresh loop: cancelled flag IS present; React 18 swallows setState-on-unmount warnings.

Not everything slow or suspicious is a bug. Fixing non-bugs adds rework without improving safety.

---

## v0.11.0 — 2026-04-19 (commercial engine)

The pre-launch engineering pass from `COMMERCIALIZATION.md`. The product is now genuinely shippable as a paid product — the only things blocking launch are code-signing certs, lawyer sign-off, and a merchant account.

### Added

**Commercialization roadmap** — new [COMMERCIALIZATION.md](COMMERCIALIZATION.md)
- Five-phase playbook (foundations → pre-launch → beta → launch → growth)
- Realistic cost table, launch-day runbook, channel picks, anti-patterns
- Living doc: check items off as you execute

**Feature gating pass** — every Pro/Team-tier feature is now enforced at the main-process entry point
- Rewrote the free/Pro/Team matrix in `license.ts` to match the pricing page (free keeps a real, usable tier; Pro unlocks agent/research/canvas/cloud/connectors/ambient/etc.; Team adds classroom + enforcement)
- `requireFeature()` now throws a stable phrase the renderer can catch and surface as an upgrade prompt
- Gates wired into: `agent.startRun`, `team.startRun`, `research.startRun`, `classroom.startTeacher`, `enforcement.applyLock`, `providers.chat` (cloud), `mcp.callTool`, `webSearch.search`, `artifacts.create`, `rag.ingestFile`, `connectors.connect`, `scheduler.saveScheduledTask`, `autopilot.saveRule`, `plugins.setEnabled`
- New `UpgradePrompt` renderer modal intercepts the thrown phrases and points users at Settings → License + pricing

**Onboarding polish** — rewrote `Onboarding.tsx` from 3 steps to 5
- New step: language picker (applies immediately via `setLocale`)
- Step 2 got OS-aware Ollama install helper — detects macOS/Linux/Windows, shows the correct one-liner with a Copy button
- Three curated model presets (lightweight 3B / balanced 8B / coder 7B) with pull-inline buttons instead of a single hardcoded model
- New final step with three quick-start tips (⌘K, quick actions, drag-drop)
- Progress dots in the header

**Trial countdown UI** — new `TrialPill` + `TrialExpiredModal`
- Pill in the panel header, four visual states:
  - Pro / Team license: small green chip
  - Trial > 5 days: grey "Trial · Nd"
  - Trial ≤ 5 days: amber urgency chip
  - Free (post-trial): accent-coloured "✨ Upgrade"
- Click always opens Settings → License
- One-time "your trial ended" modal on first launch post-expiry; `trialExpiryAcknowledged` setting prevents renags

**Referral / trial-extension flow** — signed extension codes
- New `SignedTrialExtension` payload + Ed25519 verification piggybacking on `PAIA_PUBLIC_KEY`
- `license.redeemExtension()` adds days to `trial.bonusDays` with nonce-based replay protection
- Licensed users see a shareable `paia.app/?ref=<email>` link in Settings → License
- Free users get a paste box to redeem an extension code
- New CLI: `scripts/issue-trial-extension.mjs` mirrors the license issuer for rewarding referrers, compensating for incidents, extending beta testers

**Per-feature metering** — new `src/main/metering.ts`
- Free-tier soft caps: 5 agent runs/day, 2 research runs/day, 3 image generations/day, 10 autopilot fires/day, 3 total RAG documents, 200 total memory entries
- Day buckets keyed by local calendar date; lifetime counters for accretive features
- Caps bypass entirely on trial / Pro / Team
- `checkAndRecord()` throws the same stable phrase as `requireFeature()` so the existing UpgradePrompt handles it
- Autopilot metering fails silently (log + skip) rather than spamming modals
- Settings → License tab shows live usage bars (80% warns amber, 100% turns red) so users see the cap coming

### Changed

- `Settings.trialExpiryAcknowledged` — new one-shot flag.
- Onboarding step count bumped from 3 to 5.

### Publication gates that remain (non-engineering)

- Buy the Windows EV cert ($400–700/yr) + enrol in Apple Developer Program ($99/yr).
- Lawyer review of `legal/*` templates (~$1.5–4k).
- Pick + onboard a merchant of record (Paddle / LemonSqueezy recommended for non-US founders).
- Fill the one-page commercial brief at the bottom of `COMMERCIALIZATION.md`.

---

## v0.10.0 — 2026-04-19 (Jarvis-gap release)

Two pieces that close the biggest experiential gaps between PAiA and the fictional Jarvis: autonomous acting inside pre-approved envelopes, and physical-world control via Home Assistant.

### Added

**Autopilot — pre-approved ambient rules** (`src/main/autopilot.ts`)
- Rules turn a specific class of ambient suggestion (error-on-clipboard, URL-on-clipboard, question, long-idle, plugin-contributed `custom`) into an automatic action (chat / agent / research / canvas)
- Four guardrail knobs per rule: daily cap, cooldown seconds, allowed-hour window (supports overnight wrap), and an optional regex the trigger's detail must match
- Classroom policy still wraps everything — a student-locked client can't run agent actions even if a rule says so
- Every fire writes to `userData/autopilot-fires.json` with `{ id, ruleId, suggestionId, firedAt, ok, error? }` and emits a native notification so the user knows something happened in their name
- Settings → Ambient gained an Autopilot section: list / enable / disable / delete existing rules, edit a draft rule with trigger + detail regex + action + prompt template + guardrails, plus a scrollable recent-fires log
- Wired directly into the ambient loop: when a matching rule exists, the toast is *suppressed* and the action fires silently

**Home Assistant reference plugin** (`plugins-examples/home-assistant/`)
- Drop-in plugin that registers nine agent tools: `home.listEntities`, `home.getState`, `home.turnOn`, `home.turnOff`, `home.toggle`, `home.setBrightness`, `home.setTemperature`, `home.runAutomation`, `home.callService`
- Each tool is tagged with its proper risk tier so the default "assisted" autonomy auto-approves light toggles but gates lock operations and arbitrary service calls
- HA already bridges **HomeKit**, **Matter**, **Zigbee**, and **Z-Wave**, so one plugin covers effectively every smart-home device the user owns
- README walks the user through creating a Long-Lived Access Token and `config.json` — no code changes or restart needed
- Demonstrates the Plugin SDK end-to-end: manifest → `register(context)` → contributed tools, loaded by `src/main/plugins.ts` unchanged

### Combined impact

Together these two close the "it doesn't really *do* anything without me" gap. Pre-approve an autopilot rule on "URL copied to clipboard" that fires `home.runAutomation` for `automation.arrive_home`, and PAiA starts acting like a real Jarvis: noticing, deciding (within envelopes you set), and making things happen in the physical world.

### Limits (honest)

- Autopilot rules don't chain yet — a rule fires a single action, not a sequence. Workaround: the action can be an agent run with a goal that itself calls multiple tools.
- Plugin SDK v1 only exposes main-process hooks. Renderer-side UI contributions (a HA dashboard panel inside PAiA) is v2 territory.
- HomeKit and Matter are covered through Home Assistant, not directly. Direct HomeKit pairing would need a separate Node/Rust helper because the mDNS + SRP pairing protocol is involved; not on the current roadmap.

---

## v0.9.0 — 2026-04-19 (Phase 4 + launch scaffolding)

Closes everything that was engineering-side on Phase 3/4 of the roadmap. What's left is commercial (buy certs, retain counsel) and marketing.

### Added

**Localization (i18n)** — `src/renderer/lib/i18n.ts` + 7 locale files
- Zero-dep `t()` runtime with dotted-key lookups and `{{placeholder}}` interpolation
- English is the authoritative catalog (`locales/en.ts`, `as const` for autocomplete); six partial translations (es / fr / de / hi / ja / zh) with graceful fallback
- `DeepPartial` that widens string literals to `string` so non-English locales type-check
- `useT()` hook subscribes components to locale changes
- Settings → General gained a Language picker; sets `<html lang>` on change
- Seeded strings cover panel header, composer, empty state, classroom, agent, canvas, onboarding, settings tabs, memory

**Accessibility pass** — across `styles.css` and four components
- `prefers-reduced-motion` disables every animation and transition
- `:focus-visible` high-contrast ring
- `forced-colors` media query keeps buttons outlined in Windows High Contrast mode
- `useFocusTrap` hook (`lib/focusTrap.ts`) — modals trap Tab and restore focus on close
- Command palette: `role="dialog"`, `aria-modal`, `aria-activedescendant`, option roles
- MCP approval modal: `role="alertdialog"` with `aria-labelledby` + `aria-describedby`
- Panel message list: `role="log"` + `aria-live="polite"` so screen readers narrate streaming output
- Every emoji-only icon button now carries both `title` and `aria-label`

**Multi-window detachable chats** — new detached bundle + window manager
- `paia:detach-thread` IPC spawns a new resizable BrowserWindow that loads `detached.html` with `?thread=<id>`
- Detached window is a minimal React entry (`detached.tsx`) that reuses the full `Panel` component — so markdown rendering, composer, voice, mic, drag/drop, all still work
- Sidebar gained a per-thread detach button (⇱)
- The main process tracks detached windows by thread id so reopening a thread's detach focuses the existing window instead of duplicating it

**Local REST API server** — `src/main/apiServer.ts`
- Bound to `127.0.0.1` only; bearer-token auth; key regenerates on every restart unless the user pins it
- `/v1/info`, `/v1/threads` (GET+POST), `/v1/threads/:id/messages`, `/v1/chat` (SSE), `/v1/agent` (POST+GET), `/v1/research`, `/v1/memory`
- Raycast / Alfred / Shortcuts / custom scripts can now drive PAiA without touching the UI
- Settings → API tab has start/stop, key regenerate, pin-key toggle, and a ready-to-paste curl example

**Closed-beta scaffolding** — `src/main/beta.ts` + `scripts/issue-beta-invite.mjs`
- Ed25519-signed `beta-invite` blobs verified against the same `PAIA_PUBLIC_KEY` as licenses
- Invite CLI mirrors the license issuer — hand out JSON or base64 blobs
- Once activated, the `beta` feature flag unlocks and the invite identity (name / email / cohort) is visible in Settings → Beta
- In-app feedback widget: free-form message + optional rating, posts to a configurable endpoint (Slack webhook / Linear API / your own), queues locally on failure and retries on next launch

**Legal templates** — new `legal/` folder
- [EULA.md](paia-electron/legal/EULA.md) — end-user licence for installers
- [PRIVACY.md](paia-electron/legal/PRIVACY.md) — comprehensive privacy policy broken out by data category, with the opt-in / opt-out model explicit
- [TERMS.md](paia-electron/legal/TERMS.md) — website / purchase terms
- [ACCEPTABLE_USE.md](paia-electron/legal/ACCEPTABLE_USE.md) — abuse policy
- [DPA.md](paia-electron/legal/DPA.md) — Data Processing Addendum for enterprise / Team tier
- [SUBPROCESSORS.md](paia-electron/legal/SUBPROCESSORS.md) — third parties touching customer data
- [RESPONSIBLE_DISCLOSURE.md](paia-electron/legal/RESPONSIBLE_DISCLOSURE.md) — security.txt-ready policy with safe harbor
- Every file carries a `⚠️ Template — not lawyer-reviewed` banner and a `[BRACKETS]` placeholder map

### Changed

- `Settings` shape gained `locale: LocaleId`.
- `FeatureFlag` union gained `beta`.
- All detached windows share the main-process services (DB, providers, memory, personas, RAG) so threads stay coherent across windows.

### Limits (honest)

- Localization seeded the highest-value surfaces; thousands of other strings still hardcoded in English, including every main-process error message. Future PRs should use `t()` on new strings by default and extract existing ones as they touch components.
- Accessibility pass covered the ARIA basics and focus handling. A full audit with a screen reader (NVDA on Windows, VoiceOver on macOS) would surface more issues — recommended before v1.0.
- Local API server ships without rate limiting. If you plan to expose it to processes you don't fully trust, add a middleware (not on the roadmap yet because the same-machine threat model is low).
- Legal templates are starter text. A one-hour call with counsel qualified in your jurisdiction is the actual gate before shipping a paid tier.

---

## v0.8.0 — 2026-04-19 (future-hooks release)

Closes every item on the "future hooks" list from v0.7. Lint clean, 57/57 tests, dual-process typecheck passes.

### Added

**S3 multipart upload** (`sync.ts`)
- Blobs > 64 MB switch to `InitiateMultipartUpload` → `UploadPart` (16 MB parts) → `CompleteMultipartUpload` automatically
- `AbortMultipartUpload` on any part failure so we don't orphan storage
- ETag collection per part feeds the `CompleteMultipartUpload` XML body
- Works against AWS, Cloudflare R2, Backblaze B2, MinIO, Wasabi

**Streaming Whisper decode** (`whisper.ts` + `Composer.tsx`)
- New `transcribeStream()` attaches `@huggingface/transformers`' `TextStreamer` to the ASR pipeline; tokens are emitted over IPC (`paia:whisper-token`) as the decoder finalises each chunk
- Renderer attaches per-segment listeners in the VAD segmenter callback and paints the streamed prefix into the draft live; the final-event normalises the prefix with the clean text
- Falls back to single-shot mode gracefully if the installed transformers version doesn't export `TextStreamer`

**Local Chromium orchestration** (`remoteBrowser.ts`)
- Probes the usual install paths for Chrome / Chromium / Edge / Brave across macOS, Linux, Windows
- One-click spawn with `--remote-debugging-port=<free>`, `--user-data-dir=<temp>`, `--remote-allow-origins=*`
- Auto-fills the remote endpoint and waits up to 10 s for `/json/version` to answer before returning
- Clean shutdown on PAiA quit (and on manual "Stop local") — temp profile dir removed
- Settings → Remote browser tab exposes the whole flow; also handles "has anything been found" feedback

**Code-signing scaffolding** (`scripts/check-signing.mjs`, `scripts/notarize.mjs`, `SIGNING.md`)
- Preflight that validates `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID` (email shape), `APPLE_APP_SPECIFIC_PASSWORD` (xxxx-xxxx-xxxx-xxxx), `APPLE_TEAM_ID` (10-char upper alnum)
- On macOS hosts, also runs `security find-identity` to confirm a Developer ID cert is importable
- `--strict` flag (used on tag pushes in CI) promotes warnings to failures
- `afterSign` hook zips the `.app`, submits to `xcrun notarytool`, staples on success, falls back to no-op when creds are missing
- `dist:win` / `dist:mac` now run `signing:check` first so a missing cert aborts in 2 seconds instead of 10 minutes
- GitHub Actions workflow gained a `signing:check:strict` step on tag pushes
- `SIGNING.md` documents the full enrolment path for both platforms, CI secret wiring, and common troubleshooting

### Limits (honest)

- Multipart S3 currently holds each 16 MB part in memory before uploading. For truly massive blobs we'd stream from disk; not worth doing before someone asks.
- Streaming Whisper emits token chunks as the decoder produces them — it's still processing one VAD segment at a time, not "live as you speak at the token level". For that, a streaming-capable model (whisper.cpp streaming / faster-whisper websocket) is the right next step.
- Local Chromium orchestrator cleans up temp profiles on exit, but a force-killed PAiA can leave one behind. They're in the OS temp dir and get cleaned by OS hygiene.
- Notarization still costs wall-clock time (30–120 seconds on Apple's side). There's no way to speed that up.

---

## v0.7.0 — 2026-04-19 (remaining-roadmap release)

Everything on the "still genuinely unclaimed ground" list closes out here. Shipped one-by-one, each passing `lint` clean and all 57 tests.

### Added

**Attachment streaming in E2E sync** (`sync.ts`)
- Chunked AES-256-GCM: each attachment becomes a manifest envelope + N raw-ciphertext chunk files on the backend
- Fresh IV per chunk, per-chunk auth tag; manifest filename is HMAC-derived so the operator can't tell what's inside
- New `settings.include.attachments` toggle, configurable chunk size (default 1 MB) and max-bytes cap (default 100 MB)
- `db.addAttachmentRaw()` helper for the pull path
- Handles images, PDFs, and other blobs up to 100 MB without loading the whole file into memory at once

**ComfyUI real workflow-graph invocation** (`media.ts`)
- Ships a minimal default text-to-image workflow (checkpoint loader + KSampler + VAE decode + SaveImage)
- Loads `userData/comfyui-workflow.json` if present and substitutes `$PROMPT$` / `$NEGATIVE$` / `$WIDTH$` / `$HEIGHT$` / `$SEED$` / `$BATCH$` placeholders
- POSTs to `/prompt`, polls `/history/<id>`, downloads `/view?filename=…` — returns base64 data URLs the chat can render inline
- 3-minute timeout with clear error messages

**Cross-machine remote browser** (new `src/main/remoteBrowser.ts`)
- Speaks Chrome DevTools Protocol over WebSocket to a headless Chromium running on a VM / container / remote host (`chromium --remote-debugging-port=9222 --remote-allow-origins=*`)
- Full tool parity with the local browser agent (8 new `remote.*` tools) so the LLM can pick per-step
- Auto-attaches to the first page target; auto-reconnects on drop
- 30s per-call CDP timeout; 3-minute overall ops budget
- Classroom-policy-aware (`allowWebTools` gates the whole subsystem)

**Real-time offline voice (VAD-segmented Whisper)** (new `src/renderer/lib/vadSegmenter.ts`)
- Adaptive noise-floor VAD emits a segment every time the user pauses speaking; each segment is transcribed by Whisper and appended to the draft
- Longer silence after a segment triggers auto-submit (same UX as the Chromium continuous path, but fully offline)
- Per-segment resample to 16 kHz with linear interpolation — no DSP lib
- Tunable knobs for min-segment duration, emit silence, auto-submit silence, and speech multiplier
- Enabled automatically when the user picks Whisper STT + Continuous voice in Settings

**S3-compatible sync backend** (`sync.ts`)
- Full AWS Signature V4 in pure TS (no AWS SDK) — works with AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi
- Path-style addressing (`https://endpoint/bucket/key`) for cross-provider compatibility
- ListObjectsV2 XML parse, SHA-256 payload hash, canonical request + string-to-sign + HMAC signing chain
- New Settings fields: region, bucket, prefix, access key id, secret access key

### Limits

- Remote browser requires the user to launch the remote Chrome themselves; we don't orchestrate the container for them.
- Whisper streaming segments discretely — not "token-by-token" as the user speaks. But utterance latency is now bounded by VAD + one transcribe call (~500ms on whisper-tiny for short segments), which feels live.
- S3 backend uses single-part PUT — good to ~100 MB per object. Multipart upload for truly large attachments is a future hook.

---

## v0.6.0 — 2026-04-19 (four-for-four release)

Closes the remaining "most-advanced-tool" roadmap items. Everything below ships in this single release, tested and type-clean.

### Added

**Browser-use agent** (new `src/main/browserAgent.ts`)
- Hidden `BrowserWindow` in a dedicated `persist:paia-browser-agent` session so cookies/storage don't leak into the main window
- Off-screen rendering (`offscreen: true`) + `backgroundThrottling: false` keeps page scripts alive even when not visible, so the agent can think-and-act at full speed without stealing focus
- Eight new Agent tools — `browser.goto`, `browser.back`, `browser.click` (selector or visible text), `browser.type` (React-friendly native-setter + input-event), `browser.scroll`, `browser.waitFor`, `browser.screenshot` (feeds directly to vision models), `browser.state`
- All DOM access is through vetted templates — no arbitrary `eval` is exposed to the LLM
- Permission request handler denies camera/mic/geolocation/notifications regardless of what pages ask
- Classroom-policy-aware: blocked when `allowWebTools` is off

**Image + video generation** (new `src/main/media.ts`)
- Six providers pluggable via one dispatcher: OpenAI (gpt-image-1 / DALL-E), Stability AI, Replicate, fal.ai, ComfyUI, Automatic1111
- Two new Agent tools: `image.generate` and `video.generate`
- Configs persisted in `userData/media-providers.json` (kept separate from LLM providers so different keys can be used)
- Settings → Media tab with per-provider config + live test-generate

**E2E encrypted cloud sync** (new `src/main/sync.ts`)
- AES-256-GCM per object; 200k-iteration PBKDF2-SHA256 key derivation from a user passphrase + a stable per-install salt
- Remote filenames are HMAC(key, "kind:id") — the storage operator sees object count and sizes, nothing else
- Two pluggable backends: local folder (paired with Syncthing / Dropbox / iCloud Drive) and WebDAV (Nextcloud, ownCloud, etc.)
- Push / pull / both; last-write-wins per-object with ties preferring local
- Passphrase stays in memory only; user re-unlocks on app restart
- Settings → Sync tab with backend picker, include-set toggles, unlock + run controls, last-run status

**Mobile companion** (new `src/main/companion.ts`)
- Tiny HTTP server on user-chosen port (default 8743) serves an inline PWA — no app-store install needed on the phone
- Bearer-token auth per session; token regenerates every time the server restarts
- REST API: list/create threads, list messages, send message, Server-Sent Events stream for token-level streaming reply
- Phone uses the desktop's configured persona, model, RAG collections, memory — same chat pipeline, same redaction
- Settings → Companion tab shows pairing URL + raw token

### Changed

- Agent tool collection now includes built-ins + **browser** + **media** + connectors + plugins + MCP
- `SyncSettings`, `MediaProviderConfig`, `CompanionState` types added to the shared surface
- Preload bridge exposes full CRUD for media configs, sync settings + unlock + run, companion start/stop/state, browser-agent show/hide/screenshot

### Limits (honest)

- Sync v1 syncs threads / messages / memory / artifacts metadata. Large binary attachments (images, PDFs) aren't streamed yet — they stay local until v0.7.
- ComfyUI backend pings `/system_stats` to confirm reachability but wiring a real workflow graph is deferred; A1111 and cloud providers are the practical path today.
- Mobile companion is LAN-only. Exposing it beyond the LAN needs a reverse tunnel (Tailscale, Cloudflare Tunnel) the user brings themselves — we deliberately don't punch holes in their network.
- Browser agent is same-machine only. Cross-machine browser-use (sandboxed VM, remote Chrome) is a separate thing.

---

## v0.5.0 — 2026-04-19 (differentiator release)

The big "stand-out" release. Five new subsystems that, together, push PAiA past anything in the single-window chat-app category.

### Added

**OS-level enforcement** (new `src/main/enforcement.ts`)
- Windows: UAC-elevated PowerShell that creates per-host outbound firewall deny rules, and optionally sets `DisableTaskMgr`; reversed by a second auto-generated script on release
- macOS: `osascript` admin prompt edits `/etc/hosts` with bracketed markers so release restores cleanly; also flushes `mDNSResponder`
- Linux: `pkexec` runs iptables `OUTPUT … REJECT` with `paia-classroom` comment; release diffs rules and removes only the ones we added
- Snapshot file in `userData/enforcement/snapshot.json` so state survives PAiA crashes; startup self-heals stale locks older than 12h
- Surfaces platform capabilities and live status + last script log to the Settings → Enforcement tab

**Ambient / proactive mode** (new `src/main/ambient.ts`, `AmbientToast.tsx`)
- Background watcher samples clipboard + active window at a configurable interval
- Built-in triggers: error/stack-trace detection, natural-language question detection, URL-on-clipboard, long-idle-on-same-file in editors
- Per-kind cooldowns, classroom-policy aware (agent/web triggers suppressed when disallowed)
- Toast UI for suggestions with Accept / Dismiss; also fires a native OS notification
- Plugin API lets third-party plugins contribute new trigger functions

**Multi-agent "team" runs** (new `src/main/team.ts`)
- One-run-many-roles orchestration: Planner → Researcher / Coder / Writer → Reviewer loop
- Reviewer verdict drives whether to revise the plan (up to a configurable max rounds) or produce the final writer turn
- Each role can have a different model (strong for planner/reviewer, fast for researcher/coder)
- Blackboard of prior turns fed into every subsequent role so they're coherent without needing a central state store

**Plugin SDK** (new `src/main/plugins.ts`)
- Drops JS-file plugins into `userData/plugins/<id>/` with a `paia-plugin.json` manifest
- Each plugin's `register(ctx)` can contribute agent tools, ambient triggers, and slash commands
- Manifest validation + per-plugin enable/disable stored in a registry; declared `contributes` block surfaced in Settings → Plugins so users can audit before enabling
- Paranoid path check prevents a malicious manifest from requiring outside its own directory

**Native notifications** (new `src/main/notifications.ts`)
- Agent-run completion fires a silent notification when done, a normal one when errored
- Ambient suggestions double as silent notifications so tabbed-away users see them
- Gated by `settings.notificationsEnabled`

### New renderer surface

- **Command palette** (`CommandPalette.tsx`) — ⌘/Ctrl+K from anywhere. Fuzzy search over threads, artifacts, memories, slash commands, and top-level actions (new thread, open canvas, start agent / research / team, open settings). Keyboard-first with arrow-key navigation.
- **Ambient toast** — bottom banner with Accept / Dismiss, auto-dismisses after 20s
- **Settings tabs**: Enforcement, Ambient, Plugins
- **Duplex voice mode** — `voiceContinuous` setting keeps the Chromium recognizer running and auto-submits after ~1.6s of trailing silence; the recognizer auto-rearms when Chrome ends the session
- **UI polish** — panel enter animations, focus rings on every interactive element, button press feedback, floating empty-state emoji, palette keyboard hint pinned to the bottom right

### Changed

- `Settings` type gained `ambient`, `voiceContinuous`, `pluginsEnabled`, `notificationsEnabled`
- Agent orchestrator collects tools from built-ins + connectors + **plugins** + MCP
- Chat dispatcher and Agent run-start both consult classroom policy + cloud allow flag
- `FeatureFlag` union gained `enforcement`, `ambient`, `team`, `plugins`

### Limits (honest)

- Enforcement scripts require UAC/sudo on every apply and release. That's intentional — we want the user's OS to own the elevation, not PAiA.
- Continuous voice relies on the Chromium recognizer (online). A fully-offline duplex mode using Whisper + VAD in Electron would need the Whisper model loaded in streaming mode — deferred.
- Plugins run in the main process with full Node capabilities. This is powerful but means trust is on the user — we make sure the UI surfaces what each plugin claims to contribute.

---

## v0.3.0 — 2026-04-09

### Added

**Crash reporting & analytics**
- `@sentry/electron` integration in both main and renderer processes
- Strictly opt-in: disabled by default, user-supplied DSN, no baked-in default
- PII scrubbing in `beforeSend` and `beforeBreadcrumb` using the same redactor as the chat path
- Drops `event.user`, `server_name`, console + DOM input breadcrumbs that could leak prompts
- Anonymous opt-in usage analytics (zero npm dependencies — pure `fetch`)
- Property whitelist enforced to block accidental data leakage by future contributors
- Anonymous per-install UUID stored in `userData/anonymous-id.txt`, user-resettable
- New **Privacy** tab in Settings consolidating all telemetry controls

**Distribution & licensing**
- Standalone Stripe + LemonSqueezy webhook server in [server/license-server.mjs](server/license-server.mjs) — zero npm dependencies, ~330 lines, deployable to any VPS or serverless platform
- Email delivery via Resend HTTP API (recommended) or built-in SMTP client
- Automated icon generation pipeline (`sharp` + `png2icons`) wired into `npm run build:icons`
- Real `icon.png`, `icon.ico`, `icon.icns` generated from the source SVG
- Generated icons gitignored — SVG is the single source of truth, CI regenerates per build
- CI release pipeline polished — code-signing env-var passthrough (`CSC_LINK`, `APPLE_ID`, etc.), `PAIA_PUBLIC_KEY` embed, multi-platform installer artifact upload
- Marketing website (`website/`) — landing, pricing, privacy, download, changelog, docs

**Voice — Piper TTS**
- New `src/main/piper.ts` sidecar — lazy-downloads the Piper binary on first use, caches in `userData/piper/bin`
- 7 built-in voice options across English, Spanish, French, German, Hindi
- Voice models lazy-downloaded and cached (~60 MB each)
- Settings → Voice → Piper voice picker with test playback + per-voice delete
- Renderer routes TTS playback to Piper or system TTS based on settings

**Voice — wake word**
- New `src/main/wakeWord.ts` integrating Picovoice Porcupine
- Strictly opt-in: requires user to enable + supply a Picovoice access key
- Picovoice packages are NOT bundled — installed by power users via `npm install @picovoice/porcupine-node @picovoice/pvrecorder-node`
- 15 built-in keywords (computer, jarvis, alexa, hey google, hey siri, etc.)
- Auto-restart when settings change
- CPU cost warning surfaced in the Voice settings tab

**Active window awareness on Linux**
- Wayland fallback chain: GNOME `window-calls` extension via gdbus → KDE Plasma via qdbus → Hyprland via hyprctl
- X11 path via xdotool unchanged
- Graceful degradation with a clear log message when no method is available

### Changed

- Extracted pure helper modules into `src/shared/` so they can be unit-tested without booting Electron:
  - `src/shared/chunking.ts` (was inline in `rag.ts`)
  - `src/shared/ddgParser.ts` (was inline in `webSearch.ts`)
  - `src/shared/licenseVerify.ts` (was inline in `license.ts`)
- `chunkText`, `parseDuckDuckGoHtml`, `verifyLicense`, `signLicense`, etc. are now testable from vanilla Node
- Renderer bundle grew from 824 KB to 1.0 MB (added `@sentry/electron/renderer`)

### Tests

- Test count: **8 → 48** across 5 files
- New: `chunking.test.ts` (7), `ddgParser.test.ts` (13), `licenseVerify.test.ts` (7), `slashCommands.test.ts` (13)

### Files added (this release)

- [src/main/crashReporting.ts](src/main/crashReporting.ts)
- [src/main/analytics.ts](src/main/analytics.ts)
- [src/main/piper.ts](src/main/piper.ts)
- [src/main/wakeWord.ts](src/main/wakeWord.ts)
- [src/shared/chunking.ts](src/shared/chunking.ts)
- [src/shared/ddgParser.ts](src/shared/ddgParser.ts)
- [src/shared/licenseVerify.ts](src/shared/licenseVerify.ts)
- [src/shared/chunking.test.ts](src/shared/chunking.test.ts)
- [src/shared/ddgParser.test.ts](src/shared/ddgParser.test.ts)
- [src/shared/licenseVerify.test.ts](src/shared/licenseVerify.test.ts)
- [src/renderer/lib/slashCommands.test.ts](src/renderer/lib/slashCommands.test.ts)
- [server/license-server.mjs](server/license-server.mjs)
- [server/README.md](server/README.md)
- [scripts/build-icons.mjs](scripts/build-icons.mjs)
- [CHANGELOG.md](CHANGELOG.md) (this file)

---

## v0.2.0 — 2026-04-08

### Added

**Phase 1 — MVP**
- Floating ball UI with click-to-expand chat panel
- React 18 renderer bundled with esbuild (zero config)
- Multi-thread chat with sql.js SQLite persistence (no native deps)
- 3-step onboarding wizard (welcome → Ollama detection → preferences)
- Light / dark / system themes
- 11 slash commands
- 7 built-in personas + user-defined CRUD
- Markdown rendering with syntax-highlighted code blocks
- Streaming token-by-token responses
- 11-category PII redaction
- Whisper STT (offline, lazy-loaded ~75 MB)
- Chromium STT
- System TTS via `speechSynthesis`
- Full-screen capture with Tesseract.js OCR
- In-app Ollama model browser (pull / list / delete)
- Configurable global hotkeys
- System tray icon
- electron-builder targets for Windows NSIS, macOS DMG, Linux AppImage + deb
- GitHub Actions CI building all 3 platforms
- Vitest unit test infrastructure

**Phase 1.5 — Differentiator features (A–E)**
- RAG knowledge collections with PDF / MD / text / code support
- Embedding via local Ollama (`nomic-embed-text` default)
- Brute-force cosine similarity search (fast for thousands of chunks, no vector index extension)
- Citation injection into chat responses
- Region screen capture overlay (drag-to-select transparent fullscreen window)
- DPI-correct cropping at native pixel resolution
- MCP (Model Context Protocol) client with mandatory tool-call approval modal
- Per-server tool whitelisting for trusted tools
- Cloud provider plugins: OpenAI, Anthropic, OpenAI-compatible (gated by `allowCloudModels`)
- Per-call provider routing via `provider:model` qualified names
- Streaming SSE reader shared between cloud providers
- App icon (SVG source + build script)
- Code-signing scaffolding for Windows Authenticode + macOS Developer ID
- Ed25519 license + 14-day trial system
- Standalone license issuance CLI

**Phase 2 — Productivity features (F–I)**
- Web search via DuckDuckGo HTML, no API key, no JS
- `/search` slash command with PII-redacted query + cited results
- Drag-and-drop image attachments
- Clipboard image paste via Electron's native clipboard API
- `/image` slash command
- Vision-model warning banner when an image is attached to a non-vision model
- Quick actions on selected text (Ctrl+Alt+Q → 8-button popup → fresh thread)
- Active window awareness via PowerShell (Win), osascript (macOS), xdotool (Linux X11)
- Configurable quick-actions hotkey

### Files added (in v0.2.0)

- 50+ source files across `src/main`, `src/renderer`, `src/preload`, `src/shared`
- ~12,000 lines of TypeScript and JSX

---

## v0.1.0 — 2026-04-07 (internal)

- Initial Electron rewrite from the WinUI prototype
- Floating ball UI proof of concept
- Basic chat with Ollama
- 11-category PII redaction ported from C#
