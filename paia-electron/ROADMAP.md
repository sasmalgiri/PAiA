# PAiA Roadmap

## Phase 1 — MVP (this release)

### Core
- [x] Floating ball with drag-anywhere positioning, position persisted
- [x] Click-to-expand panel with smooth window resize
- [x] Onboarding wizard (3 steps: welcome, model, preferences)
- [x] React + esbuild renderer bundler
- [x] Light / dark / system theme

### Chat
- [x] Multi-thread conversations with sidebar
- [x] Persistent local SQLite history (sql.js, no native deps)
- [x] Streaming token-by-token rendering
- [x] Markdown + syntax-highlighted code blocks (marked + highlight.js)
- [x] Per-message copy button on code blocks
- [x] Auto-titled threads from first user message
- [x] Slash commands (/summarize, /translate, /explain, /fix, /shorten, /expand, /code, /tone, /clear, /new, /screen)
- [x] Personas (7 built-ins + user-defined)
- [x] Per-conversation persona + model override

### Voice
- [x] Whisper STT (offline, lazy-loaded)
- [x] Chromium STT
- [x] OS TTS via SpeechSynthesis
- [x] Mic capture with AudioContext + 16kHz resampling

### Screen
- [x] Full-screen capture via desktopCapturer
- [x] Tesseract.js OCR (lazy-loaded, cached per language)
- [x] /screen slash command + 📸 button → "what's on my screen?"

### Models
- [x] In-app Ollama model browser (list / pull with progress / delete)
- [x] Default-model picker with auto-fallback if model is removed
- [x] Cloud-models opt-in toggle (UI only — providers TBD in Phase 2)

### Settings
- [x] 6-tab settings view: General · Models · Personas · Voice · Hotkeys · About
- [x] Configurable global hotkeys (show/hide, capture, push-to-talk)
- [x] Always-on-top toggle
- [x] Start at login

### Distribution
- [x] electron-updater scaffolding (GitHub Releases)
- [x] electron-log rotating files
- [x] Single-instance lock
- [x] Tray icon with show/hide/capture/quit
- [x] Multi-platform electron-builder targets (NSIS / DMG / AppImage / deb)
- [x] GitHub Actions CI building all 3 platforms on tag

## Phase 2 — Differentiator features

- [x] **RAG**: sql.js + Ollama `nomic-embed-text` embeddings, knowledge stacks, citations
- [x] **Vision**: image attachments → llava / moondream — drag/drop, paste, `/image`, vision-model warning
- [x] **Region screen capture** with drag-to-select overlay window
- [x] **MCP client** (Model Context Protocol) with approval flow
- [x] **Web search tool** with redaction (DuckDuckGo HTML, no API key)
- [ ] **Wake word** ("Hey PAiA") via Picovoice Porcupine — see [PHASE2_NOTES.md](PHASE2_NOTES.md) §J
- [x] **Active window awareness** (Win32 PowerShell + osascript + xdotool)
- [x] **Quick actions on selected text** (Ctrl+Alt+Q → clipboard → 8-button popup → fresh thread)
- [ ] **Auto-update wired up** to a real GitHub release feed — already scaffolded, see [PHASE2_NOTES.md](PHASE2_NOTES.md) §L
- [x] **Cloud provider plugins** (OpenAI, Anthropic, OpenAI-compatible) — gated by `allowCloudModels`
- [ ] **Local TTS** via Piper — see [PHASE2_NOTES.md](PHASE2_NOTES.md) §K

## Phase 3 — Sellable

- [ ] **Code signing** (Authenticode for Windows, Developer ID for Mac)
- [ ] **Notarized macOS DMG**
- [ ] **License key system** (Ed25519, offline-validatable, with online activation)
- [ ] **Stripe / LemonSqueezy** integration
- [ ] **Free vs Pro feature gating**
- [ ] **Crash reporting** (self-hosted GlitchTip)
- [ ] **Privacy policy + ToS + EULA** (lawyer-reviewed)
- [ ] **Closed beta**
- [ ] **Public launch + marketing site updates**

## Phase 4 — Scale

- [ ] **Localization** (es, fr, de, hi, ja, zh)
- [ ] **Accessibility audit**
- [ ] **Plugin SDK**
- [ ] **Multi-window detachable chats**
- [ ] **Browser-use loop** (sandboxed agentic browsing)
- [ ] **Encrypted cloud sync** (E2E, opt-in)
- [ ] **Mobile companion** (read-only at first)
- [ ] **API server mode** for power users

## Phase 5 — Agentic (shipped)

- [x] **Agent orchestrator** — multi-step plan→act→observe loop, per-tool approval, step budget, audit log, 3 autonomy tiers (manual / assisted / autonomous)
- [x] **Built-in tool registry** — web.search, web.fetch, fs.read/write/list, shell.exec, screen.capture, screen.ocr, clipboard.read/write, window.active, window.openUrl, rag.query, memory.save, memory.recall, artifact.create, artifact.update
- [x] **Deep Research pipeline** — query decomposition, multi-pass search, page fetching, cited synthesis, streamed progress
- [x] **Canvas / artifacts** — versioned code/markdown/html/svg/json docs the agent and user can iterate on in a side panel
- [x] **Cross-session memory** — user / preference / fact / episode scopes; vector-searchable; auto-injected into chats
- [x] **Connectors** — Gmail, Google Calendar, Google Drive, GitHub, Slack via loopback OAuth + PKCE; tokens stored locally; tools auto-register with the agent
- [x] **Scheduler** — cron, interval, one-shot triggers; can fire agent runs, research runs, or prompts; results persist to a dedicated thread

