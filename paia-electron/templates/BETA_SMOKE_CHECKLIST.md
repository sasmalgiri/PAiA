# Beta smoke checklist

Run through this once after installing. ~15 minutes. **Mark each item as ✅, 🟡 (works but weird), or ❌ (broken).** Reply with the list.

## Setup

| # | Step | Result |
|---|---|---|
| 1 | Installer ran without errors | |
| 2 | App launched on first try | |
| 3 | Onboarding wizard appeared | |
| 4 | Onboarding detected Ollama (or guided you to install it) | |
| 5 | Pulling `llama3.2` worked from inside the wizard | |
| 6 | Onboarding finished, window collapsed to a ball | |

## The ball

| # | Step | Result |
|---|---|---|
| 7 | Ball appeared in screen corner | |
| 8 | Drag the ball to a new spot | |
| 9 | Quit + relaunch — ball is in the same place | |
| 10 | Click ball → panel expands | |
| 11 | Click × → panel collapses to ball | |

## Chat

| # | Step | Result |
|---|---|---|
| 12 | Send a message → streaming response appears | |
| 13 | Response renders Markdown (try asking for a table) | |
| 14 | Code block has a copy button that actually copies | |
| 15 | Start a second conversation from the sidebar | |
| 16 | Switch back to the first thread — history is intact | |

## Hotkeys

| # | Step | Result |
|---|---|---|
| 17 | `Ctrl+Alt+P` toggles the ball | |
| 18 | `Ctrl+Alt+S` triggers a screen capture | |
| 19 | `Ctrl+Alt+V` triggers push-to-talk | |
| 20 | `Ctrl+Alt+Q` (after Ctrl+C of some text) opens quick actions | |

## Voice

| # | Step | Result |
|---|---|---|
| 21 | Click the mic icon → it turns green and listens | |
| 22 | Speak something, click again to stop, your text appears in the box | |
| 23 | Settings → Voice → switch STT engine to Whisper | |
| 24 | Click mic again, speak, Whisper transcribes (first time downloads ~75 MB) | |
| 25 | Settings → Voice → enable "Speak responses aloud" | |
| 26 | Send a message, voice mode → response is read aloud | |

## Screen capture

| # | Step | Result |
|---|---|---|
| 27 | Click 📸 → captures your full screen, OCRs it, sends a message | |
| 28 | Click ✂ → drag a region → that crop is captured + OCR'd | |

## RAG / knowledge

| # | Step | Result |
|---|---|---|
| 29 | Settings → Knowledge → Create collection (any name) | |
| 30 | Drop a small PDF or .md file — ingest progress shows | |
| 31 | Ingest finishes (chunk count goes up) | |
| 32 | Click 📚 in the panel → toggle on the collection | |
| 33 | Ask a question about the file — response cites `[1]`, `[2]`… | |

## Settings

| # | Step | Result |
|---|---|---|
| 34 | Settings → General → switch theme to light, then dark, then system | |
| 35 | Settings → Models → pull a different model (try `qwen2.5:1.5b` for speed) | |
| 36 | Settings → Personas → create a custom persona with your name | |
| 37 | Switch to the custom persona from the panel header | |
| 38 | Settings → License → shows "Licensed to {{your name}}" | |

## Quit

| # | Step | Result |
|---|---|---|
| 39 | System tray icon is present | |
| 40 | Right-click tray → Quit → app actually exits (check task manager) | |

---

## Free-form feedback

After running through the above, please answer:

1. **Top 3 surprises (good or bad):**
2. **What annoyed you most:**
3. **What would you tell a friend about it:**
4. **Would you actually pay for the Pro features:** yes / no / "maybe if X"
5. **What's missing that would make you use this daily:**

Reply when you've finished. Thanks!
