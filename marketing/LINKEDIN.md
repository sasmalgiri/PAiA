# LinkedIn — launch post

LinkedIn is a different game than HN / Twitter. The audience is more
formal, less technical, more interested in the *why* and the *story* than
the *what*. Lead with the narrative; the features come second.

## Post

```
For the past few weeks I've been heads-down on something I'm proud to
finally share.

It's called PAiA — a privacy-first AI desktop assistant.

The premise is simple. Your AI shouldn't watch you. It should sit in
the corner of your screen and wait. When you ask for help, it helps.
When you don't, it does nothing.

I started building this last year as a Windows-only prototype after
Microsoft announced Recall — the feature that takes screenshots of
everything you do, forever, and stores it in a local database. The
backlash was immediate and the feature got pulled. But the underlying
architectural choice — "let's collect everything and figure out what
to do with it later" — is everywhere in modern software, and I wanted
to build the opposite.

The opposite turned out to be a small floating ball that lives in
your screen corner. You click it for a chat panel. You can type or
talk. You can drop a file on it. You can capture your screen. You
can build a knowledge base from your own documents. You can connect
it to tool servers that read your filesystem. And every single one
of those operations runs locally, on your machine, with the
default network footprint being one connection to a local language
model on the loopback interface.

Some of the things that make it interesting:

→ 11 categories of personally-identifiable information are scrubbed
  before any prompt leaves the renderer process
→ Cloud LLM providers (OpenAI, Anthropic, etc) are present but
  disabled by default behind an explicit opt-in toggle
→ Crash reports and analytics are opt-in with a user-supplied
  destination — no baked-in upstream
→ Speech-to-text uses Whisper running locally
→ Optical character recognition uses Tesseract running locally
→ Vector embeddings for retrieval-augmented generation use a local
  embedding model
→ License verification uses offline Ed25519 signatures — no
  phone-home, no DRM theatre
→ Cross-platform: Windows, macOS, Linux

It's free for personal use. Pro tier is $8/month or $149 lifetime —
that funds continued development and unlocks the heavier features
(RAG, screen region capture, MCP tool servers, vision, custom
personas).

I built it because I wanted to use it. The cynical interpretation
of "privacy-first" software is that it's a marketing label slapped
on the same surveillance app everyone else ships. The honest version
takes a hundred small architectural decisions, every one of them
costing engineering time, and ends up with a product that's
genuinely different.

If you've been looking for an AI assistant that doesn't watch you,
or you just want to support someone trying to ship an honest product
in a category that desperately needs one, give PAiA a try. There's a
14-day Pro trial on first install — no credit card, no account.

Download: {{DOWNLOAD_URL}}
Privacy story: {{PAIA_URL}}/privacy

I'd love to hear what you think.

#PrivacyFirst #LocalAI #DesktopApps #IndieMaker #ShipSoftware
```

## Variants

### Shorter version (if 300+ words is too much for your network)

```
For the past few weeks I've been building PAiA — a privacy-first AI
desktop assistant.

It's a small floating ball that lives in your screen corner. Click
it to chat, talk, capture your screen, work with documents — all
running locally on your machine. The default network footprint is
one connection to a local language model. No cloud, no telemetry,
no surveillance.

Built it because I wanted to use it. Free for personal use.

{{PAIA_URL}}
```

### "Lessons learned" framing (good for your second LinkedIn post a week later)

```
Three weeks ago I started rebuilding a side project from scratch.

Three things I learned shipping PAiA — my privacy-first AI desktop
assistant — that surprised me:

1. The hardest part wasn't the AI. It was the boring infrastructure.
   License keys, payment webhooks, code signing, crash reporting,
   the Stripe → email → activation loop. The actual chat interface
   took a fraction of the time.

2. "Free for personal use" pricing turns out to be psychologically
   different from "free trial then paid." People download the
   former without thinking about it. The conversion to Pro happens
   later, after the trust is built.

3. Cross-platform is no longer a tradeoff. Electron + React + sql.js
   gets you Windows / Mac / Linux from one codebase, and the install
   size penalty is genuinely minor when you compare to the value of
   reaching every desktop user instead of just one OS.

If you want to see what came out of it: {{PAIA_URL}}

#IndieMaker #ShipSoftware #LessonsLearned
```

---

## LinkedIn-specific tips

- **Image always.** Posts with images get 2x the engagement. Use a screenshot of the ball + panel together.
- **No emojis in titles.** LinkedIn isn't HN. Keep the headline professional.
- **Tag carefully.** Don't tag random people. Only tag if they're directly related (e.g., a co-founder).
- **Reply within 1 hour.** LinkedIn algorithm rewards engagement velocity hard.
- **Native posts beat link posts.** Paste the content as a native post and put the link in the first comment if you want maximum reach.
- **"#Hashtags" still help on LinkedIn.** 3–5 is the sweet spot.
- **Don't post on Friday.** Engagement drops 40% on Friday afternoons.
