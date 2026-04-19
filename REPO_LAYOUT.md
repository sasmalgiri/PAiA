# PAiA — Repository layout

A complete map of what's where, why, and whether it's active.

## Top level

```
D:/PAiA/
├── README.md              ← Start here. Explains the dual-product situation.
├── README.legacy.md       ← The original README from the WinUI prototype era.
├── REPO_LAYOUT.md         ← This file.
├── LICENSE                ← MIT license, applies to the legacy WinUI prototype.
├── CLAUDE.md              ← Project memory file consumed by Claude Code.
│
├── paia-electron/         ← 🟢 ACTIVE — the current cross-platform product.
├── website/               ← 🟢 ACTIVE — the marketing site (paia.app).
│
├── PAiA.WinUI/            ← 🟡 LEGACY — Windows-only WinUI 3 prototype.
├── PAiA.Tests/            ← 🟡 LEGACY — xUnit tests for the prototype.
├── PAiA.sln               ← 🟡 LEGACY — Visual Studio solution for the prototype.
├── Installer/             ← 🟡 LEGACY — uninstall.bat for the WinUI version.
├── publish.ps1            ← 🟡 LEGACY — PowerShell publish script for the prototype.
├── ARCHITECTURE.md        ← 🟡 LEGACY — architecture doc for the WinUI version.
├── FAQ.md                 ← 🟡 LEGACY — FAQ for the WinUI version.
├── GETTING_STARTED.md     ← 🟡 LEGACY — getting-started for the WinUI version.
├── PRIVACY.md             ← 🟡 LEGACY — privacy doc for the WinUI version.
│
├── PAiA/                  ← 🔴 DUPLICATE — an older nested copy of the prototype.
│                              Safe to archive or delete. Predates this layout.
├── files/                 ← 🔴 DUPLICATE — a snapshot folder containing yet
│                              another copy of the prototype, plus an HTML site.
└── files.zip              ← 🔴 ARCHIVE — zipped copy of `files/`.
```

**Legend:**
- 🟢 active, ship this
- 🟡 legacy but kept for reference
- 🔴 redundant — candidates for the cleanup script

## Active: `paia-electron/`

The Electron 33 + React 18 + TypeScript product. ~16.5K LOC, 48 unit tests, multi-platform installers.

