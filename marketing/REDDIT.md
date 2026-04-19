# Reddit — per-subreddit launch posts

Reddit is segmented. The same post that crushes on r/LocalLLaMA will get
removed for "low effort" on r/macapps. Each subreddit has its own
expectations, format, and self-promotion rules. Read each one's rules
before posting.

## Universal rules

- **Read the sidebar.** Some subreddits ban self-promo entirely.
- **Don't crosspost.** Write a fresh post for each sub.
- **Use the right flair.** Wrong flair = removal.
- **Reply within an hour** for the first 6 hours after posting.
- **Don't ask for upvotes** anywhere, ever.
- **Be a member of the community first.** If you've never commented in r/LocalLLaMA before, your launch post will look like spam (because it is).

---

## r/LocalLLaMA

**Subreddit:** [r/LocalLLaMA](https://reddit.com/r/LocalLLaMA)
**Why this is your #1 sub:** the entire community is people who already run local LLMs. They're your exact target customer.
**Best time:** Wed–Thu morning US Eastern.
**Flair:** "Resources" or "New Tool"

### Title
```
Built a privacy-first AI desktop assistant for Ollama. Floating ball, chat, voice, screen capture, RAG, MCP, all local.
```

### Body
```
Hey r/LocalLLaMA,

I built PAiA over the past few weeks because I wanted a really nice
desktop UX on top of Ollama that didn't compromise the privacy story.
The result is a small floating ball that lives in your screen corner.
Click it for a chat panel. Type, talk, drop files, capture your
screen — all local.

Why I think r/LocalLLaMA might care:

- **Ollama is the primary backend.** Pulls and lists models from
  inside the app, lets you pick per-thread, no extra config. Cloud
  providers (OpenAI / Anthropic / OpenAI-compatible) are present but
  hidden behind an opt-in toggle that defaults off.
- **STT is offline Whisper** via @huggingface/transformers. ~75 MB
  model downloaded once, then fully local.
- **OCR is local Tesseract.** Lazy-loads language models per language.
- **RAG uses Ollama for embeddings.** nomic-embed-text by default.
  Brute-force cosine similarity in JS — no vector index extension, no
  native deps. Fast enough for thousands of chunks.
- **Vision support** for llava, bakllava, moondream, llama3.2-vision,
  qwen2.5-vl, pixtral. Drag/drop or paste images, includes a warning
  banner if you've selected a non-vision model.
- **MCP (Model Context Protocol)** — connect any MCP server (filesystem,
  GitHub, browser, anything). Every tool call requires explicit
  approval unless you whitelist it.
- **Wake word** opt-in via Picovoice (BYO key, free for personal use).
- **Piper TTS** opt-in for neural local voices instead of OS speech
  synthesis.
- **PII redaction** on every prompt before it leaves the renderer —
  11 categories including AWS keys, GitHub tokens, JWTs, private keys,
  DB connection strings.

What I'd love feedback on from this sub:

1. Anyone else find the brute-force JS cosine similarity comfortable
   for hobby-scale knowledge bases, or am I going to regret this in
   six months?
2. Best vision model for "what's on my screen" use cases — currently
   defaulting suggestion to llava but moondream is faster.
3. Embedding model choices beyond nomic-embed-text — anyone running
   bge-large-en or mxbai-embed-large with Ollama?
4. Are there model providers I should add to the OpenAI-compatible
   list? Currently tested with LM Studio, Together, OpenRouter, Groq,
   vLLM.

Site: {{PAIA_URL}}
Source: {{GITHUB_URL}}
Pricing: free for personal use, $8/mo Pro for the heavy features.
14-day Pro trial on first install.

Happy to answer anything technical. The architecture writeup is in
the README if you want to skim before downloading.
```

---

## r/selfhosted

**Subreddit:** [r/selfhosted](https://reddit.com/r/selfhosted)
**Why:** they care about local-first software and privacy.
**Best time:** Wed–Sat US Eastern.
**Flair:** "Software - Other" or whatever fits — check current options.

### Title
```
PAiA — privacy-first AI desktop assistant. Local Ollama, optional self-hostable everything else.
```

### Body
```
Crossposting context: I built a desktop AI assistant that's designed
from the ground up to leave your data alone. Sharing here because the
self-hosting angle is one of its core selling points.

The default network footprint is one connection to localhost:11434
for Ollama. That's it. Voice, OCR, vector embeddings, chat history,
PII redaction — all local.

What's optionally self-hostable:

- **Crash reporting** — Sentry-protocol-compatible. Point at your own
  GlitchTip instance. Default DSN is empty.
- **Usage analytics** — opt-in, zero-dep, POSTs JSON to a URL you
  configure. Plausible self-hosted, PostHog self-hosted, or your own
  webhook all work.
- **License server** — included as a standalone Node script (~330
  lines, zero npm deps). Comes with a one-shot Ubuntu install script
  that sets up systemd, nginx, and Let's Encrypt SSL. So you can run
  your own license issuance instead of trusting a third party.
- **Cloud LLM providers** — disabled by default. OpenAI-compatible
  provider works with vLLM, LM Studio, Together, OpenRouter, your own
  llama.cpp server, anything.
- **MCP servers** — connect anything that speaks Model Context
  Protocol. Filesystem access, browser automation, your home
  automation, all locally.

Stack: Electron 33 + React 18 + TypeScript + sql.js (SQLite via
WebAssembly, no native deps). Cross-platform — Win NSIS, macOS DMG,
Linux AppImage + .deb.

Pricing: free for personal use covers local Ollama chat, voice,
screen capture, history, slash commands, themes. Pro at $8/mo or
$149 lifetime adds RAG, MCP, vision, region capture, custom
personas, cloud opt-in, Piper TTS.

Site: {{PAIA_URL}}
Source: {{GITHUB_URL}}
Privacy doc: {{PAIA_URL}}/privacy

Happy to answer any self-hosting questions in the comments.
```

---

## r/privacy

**Subreddit:** [r/privacy](https://reddit.com/r/privacy)
**Why:** the brand-aligned audience.
**Best time:** Mid-week, US Eastern.
**Caveat:** r/privacy is allergic to obvious self-promo. Lead with the privacy thesis, not the product.

### Title
```
Built a desktop AI assistant that doesn't watch you — the design notes
```

### Body
```
I spent the past few weeks rebuilding a Microsoft Recall alternative
as a cross-platform Electron app. The version-1 thesis was simple:
nothing happens until the user explicitly clicks the ball. The whole
design follows from that.

Some of the choices that came out of taking this seriously:

1. **Default network footprint = one connection to localhost.** The
   only outbound traffic on a fresh install is to a local Ollama
   daemon on the loopback interface. Voice transcription, OCR, vector
   embeddings, chat history — all in-process.

2. **PII redaction at the renderer boundary.** Every prompt is
   scrubbed for 11 categories of sensitive data (cards, SSNs, emails,
   phones, IPs, AWS keys, GitHub tokens, generic API keys, JWTs,
   private keys, DB connection strings) BEFORE it leaves the
   sandboxed renderer process. Same redactor scrubs crash reports if
   you opt in.

3. **Cloud is hidden.** OpenAI / Anthropic / etc. providers are
   gated behind a single "Allow cloud models" toggle that defaults
   off. Until you flip it, the chat dispatcher refuses to route
   anything to them. The UI doesn't even show them in the dropdown.

4. **Crash reports are opt-in with a user-supplied DSN.** No baked-in
   upstream. If you want crash reports, you tell PAiA where to send
   them — your own GlitchTip, your own hosted Sentry project,
   whatever. Off by default.

5. **Usage analytics are opt-in with a user-supplied endpoint.**
   Same model. Property whitelist enforced in code so future
   contributors can't accidentally start logging chat content.

6. **License verification is offline.** Ed25519 signature checks
   happen on your machine. No phone-home. The license server only
   gets involved at purchase time (your payment processor pings it,
   it signs and emails you a JSON blob, end of story).

7. **The system tray icon never spies.** No background polling, no
   "listen for activity," nothing. The tray is just a way to show
   the window — the app does literally nothing until you tell it to.

8. **Active window awareness is opt-in too.** When enabled, the app
   asks the OS what window is in focus right now and includes "user
   was looking at: notepad.exe" in the system prompt. It does NOT
   poll. It does NOT log to disk. It only fires on your message.

The MCP integration was the trickiest one to get right from a
privacy perspective. MCP servers can do anything — read files, hit
URLs, run code. The compromise: every tool call pops an approval
modal showing the server name, tool name, and arguments. Users can
whitelist trusted tools per-server, but the default is "ask every
time."

Source + privacy policy: {{PAIA_URL}}/privacy

Curious what people on this sub would change. The threat model I'm
optimizing for is "an honest user who doesn't want to be tracked,"
not "a user evading nation-state surveillance" — there's a real
difference. But if you see a hole in the design I'd genuinely like
to know.
```

---

## r/macapps

**Subreddit:** [r/macapps](https://reddit.com/r/macapps)
**Why:** Mac users actually pay for software.
**Best time:** Tue–Thu morning US Eastern.
**Flair:** "App" if available.

### Title
```
PAiA — local AI assistant that lives as a floating ball on your screen [Free / Pro]
```

### Body
```
Made for Mac users who want an AI desktop assistant that doesn't
phone home.

PAiA is a small glowing ball that sits in your screen corner. Click
it for a chat panel. Type, talk, capture your screen, work with
documents — all local via Ollama, with optional cloud provider
support behind an opt-in.

Mac-specific notes:
✅ Universal binary (Intel + Apple Silicon)
✅ Notarized DMG (no scary Gatekeeper warnings)
✅ Hardened runtime
✅ Native menu bar integration
✅ Respects system theme (light/dark/auto)
✅ Works on macOS 12+
✅ ~160 MB install
✅ Trial works without an account

Free tier: chat, voice, screen capture, multi-thread history, 7
personas, 4 hotkeys.

Pro ($8/mo or $149 lifetime): RAG knowledge collections, region
screen capture, MCP tool servers, vision models, cloud providers,
custom personas, Piper TTS, wake word.

14-day Pro trial on first install, no credit card.

{{DOWNLOAD_URL}}
```

(Keep the r/macapps post short — that sub prefers concise app showcases.)

---

## r/windows

Same template as r/macapps but adjusted for Windows. Be aware: r/windows is much harsher on Electron apps. Expect "why not native?" comments. Honest answer: cross-platform is the goal and Electron lets one person ship to all three OSes.

---

## r/Ollama

**Subreddit:** [r/Ollama](https://reddit.com/r/Ollama)
**Why:** small but high-fit audience.
**Tone:** technical, dev-focused.

### Title
```
A polished desktop UI for Ollama — chat, voice, screen capture, RAG, MCP, all from one floating ball
```

### Body
```
Built a desktop client for Ollama that I think r/Ollama might
appreciate. It's a small floating ball that expands into a chat
panel when clicked. Multi-thread persistence, model picker per
thread, pull/list/delete models from inside the app, streaming
responses with markdown + code highlighting.

The Ollama-specific bits:
- Model browser pulls live status from /api/tags every 10s
- nomic-embed-text used for RAG embeddings
- Vision models (llava, bakllava, moondream, llama3.2-vision)
  recognized automatically
- Cloud provider plugins (OpenAI, Anthropic, OpenAI-compatible)
  available but disabled by default — Ollama is the first-class
  backend
- All prompts go through PII redaction before being sent

Free for personal use. Pro tier for the fancy features.

{{PAIA_URL}}
```

---

## What NOT to post

- Don't post in r/programming (will get removed for "low quality")
- Don't post in r/SideProject more than once
- Don't post in r/Entrepreneur — wrong audience entirely
- Don't post in r/learnprogramming — they want tutorials, not products
