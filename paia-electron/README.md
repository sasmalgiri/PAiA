# PAiA — Privacy-first AI desktop assistant

A floating ball that lives in the corner of your screen. Click it to chat,
talk, or capture your screen — everything runs locally on your machine.

> **Status:** v2.0.0 — Mixture of Experts release. See [CHANGELOG.md](CHANGELOG.md) for the full feature set and [ROADMAP.md](ROADMAP.md) for what's next.

## Why PAiA exists

Most "AI assistants" send your screen, your voice, and your context to
someone else's servers. PAiA is the opposite — your prompts, files, and
audio stay on your machine by default.

| Concern | PAiA's answer |
|---|---|
| Where do my prompts go? | A local Ollama daemon (loopback only). |
| Where is my voice transcribed? | Whisper running on your CPU (or Chromium STT if you opt in). |
| Where is my screen processed? | Tesseract OCR on your CPU. |
| Where is my history stored? | A SQLite file in your user data dir. |
| What gets sent to "the cloud"? | Nothing, unless you explicitly enable cloud model providers in Settings → General. |
| What about PII in my prompts? | 11 categories (cards, SSNs, emails, phones, IPs, AWS keys, GitHub tokens, generic API keys, JWTs, private keys, connection strings) are detected and redacted **before** any prompt leaves the renderer process. |

## Feature highlights

### The ball
- Tiny glowing orb in the bottom-right of your screen.
- Drag it anywhere. Position persists across launches.
- Click to expand into a chat panel; click × to collapse back.
- Optional **always-on-top** mode floats above every other app, including fullscreen.
- System tray icon for show/hide/capture/quit.
- Configurable global hotkeys: show/hide, capture screen, push-to-talk.

### Multi-thread chat
- Sidebar of all your conversations, sorted by last activity, pinned threads first.
- Auto-titled from your first message.
- Per-conversation persona + model override.
- Markdown rendering with syntax-highlighted code blocks (one-dark for dark theme, one-light for light theme).
- Copy button on every code block.
- File attachments (drag images, drop text/markdown/JSON/CSV files).
- Streaming responses, token by token.

### Personas (Mixture of Experts pool — 56 built-ins + user-defined)

Seven foundational personas (Default · Code Helper · Writing Assistant · Translator · Researcher · Brainstormer · Privacy Auditor) plus 49 professional specialists covering engineering, science, medical, legal, business, creative, education, and ops domains.

Each persona can be bound to its own knowledge stacks (Settings → Personas → "Bind knowledge…"). When that persona is active, its stacks are auto-queried alongside any the thread already had.

The smart router (Settings → Personas → Smart router) picks the best 1–N personas per query — semantic pre-filter via embeddings, then a fast LLM rerank. Run as `single` (auto-switches persona) or `council` (fires N parallel expert calls and synthesises).

Create your own with a name, emoji, system prompt, and optional knowledge stack bindings.

### Slash commands
Type `/` to see the menu. Built-ins include:

| Command | What it does |
|---|---|
| `/summarize <text>` | 3–5 bullet summary |
| `/translate <target> \| <text>` | Translate with explicit target language |
| `/explain <text>` | Explain like I'm smart but unfamiliar |
| `/fix <text>` | Fix grammar/spelling, preserve meaning |
| `/shorten <text>` | Make it shorter |
| `/expand <text>` | Make it longer with structure |
| `/code <description>` | Generate code |
| `/tone <tone> \| <text>` | Rewrite in a different tone |
| `/screen` | Capture screen + OCR + ask "what's on my screen?" |
| `/council <question>` | Fire N parallel expert calls (router-picked or manual) and synthesise a merged reply |
| `/experts <question>` | Alias for `/council` |
| `/longread <question>` | Map-reduce over the most recent attached PDF/text file with chunk-level provenance |
| `/agent <goal>` | Start an autonomous agent run (plan → act → observe, per-tool approval gate) |
| `/research <question>` | Run the Deep Research pipeline (decompose → search → fetch → cited synthesis) |
| `/canvas` | Open the side-panel artifact editor |
| `/remember <fact>` / `/recall <query>` | Cross-session memory operations |
| `/new` | Start a new conversation |
| `/clear` | Delete the current conversation |