```
paia-electron/
├── package.json                   ← npm + electron-builder config + version
├── tsconfig.main.json             ← main process + preload TypeScript config
├── tsconfig.renderer.json         ← React renderer TypeScript config
├── CHANGELOG.md                   ← release notes
├── README.md                      ← full product reference
├── ROADMAP.md                     ← phase 1 / 2 / 3 / 4 plan
├── OPERATIONS.md                  ← THE master launch checklist
├── DISTRIBUTION.md                ← code-signing + license-key playbook
├── SUPPORT.md                     ← customer support runbook
├── PHASE2_NOTES.md                ← Phase 2 implementation notes
├── LICENSE                        ← EULA template (needs lawyer review)
├── THIRD-PARTY-NOTICES.md         ← OSS attribution
│
├── .github/workflows/
│   └── build.yml                  ← CI: lint + test + build all 3 platforms
│
├── assets/
│   ├── icon.svg                   ← source vector
│   ├── icon.png                   ← generated 1024×1024 (gitignored)
│   ├── icon.ico                   ← Windows multi-size (gitignored)
│   ├── icon.icns                  ← macOS multi-size (gitignored)
│   ├── entitlements.mac.plist     ← macOS hardened runtime entitlements
│   └── README.md                  ← icon generation instructions
│
├── scripts/
│   ├── build-renderer.mjs         ← esbuild bundler entry
│   ├── build-icons.mjs            ← sharp + png2icons icon generator
│   ├── copy-renderer.mjs          ← copies HTML/CSS + sql.js wasm to dist/
│   ├── run-electron.mjs           ← launcher (strips ELECTRON_RUN_AS_NODE)
│   ├── issue-license.mjs          ← Ed25519 license signing CLI
│   └── release-preflight.sh       ← runs every gate before tagging
│
├── server/                        ← standalone license webhook server
│   ├── license-server.mjs         ← zero-dep Node HTTP server
│   ├── README.md                  ← deployment guide
│   └── deploy/
│       ├── install.sh             ← one-shot Ubuntu deploy script
│       ├── paia-license.service   ← hardened systemd unit
│       ├── nginx.conf             ← nginx vhost
│       └── .env.example           ← env template (NEVER commit real values)
│
├── templates/
│   ├── BETA_WELCOME_EMAIL.md      ← beta tester onboarding
│   └── BETA_SMOKE_CHECKLIST.md    ← 40-item walkthrough
│
└── src/
    ├── main/                      ← Electron main process (Node)
    │   ├── main.ts                ← window, tray, IPC handlers, lifecycle
    │   ├── db.ts                  ← sql.js SQLite (threads, messages, attachments, RAG)
    │   ├── settings.ts            ← JSON-file preferences
    │   ├── personas.ts            ← built-in + user personas
    │   ├── hotkeys.ts             ← global shortcut registration
    │   ├── screen.ts              ← desktopCapturer + tesseract.js OCR
    │   ├── region.ts              ← region capture overlay
    │   ├── whisper.ts             ← @huggingface/transformers STT
    │   ├── piper.ts               ← Piper TTS sidecar
    │   ├── wakeWord.ts            ← Picovoice Porcupine integration
    │   ├── activeWindow.ts        ← Win32 / macOS / X11 / Wayland active window
    │   ├── rag.ts                 ← chunking + embedding + retrieval pipeline
    │   ├── mcp.ts                 ← Model Context Protocol client
    │   ├── providers.ts           ← Ollama / OpenAI / Anthropic / OpenAI-compat dispatcher
    │   ├── webSearch.ts           ← DuckDuckGo HTML search
    │   ├── license.ts             ← Ed25519 verification, trial, gating
    │   ├── crashReporting.ts      ← Sentry main-process init (opt-in)
    │   ├── analytics.ts           ← zero-dep opt-in usage analytics
    │   ├── updater.ts             ← electron-updater wiring
    │   ├── logger.ts              ← electron-log
    │   └── menu.ts                ← application menu
    │
    ├── preload/
    │   └── preload.ts             ← contextBridge API surface (window.paia)
    │
    ├── renderer/                  ← React 18 + esbuild bundle
    │   ├── index.html             ← main panel page
    │   ├── region.html            ← region capture overlay page
    │   ├── styles.css             ← design system (light/dark/system themes)
    │   ├── index.tsx              ← React entry + renderer-side Sentry init
    │   ├── App.tsx                ← top-level state machine
    │   ├── region.ts              ← standalone overlay script
    │   ├── components/
    │   │   ├── Ball.tsx
    │   │   ├── Panel.tsx          ← main chat view
    │   │   ├── Sidebar.tsx        ← thread list
    │   │   ├── Message.tsx        ← markdown + code copy
    │   │   ├── Composer.tsx       ← input + slash menu + voice + drag/drop
    │   │   ├── Settings.tsx       ← 10-tab settings view
    │   │   ├── Onboarding.tsx     ← 3-step first-run wizard
    │   │   ├── QuickActions.tsx   ← Ctrl+Alt+Q popup
    │   │   └── McpApprovalModal.tsx
    │   └── lib/
    │       ├── api.ts             ← typed window.paia accessor
    │       ├── markdown.ts        ← marked + highlight.js setup
    │       └── slashCommands.ts   ← command registry
    │
    └── shared/                    ← used by both main + renderer + tests
        ├── types.ts               ← cross-process types
        ├── redaction.ts           ← 11-category PII redactor
        ├── ollama.ts              ← Ollama HTTP client
        ├── chunking.ts            ← RAG text chunker (extracted for tests)
        ├── ddgParser.ts           ← DuckDuckGo HTML parser (extracted for tests)
        ├── licenseVerify.ts       ← Ed25519 sign/verify (extracted for tests)
        ├── redaction.test.ts      ← 8 tests
        ├── chunking.test.ts       ← 7 tests
        ├── ddgParser.test.ts      ← 13 tests
        └── licenseVerify.test.ts  ← 7 tests
```

## Active: `website/`

```
website/
├── index.html         ← landing page
├── pricing.html       ← three plans + FAQ
├── privacy.html       ← privacy policy (template, lawyer review needed)
├── download.html      ← per-OS download cards
├── changelog.html     ← release notes
├── docs.html          ← user-facing documentation
├── styles.css         ← shared design system
└── index.old.html     ← preserved original landing page
```

## Active: `marketing/`

Launch copy ready to paste into the various surfaces.

