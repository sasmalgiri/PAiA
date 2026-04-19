# Phase 2 — implementation notes

This file documents what shipped in Phase 2 and what was deliberately
deferred. See [ROADMAP.md](ROADMAP.md) for the Phase 3 / Phase 4 list.

## Shipped in Phase 2

| Feature | File(s) | Status |
|---|---|---|
| **Web search with PII redaction** (DuckDuckGo HTML, no API key) | [src/main/webSearch.ts](src/main/webSearch.ts) | ✅ done |
| **`/search <query>`** slash command | [src/renderer/lib/slashCommands.ts](src/renderer/lib/slashCommands.ts) + [Panel.tsx](src/renderer/components/Panel.tsx) | ✅ done |
| **Vision polish**: drag/drop images on the composer, paste images from clipboard, vision-model warning | [Composer.tsx](src/renderer/components/Composer.tsx) | ✅ done |
| **`/image`** slash command (uses Electron clipboard for reliable image read) | [Panel.tsx](src/renderer/components/Panel.tsx) + [main.ts](src/main/main.ts) | ✅ done |
| **Quick actions on selected text** — Ctrl+Alt+Q reads clipboard → 8-button popup → spawns a fresh thread with the right prompt | [src/renderer/components/QuickActions.tsx](src/renderer/components/QuickActions.tsx) + [main.ts](src/main/main.ts) | ✅ done |
| **Active window awareness** — opt-in setting that injects "user's foreground window was X in Y" into the system prompt | [src/main/activeWindow.ts](src/main/activeWindow.ts) | ✅ done |
| Quick-actions hotkey configurable in Settings → Hotkeys | [Settings.tsx](src/renderer/components/Settings.tsx) | ✅ done |

### Active window — platform support matrix

| OS | Method | Requires |
|---|---|---|
| **Windows** | PowerShell shells out to `Add-Type` and calls `GetForegroundWindow` from user32.dll | Nothing — PowerShell ships with Windows |
| **macOS** | `osascript` → System Events | Nothing — but the user must grant **Accessibility** permission in System Settings the first time |
| **Linux** | `xdotool getactivewindow getwindowname` | `xdotool` package installed; X11 only (Wayland is harder) |

### Web search — what to know

- Hits `https://html.duckduckgo.com/html/` with a POST form. No API key, no JS.
- The user's query is **PII-redacted** before being sent to DuckDuckGo (same 11 categories the chat path uses).
- Result snippets are NOT redacted on return — they're public web text and the LLM may need them verbatim to cite correctly.
- The HTML parser is hand-rolled (no cheerio/jsdom). It's tested against the current DDG lite layout, but if DDG changes their template the parser may break — fix in [webSearch.ts](src/main/webSearch.ts) `parseDuckDuckGoHtml`.
- For **Brave Search API** integration (better quality, requires a free API key) the right move is to add a second backend in webSearch.ts and let the user choose in Settings.

### Quick actions — UX flow

1. User selects text in any application
2. User hits **Ctrl+C** (the OS standard "copy" gesture)
3. User presses **Ctrl+Alt+Q** (configurable in Settings → Hotkeys)
4. PAiA reads the clipboard text, shows the popup (460×360) with the text + 8 action buttons:
   - 💡 Explain · 📝 Summarize · 🌐 Translate · ✍️ Rewrite
   - 🛠 Fix · 🤝 Friendlier tone · ✂️ Shorten · 📖 Expand
5. Clicking an action creates a **brand-new thread** so quick-action results don't pollute the user's main conversation history, then sends the prompt and switches to the panel view to watch the streaming response.