### Voice
Two STT engines, switchable in Settings → Voice:

- **Chromium** (`webkitSpeechRecognition`) — fastest, may use a network speech service depending on platform.
- **Whisper** (`Xenova/whisper-tiny` via `@huggingface/transformers`) — fully offline once the ~75 MB model is cached. Audio is captured at the OS sample rate, resampled to 16 kHz mono in `OfflineAudioContext`, then sent to the main process as `Float32Array` PCM.

TTS uses `speechSynthesis` (OS-native voices, fully offline).

### Screen capture + OCR
- 📸 button or `/screen` command captures your primary display.
- Tesseract.js OCRs the result (English by default, lazy-loaded).
- The OCR text is automatically attached to a chat message asking the assistant to interpret it.
- The screenshot is also attached as an image — vision-capable models like `llava` see it directly.

### Settings (24 tabs in 6 groups, with live keyword search)

Search at the top of Settings jumps to any tab by name, label, or curated keyword (e.g. typing `gmail`, `cron`, `voice`). Tabs are grouped as Basics / AI & chat / Power features / Network & devices / Classroom & lab / Account.

- **Basics** — General, Models (with the hardware-aware Model Store), Personas (incl. router + cloud escalation), Voice, Hotkeys, About
- **AI & chat** — Knowledge (RAG), Memory, Tools (MCP servers), Connectors, Schedule, Agent
- **Power features** — Ambient, Plugins, Canvas, Whiteboard, Browser
- **Network & devices** — Companion, Sync, API server, Remote browser
- **Classroom & lab** — Classroom mode, Enforcement
- **Account** — License, Beta, Privacy (including the observability-inspector opt-out)

### First-run wizard

Five steps: language → connect Ollama (with the hardware-aware Model Store recommending sizes for your machine) → privacy preferences → quick-start tips. Cloud providers (OpenAI / Anthropic) are available as a fallback path if you'd rather skip Ollama.

### Distribution
- electron-builder targets: **Windows NSIS**, **macOS DMG** (x64 + arm64), **Linux AppImage + deb**
- electron-updater configured for GitHub Releases (set `build.publish.owner` in `package.json`)
- Single-instance lock — second launch focuses the existing window
- Rotating log files in `userData/logs` via electron-log
- GitHub Actions CI builds all three platforms on every push and publishes installers on tag

## Architecture

```
src/
  main/                # Electron main process (Node)
    main.ts            # Window, tray, IPC handlers, lifecycle
    db.ts              # sql.js SQLite — threads / messages / attachments
    settings.ts        # JSON-file preferences
    personas.ts        # Built-in + user personas
    hotkeys.ts         # Global shortcut registration
    screen.ts          # desktopCapturer + tesseract.js OCR
    whisper.ts         # @huggingface/transformers STT
    updater.ts         # electron-updater wiring
    logger.ts          # electron-log
    menu.ts            # Application menu

  preload/
    preload.ts         # Narrow contextBridge API surface

  shared/              # Used by both main and renderer
    types.ts           # All cross-process types
    redaction.ts       # 11-category PII redactor
    redaction.test.ts  # Vitest unit tests
    ollama.ts          # Ollama HTTP client (chat, pull, delete)

  renderer/            # React + esbuild bundle
    index.html
    index.tsx          # Entry — mounts <App/>
    App.tsx            # Top-level state, view machine
    styles.css
    components/
      Ball.tsx
      Panel.tsx        # Main chat view
      Sidebar.tsx      # Thread list
      Message.tsx      # Markdown rendering with code copy
      Composer.tsx     # Input + slash menu + attachments + voice
      Settings.tsx     # 6-tab settings
      Onboarding.tsx   # First-run wizard
    lib/
      api.ts           # Typed window.paia accessor
      markdown.ts      # marked + highlight.js setup
      slashCommands.ts # Command registry
```

### Process boundaries

- **Main process** has Node + Electron APIs. Owns the database, the window, the tray, and all IPC handlers.
- **Preload script** runs in a sandboxed Node-like context with the renderer's `window`. Exposes one global, `window.paia`, with a typed surface — every method maps to one `ipcMain.handle`.
- **Renderer** runs in Chromium with `contextIsolation: true`, `nodeIntegration: false`. It can only call methods on `window.paia` and use standard browser APIs (DOM, AudioContext, getUserMedia, fetch to localhost).

