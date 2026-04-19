# Twitter / X / Bluesky / Mastodon — launch thread

Same content works on all four. Format: a 10-tweet thread. Schedule the
first tweet for Tue–Wed morning US Eastern. Reply to every quote tweet
and reply for the first 6 hours.

## Tweet 1 (the hook)

```
I built a privacy-first AI desktop assistant.

It's a small floating ball that lives in your screen corner.
Click it. Type. Talk.
Everything runs locally on your machine.

Meet PAiA 👇

{{PAIA_URL}}
```

Attach: a 5-second GIF of the ball appearing → being clicked → panel expanding → text being typed → streaming response.

## Tweet 2 (the why)

```
Microsoft Recall takes screenshots of everything you do every few
seconds, forever. Cloud assistants send your prompts to someone
else's server.

PAiA does the opposite: nothing happens until you click the ball.
Even then, everything stays on your machine.
```

## Tweet 3 (the features list)

```
What you get out of the box (free):

🎈 Floating ball UI
💬 Multi-thread chat with local persistence
🎙 Offline voice (Whisper STT + system TTS)
📸 Screen capture with local OCR
🛡 PII redaction on every prompt
🤖 7 personas, 15 slash commands
⌨️ 4 configurable global hotkeys
🎨 Light/dark/system themes
```

## Tweet 4 (the Pro features)

```
Pro adds the heavy stuff:

📚 RAG knowledge collections (PDFs, code, markdown)
✂️ Region screen capture (drag-select)
👁 Vision models (llava, bakllava, moondream)
🔌 MCP tool servers with approval flow
☁️ Optional cloud providers (opt-in only)
🎙 Wake word ("Hey computer")
🔉 Piper neural TTS

$8/mo or $149 lifetime. 14-day trial.
```

## Tweet 5 (the technical brag)

```
Default network footprint: ONE connection to localhost:11434 for
Ollama.

That's it. Voice, OCR, embeddings, chat history — all local.

The first time you use Whisper or Tesseract, the model downloads
to your user data folder. Then never again.
```

## Tweet 6 (the privacy guarantee)

```
11 categories of PII (cards, SSNs, emails, phones, IPs, AWS keys,
GitHub tokens, JWTs, private keys, connection strings, generic API
keys) get scrubbed before any prompt leaves the renderer process.

Same redactor scrubs crash reports — if you opt in.
```

## Tweet 7 (the cloud opt-in)

```
Cloud providers (OpenAI / Anthropic / OpenAI-compatible) are present
but DISABLED by default.

You have to flip an explicit "Allow cloud models" toggle to even see
them in the model dropdown.

The chat dispatcher refuses to route to them otherwise.
```

## Tweet 8 (the build story)

```
The whole thing is ~16,500 lines of TypeScript. ~50 source files.
48 unit tests. Multi-platform installers.

Built in 3 weeks of focused work after rewriting from a Windows-only
WinUI 3 prototype I gave up on.

This is what AI coding assistants look like when you actually finish
something.
```

## Tweet 9 (the call to action)

```
Free for personal use. Pro for the heavy features.

Download for Windows / macOS / Linux:
{{DOWNLOAD_URL}}

14-day Pro trial on first install. No credit card. No account.

Source + privacy policy: {{PAIA_URL}}
```

## Tweet 10 (the social proof / engagement bait)

```
If you try it, I'd love to hear:
- What worked
- What broke
- What's missing

Reply or DM. I read every one of them.

(And if you're a Hacker News / Product Hunt person, the launch
threads are linked from the site 👀)
```

---

## Variants

### Single-tweet version (for accounts with low follower counts where threads die)

```
I built PAiA — a privacy-first AI desktop assistant.

A small floating ball lives in your screen corner. Click it to chat,
talk, capture your screen, work with documents.

Everything runs locally on your machine. No cloud, no telemetry.

Free for personal use. {{PAIA_URL}}
```

### Bluesky-specific (300 char limit, slightly different vibe)

Bluesky users skew more privacy-conscious and local-first. Lead harder with that:

```
PAiA is a privacy-first AI desktop assistant. A floating ball that
lives in your screen corner. Click it to chat, talk, capture your
screen — all locally. No cloud, no telemetry, no surveillance. Free
for personal use. {{PAIA_URL}}
```

### Mastodon-specific (500 char, also privacy-conscious audience)

Same vibe as Bluesky. Add the OSS angle:

```
Just shipped PAiA — a privacy-first AI desktop assistant.

It's a small floating ball that lives in your screen corner. Click
it to chat, talk, capture your screen, work with documents. Local
Ollama by default. Whisper STT, Tesseract OCR, sqlite history,
PII redaction, optional cloud opt-in. Free for personal use.

Built on Electron + React + TypeScript. Cross-platform.

{{PAIA_URL}}

#privacy #localfirst #ai
```

---

## Things to NOT do on Twitter

- Don't tag random influencers asking for RTs
- Don't post the thread more than once
- Don't reply to every reply with "thanks!" — it's noise
- Don't engage with bad-faith critics, even if they're wrong
- Don't post screenshots of your numbers ("100 downloads in an hour!") on day 1 — looks needy