## Phase 6 — Lab / classroom control (shipped)

- [x] **Classroom mode** — teacher/student roles; LAN HTTP server on the teacher machine; students join with a 6-letter signed code
- [x] **Policy enforcement** — allowed apps / URLs, blocked URLs, agent/shell/fs/web/cloud toggles, panel lock, heartbeat interval
- [x] **Active-window focus monitor** — student's PAiA polls their foreground window and flags off-task activity
- [x] **Teacher dashboard** — live roster (online/offline/violations), activity feed, broadcast bar, end-for-all
- [x] **Student lock overlay** — non-dismissible while in session; shows policy, current focus status, incoming teacher messages
- [x] **Agent integration** — classroom policy consulted before every tool call + at chat-time for cloud providers
- [x] OS-level enforcement — per-OS scripts that write real firewall / hosts / iptables rules with UAC/sudo prompts, reversed on release, with crash-safe self-heal

## Phase 7 — Differentiators (shipped)

- [x] **Ambient / proactive mode** — background watcher that samples clipboard + active window; pops suggestions for error debugging, clipboard questions, URL summaries, long-idle editing
- [x] **Multi-agent team** — planner/researcher/coder/reviewer/writer blackboard loop with per-role model selection and reviewer-driven revise cycles
- [x] **Plugin SDK** — drop-in plugin folders with manifest-declared tool / ambient-trigger / slash-command contributions; enable-to-trust
- [x] **Command palette** — ⌘/Ctrl+K fuzzy-search across threads, artifacts, memory, slash commands, actions, settings
- [x] **Native notifications** — agent completion, ambient suggestions
- [x] **Duplex voice** — continuous-listen mode auto-submits on trailing silence

## Phase 8 — Final frontier (shipped)

- [x] **Browser-use agent** — sandboxed hidden BrowserWindow in its own partition; eight vetted tools (goto/back/click/type/scroll/waitFor/screenshot/state)
- [x] **Image + video generation** — OpenAI, Stability, Replicate, fal.ai, ComfyUI, Automatic1111 behind one dispatcher
- [x] **E2E encrypted cloud sync** — AES-256-GCM per object, PBKDF2 KDF, HMAC-derived filenames, folder + WebDAV backends
- [x] **Mobile companion** — LAN HTTP server with inline PWA, bearer-token pairing, SSE-streamed replies through the desktop's full chat pipeline

## Phase 9 — Remaining roadmap (shipped)

- [x] **Attachment streaming in E2E sync** — chunked AES-256-GCM, per-chunk IV/tag, HMAC filenames; handles images/PDFs up to 100 MB without loading whole into memory
- [x] **ComfyUI workflow invocation** — ships a default txt2img graph, supports user-provided `comfyui-workflow.json` with placeholder substitution
- [x] **Cross-machine remote browser** — CDP-over-WebSocket client with eight `remote.*` tools matching the local browser agent surface
- [x] **Offline Whisper streaming** — VAD-segmented with adaptive noise floor; each utterance transcribed on the pause
- [x] **S3-compatible sync** — pure-TS SigV4 signing; works against AWS, R2, B2, MinIO, Wasabi

## Phase 10 — Future hooks (shipped)

- [x] **S3 multipart upload** — >64 MB blobs auto-switch to InitiateMultipart / UploadPart / Complete with abort-on-failure
- [x] **Streaming Whisper decode** — TextStreamer per-token callback into IPC; renderer paints the stream live and normalises on final
- [x] **Local Chromium orchestrator** — probe install paths, spawn with remote-debugging-port + disposable profile, auto-connect, clean up on exit
- [x] **Code-signing scaffolding** — preflight validator, afterSign notarize hook, GitHub Actions strict check on tags, SIGNING.md end-to-end playbook

### Phase 3 ship-blockers (newly unblocked by Phase 10)

- [x] Scaffolding to produce **signed Windows NSIS installer** (awaits cert purchase)
- [x] Scaffolding to produce **notarized macOS DMG** (awaits Apple Developer enrolment)

## Phase 4 + launch scaffolding (shipped in v0.9.0)

- [x] **Localization** — i18n runtime + English catalog + six partial translations (es/fr/de/hi/ja/zh) with graceful fallback; Language picker in Settings → General
- [x] **Accessibility audit** — focus trap for modals, ARIA roles on dialogs, live regions on the message list, prefers-reduced-motion, forced-colors, aria-labels on every icon-only button
- [x] **Multi-window detachable chats** — per-thread BrowserWindow with full Panel feature parity
- [x] **Local API server mode** — bearer-auth REST on `127.0.0.1` for Raycast / Alfred / Shortcuts / CLI scripts
- [x] **Closed-beta scaffolding** — Ed25519-signed invites, invite-issuer CLI, in-app feedback widget with retry queue
- [x] **Legal templates** — EULA / Privacy / Terms / Acceptable Use / DPA / Subprocessors / Responsible Disclosure, every one clearly labelled as requiring lawyer review

## Phase 11 — Jarvis gap (shipped in v0.10.0)

- [x] **Autopilot** — ambient triggers → automatic agent/research/chat/canvas actions inside user-set daily caps, cooldowns, and allowed hours, with full audit log
- [x] **Home Assistant reference plugin** — nine tools spanning the full HA surface; bridges HomeKit / Matter / Zigbee / Z-Wave; drop-in install with a single config.json
