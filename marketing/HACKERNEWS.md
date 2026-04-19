# Hacker News — Show HN

## Title (max 80 chars)

```
Show HN: PAiA – A floating ball that lives in your screen corner, fully local
```

Alternates if the above gets flagged or doesn't land:

- `Show HN: A privacy-first AI desktop assistant that runs entirely locally`
- `Show HN: PAiA – the anti-Recall. Local AI desktop ball with voice and vision`
- `Show HN: I rewrote my Microsoft Recall alternative as a cross-platform Electron app`

## URL field

```
{{PAIA_URL}}
```

(Don't link the GitHub repo as the primary URL — link the website. The GitHub link goes in the comment.)

## First comment (post immediately after submitting)

```
Author here. PAiA is a small floating ball that lives in your screen
corner. Click it for a chat panel. Talk to it, type to it, drop files
on it, point it at your screen — and everything stays on your machine.

Some context on why I built it:

I started this last year as a Windows-only WinUI 3 prototype because I
wanted a Microsoft Recall alternative that wouldn't screenshot
everything I do every few seconds. The prototype worked but the
tooling was painful and I was locked to one OS. Earlier this month I
threw it out and rewrote the whole thing as an Electron + React + sql.js
app that runs on Windows, macOS, and Linux. Three weeks of focused
work later, here we are.

The technical bits I'm proudest of:

- The default network footprint is one connection to localhost:11434
  for Ollama. That's it. Whisper STT, Tesseract OCR, vector embeddings,
  chat history — all local. The first time you use Whisper or Tesseract
  it downloads the model files to your user data folder, then never
  again.
- 11-category PII redaction (cards, SSNs, emails, phones, IPs, AWS keys,
  GitHub tokens, generic API keys, JWTs, private keys, DB connection
  strings) runs on every prompt before it leaves the renderer. Same
  redactor scrubs crash reports if you opt into Sentry.
- Cloud providers (OpenAI / Anthropic / OpenAI-compatible) are
  completely hidden until you flip a single "Allow cloud models"
  toggle. The chat dispatcher refuses to route to them otherwise.
- RAG uses sql.js + Ollama's nomic-embed-text + brute-force cosine
  similarity in JS. No vector index extension, no native deps. Fast
  enough for thousands of chunks per collection.
- MCP (Model Context Protocol) tool servers work with a mandatory
  approval modal — every tool call asks before running unless you
  whitelist it.
- Crash reports and analytics are strictly opt-in with a user-supplied
  DSN/endpoint. No baked-in upstream — that would defeat the privacy
  story.
- Licensing is offline Ed25519. You buy, you get a JSON blob in your
  email, you paste it in. No phone-home, no DRM theatre.

The whole thing is ~16,500 lines of TypeScript and ~50 source files,
plus a 330-line zero-dependency Node webhook server for issuing
licenses. Source is at {{GITHUB_URL}}. Privacy story is at
{{PAIA_URL}}/privacy if you want to dig in.

Pricing: free for personal use (chat, voice, screen capture, history,
personas, themes, hotkeys). Pro at $8/mo or $149 lifetime unlocks RAG,
region capture, MCP, vision, custom personas, cloud providers, and
Piper neural TTS. There's a 14-day Pro trial on first install — no
credit card.

Happy to answer anything technical, business-wise, or about the
privacy posture. Code review and "you missed an obvious thing" comments
also welcome — that's literally why I'm posting.
```

## What to expect in the comments

Common HN topics on this kind of launch:

- **"How is this different from LM Studio / Jan / Open WebUI / Msty?"** — Have an answer ready. Yours is "the floating ball UX, the screen capture + active-window awareness, and the first-class privacy model with opt-in everything."
- **"Why Electron and not Tauri?"** — "Mature ecosystem, faster path to launch, the install footprint isn't actually that different in practice once you ship a vector index and a speech model."
- **"What about Microsoft's Recall coming back?"** — "Recall is opt-in screenshots-of-everything. PAiA is opt-in click-the-ball. Different threat model entirely."
- **"Is the redaction regex enough?"** — "It's a defense in depth, not a guarantee. The point is reducing the blast radius of accidents. Real PII handling for compliance use cases would need a proper NER model on top."
- **"How do you handle GDPR?"** — "By default we don't process EU users' personal data because we don't process anything on the server side. The license server only sees email + name from the payment processor."
- **"You should add wake word / hotword detection"** — "It's there, opt-in, BYO Picovoice key. CPU cost warning is shown loudly."
- **"You're going to get crushed by [bigger company]"** — "Maybe. The privacy-first niche is durable enough that there's room for at least one serious indie player. We'll see."

## Reply tone

- Brief. HN scrolls fast.
- Concrete. "Yes that's a known limitation, here's the workaround." beats "great question, we'll consider it."
- Take criticism gracefully. The harsh comments often have the best signal.
- Update your comment in place if you learn something — append "EDIT:" rather than burying corrections in replies.

## Things NOT to do

- Don't argue with people who refuse the basic premise. Some HN users hate Electron / hate AI / hate desktop apps as a category. You will not change their minds. Move on.
- Don't post "I built this in 3 weeks" unless it's true and relevant. The "I built X in N hours" framing is a stale tic.
- Don't ask for upvotes anywhere.
- Don't link affiliate codes or referral links.