```
marketing/
├── README.md          ← orientation
├── HACKERNEWS.md      ← Show HN post + first comment
├── PRODUCTHUNT.md     ← maker comment + tagline
├── REDDIT.md          ← per-subreddit posts (LocalLLaMA, selfhosted, etc.)
├── TWITTER.md         ← launch thread
├── LINKEDIN.md        ← professional-network post
└── BLOG_POST.md       ← long-form launch essay
```

## Legacy: `PAiA.WinUI/` + `PAiA.Tests/` + `PAiA.sln`

The original Windows-only WinUI 3 prototype. ~10K LOC of C# / .NET 8. Preserved because the architecture is documented, the redaction logic was ported into the Electron version, and nostalgia.

You can build this with Visual Studio 2022 + the .NET 8 SDK, but **it has never successfully compiled on Windows** — it was written in a Linux sandbox by an earlier instance and the Win32 / WinRT interop has not been fully validated. See [README.legacy.md](README.legacy.md) for context.

## Redundant: `PAiA/` and `files/`

- **`PAiA/`** — an older nested copy of the WinUI prototype from before the repo was flattened. Predates the current layout. Safe to archive or delete; nothing imports from it.
- **`files/`** — a snapshot folder containing yet another copy of the prototype plus an early HTML site. Originally used for offering downloadable archives.
- **`files.zip`** — zipped copy of `files/`.

The cleanup script ([cleanup-repo.sh](cleanup-repo.sh)) can move all of these into a single `legacy/` folder for you, non-destructively, if you want a tidier top level. **It does not delete anything.**

## What gets committed vs what doesn't

| Path | Tracked | Notes |
|---|---|---|
| `paia-electron/src/**` | ✅ | All source files |
| `paia-electron/scripts/**` | ✅ | Build + release helpers |
| `paia-electron/server/**` | ✅ | License webhook server |
| `paia-electron/templates/**` | ✅ | Beta tester emails |
| `paia-electron/assets/icon.svg` | ✅ | Source vector |
| `paia-electron/assets/icon.{png,ico,icns}` | ❌ | Generated by `build-icons.mjs` |
| `paia-electron/assets/entitlements.mac.plist` | ✅ | macOS hardened runtime |
| `paia-electron/dist/` | ❌ | Build output |
| `paia-electron/release/` | ❌ | electron-builder output |
| `paia-electron/node_modules/` | ❌ | Dependencies |
| `paia-electron/.keys/` | ❌ | License signing keys — NEVER commit |
| `website/**` | ✅ | All marketing pages |
| `marketing/**` | ✅ | Launch copy |
| `PAiA.WinUI/`, `PAiA.Tests/`, `PAiA.sln` | ✅ | Legacy prototype |
| `PAiA/`, `files/`, `files.zip` | ✅ (currently) | Redundant — candidates for cleanup |

## Where everything lives at runtime (per user)

This is what gets created on the **end user's** machine after they install and use PAiA:

| Path (Windows) | Path (macOS) | Path (Linux) | What |
|---|---|---|---|
| `%APPDATA%/paia/paia.sqlite` | `~/Library/Application Support/paia/paia.sqlite` | `~/.config/paia/paia.sqlite` | Chat history + RAG collections + messages |
| `%APPDATA%/paia/settings.json` | `~/Library/Application Support/paia/settings.json` | `~/.config/paia/settings.json` | User preferences |
| `%APPDATA%/paia/personas.json` | `~/Library/Application Support/paia/personas.json` | `~/.config/paia/personas.json` | Custom personas |
| `%APPDATA%/paia/license.json` | (same) | (same) | Activated license |
| `%APPDATA%/paia/trial.json` | (same) | (same) | Trial start date |
| `%APPDATA%/paia/anonymous-id.txt` | (same) | (same) | Opt-in analytics ID (only if enabled) |
| `%APPDATA%/paia/transformers-cache/` | (same) | (same) | Cached Whisper models |
| `%APPDATA%/paia/tesseract-cache/` | (same) | (same) | Cached OCR language models |
| `%APPDATA%/paia/piper/` | (same) | (same) | Cached Piper binary + voices |
| `%APPDATA%/paia/mcp.json` | (same) | (same) | MCP server configurations |
| `%APPDATA%/paia/providers.json` | (same) | (same) | Cloud provider API keys |
| `%APPDATA%/paia/logs/` | (same) | (same) | Rotating electron-log files |

None of these are tracked in git. None of them ever leave the user's machine.