The renderer cannot read your filesystem, your environment, or your processes — only what the preload bridge explicitly exposes.

## Prerequisites

- **Node.js 20+** (24 tested) for development
- **Ollama** running locally with at least one model:
  ```
  ollama pull llama3.2
  ```

## Run in dev

```bash
cd paia-electron
npm install
npm run dev
```

The build runs in two passes:
1. `tsc -p tsconfig.main.json` compiles the main process + preload + shared modules
2. `node scripts/build-renderer.mjs` runs **esbuild** on `src/renderer/index.tsx` and emits a single `dist/renderer/renderer.js` IIFE bundle
3. `node scripts/copy-renderer.mjs` copies the static HTML/CSS assets into `dist/renderer/` and the sql.js wasm into `dist/main/`

> **Heads-up about `ELECTRON_RUN_AS_NODE`:** if your shell exports this variable (some debug tooling does), Electron silently behaves as plain Node and the app crashes with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`. The `npm run dev` script goes through [scripts/run-electron.mjs](scripts/run-electron.mjs) which strips the variable from the spawned environment, so you should never see this. If you ever invoke `electron .` directly and hit it, `unset ELECTRON_RUN_AS_NODE` and retry.

## Build a Windows installer

```bash
npm run dist:win
```

Produces `release/PAiA-Setup-<version>.exe` (NSIS, x64). **Unsigned** — Windows SmartScreen will warn until you buy a code-signing certificate. See [ROADMAP.md](ROADMAP.md) Phase 3.

## Build all platforms (CI)

GitHub Actions builds Windows, macOS, and Linux installers on every push. To cut a release:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The tag triggers a job that publishes signed-by-name (not yet signed-by-cert) installers to GitHub Releases.

## Tests

```bash
npm test
```

Currently 8 unit tests covering the redaction service. RAG, OCR, and database tests are next.

## Known limitations

| Limitation | Plan |
|---|---|
| No code signing — Windows shows SmartScreen warning, macOS shows "unidentified developer" | Phase 3, requires real cert ($) |
| Whisper model downloads from HuggingFace on first use | Acceptable — once cached, fully offline. Future: bundle the model or offer Phase-2 sidecar whisper.cpp |
| Chromium STT may use a network speech service depending on platform | Documented in Settings → Voice. Whisper engine is the offline alternative. |
| First Ollama pull happens through the user's connection | This is Ollama's normal behavior; we just trigger it. |
| No RAG yet — files attached to chat are sent verbatim, capped at 200 KB | Phase 2 |
| No region screen capture (only full primary display) | Phase 2 |
| Tray icon is empty (no .ico bundled) | Add real artwork before public release |
| No code signing on the auto-updater feed | Phase 3 |

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Electron 33 | Cross-platform, mature, real native APIs when needed |
| UI | React 18 | Standard. Functional components + hooks, no state library |
| Bundler | esbuild | Fast, simple, no config file |
| Type system | TypeScript strict mode | Refactor confidence |
| Database | sql.js | Real SQLite via WebAssembly. Zero native build deps. |
| LLM runtime | Ollama (HTTP, loopback) | Best-in-class local model runner |
| STT (offline) | `@huggingface/transformers` Whisper-tiny | Onnxruntime, lazy-loaded, ~75 MB |
| STT (fast) | `webkitSpeechRecognition` | Built into Chromium |
| TTS | `window.speechSynthesis` | OS-native, fully offline |
| OCR | `tesseract.js` | WASM, lazy-loaded per language |
| Markdown | `marked` + `marked-highlight` | Mature, fast, GFM-compatible |
| Code highlighting | `highlight.js` (common subset) | Smaller bundle than full hljs |
| Logging | `electron-log` | Rotating files in userData |
| Auto-update | `electron-updater` | Wires into electron-builder + GitHub Releases |
| Packaging | `electron-builder` | NSIS, DMG, AppImage, deb, all in one config |

## License

Proprietary. Source available for inspection; see [LICENSE](../LICENSE).

The redaction library and shared types may be open-sourced separately under MIT in a future release.
