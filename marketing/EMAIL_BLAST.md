# Email blast — to your existing list

Use this if you have an existing mailing list (newsletter subscribers,
people who opted into updates from previous projects, etc.). Send it on
launch day, not before.

## Subject line variants (A/B test if your provider supports it)

A. `PAiA is here.`
B. `I built something I think you'll like — PAiA is live.`
C. `Your AI assistant. Right in your screen corner.`
D. `[New] PAiA — privacy-first AI desktop assistant`

The shortest subject line usually wins. Lead with A.

## Email body (plain text)

```
Hey {{first_name}},

Quick note — PAiA is live today.

It's a privacy-first AI desktop assistant. A small floating ball lives
in your screen corner. Click it for a chat panel. Type or talk. Drop a
file on it. Capture your screen. Everything runs locally on your
machine. No cloud, no telemetry, no surveillance.

I've been heads-down building this for the past few weeks because I
wanted to use it myself. Today it's ready for everyone else.

What you get out of the box (free):

- Floating ball UI, click for chat panel
- Multi-thread conversations with local persistence
- Voice input (offline Whisper or Chromium STT)
- Voice output (system TTS)
- Screen capture with local OCR
- 11-category PII redaction
- 7 personas, 15 slash commands
- 4 configurable global hotkeys
- Light, dark, and system themes

Pro tier ($8/month or $149 lifetime) adds:

- RAG knowledge collections (drop PDFs, get cited answers)
- Region screen capture (drag-select)
- Vision models (llava, bakllava, moondream)
- MCP tool servers
- Cloud providers (OpenAI, Anthropic, OpenAI-compatible)
- Wake word
- Piper neural TTS
- Custom personas

There's a 14-day Pro trial on first install. No credit card. No
account.

Download for Windows / macOS / Linux:
{{DOWNLOAD_URL}}

Why I'm sending this to you specifically: you signed up for updates
on past projects. PAiA is the project I'm proudest of so far.

If you try it, I'd love to hear what you think. Reply to this email
or ping me on Twitter / Bluesky / wherever. I read every one.

Thanks for sticking around.

— {{YOUR_NAME}}

---

P.S. The full launch story is up on my blog if you want to read it:
{{BLOG_POST_URL}}

P.P.S. If you don't want updates from me anymore, the unsubscribe link
is at the bottom of this email. No hard feelings.
```

## HTML version

If your email provider sends HTML, use this minimal markup:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PAiA is here</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;color:#1a1f2b;line-height:1.6">

<div style="max-width:560px;margin:40px auto;padding:32px;background:#ffffff;border-radius:12px;border:1px solid #d6dae6">

  <div style="text-align:center;margin-bottom:24px">
    <div style="width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#bcd7ff,#4f87dd 55%,#1f3a6b);box-shadow:0 0 30px rgba(106,166,255,0.45);margin:0 auto 12px"></div>
    <h1 style="margin:0;font-size:24px">PAiA is live.</h1>
  </div>

  <p>Hey {{first_name}},</p>

  <p>Quick note — PAiA is live today.</p>

  <p>It's a privacy-first AI desktop assistant. A small floating ball lives in your screen corner. Click it for a chat panel. Type or talk. Drop a file on it. Capture your screen. Everything runs locally on your machine. No cloud, no telemetry, no surveillance.</p>

  <p>I've been heads-down building this for the past few weeks because I wanted to use it myself. Today it's ready for everyone else.</p>

  <h2 style="font-size:16px;margin-top:24px">Free</h2>
  <ul>
    <li>Floating ball UI, click for chat panel</li>
    <li>Multi-thread conversations with local persistence</li>
    <li>Voice input (offline Whisper or Chromium STT)</li>
    <li>Screen capture with local OCR</li>
    <li>11-category PII redaction</li>
    <li>7 personas, 15 slash commands</li>
  </ul>

  <h2 style="font-size:16px;margin-top:16px">Pro ($8/mo or $149 lifetime)</h2>
  <ul>
    <li>RAG knowledge collections</li>
    <li>Region screen capture</li>
    <li>Vision models</li>
    <li>MCP tool servers</li>
    <li>Cloud providers (opt-in)</li>
    <li>Wake word + Piper neural TTS</li>
  </ul>

  <p>14-day Pro trial on first install. No credit card. No account.</p>

  <div style="text-align:center;margin:32px 0">
    <a href="{{DOWNLOAD_URL}}" style="display:inline-block;padding:14px 32px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">Download PAiA</a>
  </div>

  <p>If you try it, I'd love to hear what you think. Reply to this email, ping me on Twitter or Bluesky. I read every one.</p>

  <p>Thanks for sticking around.</p>

  <p>— {{YOUR_NAME}}</p>

  <hr style="border:none;border-top:1px solid #d6dae6;margin:32px 0">

  <p style="font-size:12px;color:#6b7384">
    P.S. The full launch story: <a href="{{BLOG_POST_URL}}" style="color:#2563eb">read on the blog</a><br>
    P.P.S. <a href="{{UNSUBSCRIBE_URL}}" style="color:#6b7384">unsubscribe</a> if you'd rather not hear from me again. No hard feelings.
  </p>

</div>

</body>
</html>
```

## Sending tips

- **Send between 9–11am local time** in your audience's primary time zone
- **Tuesday or Wednesday** is the best day for opens
- **Avoid Friday afternoon** entirely
- **Plain text first**, HTML second — test both
- **Include an unsubscribe link** even if your provider does it automatically. It's the law in most jurisdictions and it's polite.
- **Don't send twice.** If the first send underperforms, learn from it for next time. Resending the same email annoys people.

## What to track

- Open rate (target: 30%+ for an engaged list)
- Click-through rate on the download link (target: 8%+)
- Unsubscribe rate (target: <2% — anything higher means the email annoyed people)
- Replies (target: as many as possible — replies are gold for product feedback)