> **Why not "actually read the OS selection"?** Reading the live text selection (not the clipboard) requires platform-specific accessibility APIs — UIAutomation on Windows, NSAccessibility on macOS, AT-SPI on Linux. All three are real but require the user to grant accessibility permission, and they require platform-specific bindings (which means native modules and the install pain we've been dodging). The clipboard hack is what Raycast, Alfred, and PopClip use in practice.

## Deliberately deferred — and why

### J. Wake word ("Hey PAiA")

**Status:** scaffolded but not shipped.

**Why deferred:**
- The only solid options are commercial: **Picovoice Porcupine** is the gold standard (free for personal use, commercial license costs $$ per active user) and **Snowboy** is dead.
- Continuous local STT via Whisper-streaming (open source) burns 5–15% CPU on a modern laptop *just to listen* — that's not acceptable for an "always-on" background process on a privacy-first product.
- Honest answer: this should be a Pro feature with a single warning at first run ("wake word listens continuously, here's the CPU cost"), and the integration is ~200 lines of glue code once you decide on the engine.

**To ship it later:**
1. Create a Picovoice Console account, get an access key
2. Add `@picovoice/porcupine-node` as a dep
3. Write `src/main/wakeWord.ts` that loads the user's access key from a new field in `providers.json`-style config
4. Spawn a worker thread (so the main loop isn't blocked) running `Porcupine.process()` on raw mic frames
5. On detection, fire `mainWindow.webContents.send('paia:wake-word-detected')` which triggers PTT mode
6. Add a "Wake word access key" field in Settings → Voice
7. Document the privacy implications loudly

### K. Local TTS via Piper

**Status:** not shipped.

**Why deferred:**
- Piper is a fantastic engine but it ships as a **C++ binary**, not as a node module. Bundling means including the right Piper binary for each of Windows / macOS-x64 / macOS-arm64 / Linux-x64, plus voice model files (~30–60 MB each), plus a sidecar process management layer to talk to it over stdio.
- That's a 100–250 MB increase to the installer just for "the assistant talks slightly nicer than the OS voice."
- The current `window.speechSynthesis` path is **fully offline** on every desktop OS — Windows uses SAPI, macOS uses NSSpeechSynthesizer, Linux uses speech-dispatcher. The voices aren't as good as Piper's but they're zero-cost and don't bloat the installer.

**To ship it later:**
1. Download Piper binaries for all 4 target platforms during the electron-builder `extraResources` step
2. Write `src/main/piperTts.ts` that finds the right binary at runtime via `process.platform`/`process.arch`
3. Spawn it as a child process with `--model voice-en_US-amy-medium.onnx` (or whatever the user picks)
4. Pipe text in via stdin, receive WAV bytes on stdout
5. Play the WAV in the renderer via `new Audio(blob)`
6. Add Settings → Voice → "TTS engine: System / Piper"
7. Add a voice model browser (download from huggingface) — similar UX to the Whisper path

If you want, I can do this as its own pass — it's about a day of focused work and 2–3 new files, but it's heavy enough that I didn't want to bury it inside an "all of Phase 2" sprint.

### L. Auto-update wiring

**Status:** ALREADY WIRED. Just needs your real GitHub repo.

**What to do:**
1. Create a public GitHub repo (or use a private one + a publish token)
2. Edit [package.json](package.json) → `build.publish`:
   ```json
   "publish": [
     {
       "provider": "github",
       "owner": "your-github-username-or-org",
       "repo": "paia"
     }
   ]
   ```
3. Tag a release: `git tag v0.3.0 && git push origin v0.3.0`
4. The CI workflow at [.github/workflows/build.yml](.github/workflows/build.yml) builds all 3 platforms on the tag and uploads installers as a GitHub Release
5. The running app polls `https://github.com/your-org/paia/releases/latest` via electron-updater and notifies users 30 seconds after launch
6. When the user clicks "Download" the installer downloads in the background, then "Install" restarts the app with the new version

This is **unsigned** until you wire up code-signing certs (see [DISTRIBUTION.md](DISTRIBUTION.md) §2 and §3).

## Things to test by hand on the next build

These are wired but I haven't been able to send live traffic in this dev environment:

| Path | How to verify |
|---|---|
| `/search` slash command | Type `/search how does the speed of light work` and check that 8 results render |
| Web search redaction | Type `/search my email is foo@bar.com` and confirm the query the LLM sees has `[EMAIL-REDACTED]` not the address |
| Image drag-drop | Drag any PNG onto the chat composer, watch the chip appear |
| Image clipboard paste | Copy a screenshot, click in the composer, Ctrl+V — chip should appear |
| `/image` command | Same setup, type `/image what is in this picture?` |
| Vision warning | Attach an image while a non-vision model is selected — yellow banner should appear |
| Quick actions hotkey | Select text in Notepad, Ctrl+C, Ctrl+Alt+Q — the popup should appear with your text + 8 buttons |
| Active window context | Toggle "Include active window context" in Settings → General. Open Notepad, switch to PAiA, ask "what app was I just in?" — the answer should mention notepad |
