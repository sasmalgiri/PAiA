# Blog post — launch essay

A long-form launch post you can publish on:
- Your own blog
- dev.to (paste as-is, dev.to handles the markdown)
- Hashnode
- Medium (paste, then re-format any quirks)
- Lobste.rs (post a link to wherever you publish — Lobste.rs doesn't host)

Optimized for the long tail: this post will be the canonical reference
that people Google for in 6 months.

---

## Title

```
PAiA — building a privacy-first AI desktop assistant in three weeks
```

Alternates:

- `Why I rewrote my Windows-only AI assistant as a cross-platform Electron app`
- `Building the anti-Recall: a privacy-first AI desktop assistant`
- `Shipping PAiA: design notes from a privacy-first desktop AI`

## Post

````markdown
# PAiA — building a privacy-first AI desktop assistant in three weeks

Three weeks ago, I scrapped a year of work on a Windows-only WinUI 3
prototype and started over.

Today I'm shipping the result: **PAiA**, a privacy-first AI desktop
assistant that runs locally on Windows, macOS, and Linux. It's a small
floating ball that lives in your screen corner. Click it for a chat
panel. Type or talk. Drop a file on it. Point it at your screen. The
default network footprint is one connection to a local language model
on the loopback interface — and that's it.

This is the story of how it got built and the design decisions that
shaped it.

## The problem

Last year, I wanted an AI assistant on my desktop that didn't watch me.

Microsoft was about to ship Recall — a feature that took screenshots of
everything you did, every few seconds, forever, and stored them in a
searchable local database. The backlash was immediate. Microsoft pulled
the feature, then quietly shipped a tamer version. But the underlying
architectural choice — "collect everything by default and figure out
the use case later" — is everywhere in modern software.

I built a Windows-only WinUI 3 prototype as a counter-example. The
premise was: nothing happens until the user explicitly clicks. Capture
on demand. PII redaction. No background polling. Local Ollama only.

The prototype was about 10,000 lines of C# / .NET 8. It worked, mostly.
But three things killed my motivation to ship it:

1. **WinUI 3 tooling.** Building, packaging, and code-signing a WinUI 3
   app is genuinely painful. Visual Studio crashed weekly. Every release
   was a 4-hour ordeal.
2. **Windows-only.** I wanted my Mac and Linux friends to use it.
3. **The architecture had ossified.** I'd added 10 features and 15 ad-hoc
   abstractions. Refactoring felt like wading through mud.

So I deleted the project and started over.

## The rewrite

The new version is Electron 33, React 18, TypeScript, sql.js (SQLite via
WebAssembly), and esbuild. About 16,500 lines of code across 50 files.
Cross-platform from day one. Three weeks of focused work, mostly evenings.

The goal of the rewrite wasn't "make the prototype work better." It was
"start from the privacy thesis and let the architecture follow."

Here's what came out of taking that seriously.

### 1. The default network footprint is one connection to localhost

When you launch PAiA on a fresh install, it makes exactly one outbound
network request: to `127.0.0.1:11434`, where Ollama lives. That's the
loopback interface. The data never leaves your machine.

Everything else — voice transcription, OCR, vector embeddings, chat
history persistence, PII redaction — happens in-process. The first time
you use Whisper or Tesseract, the model files download once into your
user data folder, and then never again.

The hardest part of getting this right wasn't writing the local
implementations. It was being honest about *every other path*. Crash
reports, analytics, auto-update checks, web search, vision models, MCP
tool servers — all of them have the potential to phone home. They're
all gated behind explicit user opt-ins, and I refuse to bake in a
default upstream URL anywhere. If you want crash reports, you tell PAiA
where to send them. We never picked a default for you.

### 2. PII redaction at the renderer boundary

There are 11 categories of personally-identifiable information that get
scrubbed from every prompt before it leaves the renderer process:

- Credit card numbers
- U.S. Social Security numbers
- Email addresses
- Phone numbers
- IP addresses
- AWS access keys
- GitHub tokens
- Generic API keys
- JWT tokens
- Private keys (RSA, EC, DSA)
- Database connection strings with embedded passwords

The redactor is a few hundred lines of regex. It's not a replacement for
a real DLP solution. The point is reducing the blast radius of accidents.
If you accidentally paste your AWS key into a prompt, the model never
sees it. If a stack trace ends up in a crash report, the email address
in it is `[EMAIL-REDACTED]` before it reaches Sentry.

The same redactor runs in the chat path, the web search path, and the
crash reporting path. One source of truth, applied everywhere there's a
boundary.

### 3. Cloud is hidden until you ask for it

OpenAI, Anthropic, and OpenAI-compatible providers (LM Studio, Together,
Groq, OpenRouter, vLLM, etc.) are all supported. They're also all
**disabled by default**. The chat dispatcher refuses to route to them.
The model dropdown doesn't even show them.

To use them, you flip a single toggle in Settings → General → "Allow
cloud models." Then you pick a provider, paste your API key, and the
☁ models appear in the dropdown alongside your local Ollama ones.

This sounds obvious. It's not how most apps do it. Most "privacy-first"
desktop AI products quietly default to cloud models because that's
what works without setup. PAiA's default is local, which means the
first-run UX has to be opinionated about helping users install Ollama
— which leads to the next decision.

### 4. The first-run experience is a wizard

When PAiA launches for the first time, it doesn't just appear as a ball.
It opens a centered welcome window with a 3-step wizard:

1. Hi. Here's what PAiA is.
2. Let's connect a local model. (Detects Ollama. If not installed,
   links to ollama.com. If installed but no models, offers to pull
   `llama3.2` with a progress bar.)
3. Pick your theme and voice settings.

Then the window shrinks to the ball and you're done.

The wizard is the most important UX decision in the whole project. It's
the difference between "this only works for technical users who already
have Ollama" and "this works for anyone willing to install one extra
thing." A privacy-first product that's only usable by hackers is a
hobby. I wanted to build something I could give to my mom.

### 5. RAG with brute-force cosine similarity in JavaScript

The Pro tier includes RAG (retrieval-augmented generation): you drop
PDFs, Markdown, code, or text files into a "knowledge collection," PAiA
chunks them, embeds them with a local embedding model (`nomic-embed-text`
via Ollama), and stores the vectors in SQLite.

The conventional wisdom is that you need a vector index extension for
this. sqlite-vec is great, LanceDB is great, pgvector is great. I tried
all three. They all add native build dependencies, which break my
"zero native deps" rule for the install footprint.

So I did something dumb: brute-force cosine similarity in pure JS over
all the chunks. For every search.

It turns out that for hobby-scale knowledge bases — a few thousand
chunks of ~800 characters each — this runs in single-digit milliseconds.
There's no perceptible difference vs. a vector index. The vector index
becomes worth the dependency cost somewhere around 100,000 chunks, which
is way bigger than any individual user's personal knowledge base.

If you're building a hobby-scale RAG system, **do the dumb thing first**.
You'll be surprised how far it goes.

### 6. Licensing without DRM

PAiA is paid software. The licensing system is offline Ed25519
signatures.

Here's how it works. I generated an Ed25519 keypair once. The public
key gets baked into release builds. The private key stays on my machine
and on the license-issuance webhook server. When you buy Pro from the
website, the payment processor (LemonSqueezy or Stripe) fires a webhook
to my server, which signs a JSON license payload with the private key
and emails it to you. You paste it into Settings → License → Activate.
The app verifies the signature offline using the public key it shipped
with.

There is no phone-home. There is no anti-tampering layer. There is no
hardware fingerprint. If you crack the binary, you can use Pro features
for free — and that's fine, because anyone determined enough to crack
it isn't going to pay anyway. The honest customer pays. The pirate
isn't your customer.

This isn't anti-DRM idealism, it's product sense. Every hour spent on
DRM is an hour not spent on features. The math doesn't work for indie
software.

### 7. The wake word is opt-in *and* requires you to install separate packages

Wake-word detection ("hey computer") is the kind of feature that sounds
amazing in marketing copy and is a privacy disaster in practice.
Always-on listening burns CPU, drains laptop batteries, and is a
constant temptation for "let's just record this for analytics."

I did add it. It uses Picovoice Porcupine. But I did three things to
keep it honest:

1. **It's disabled by default.** You have to flip a toggle.
2. **You supply your own Picovoice access key.** Picovoice is a
   commercial product with a free tier for personal use. PAiA doesn't
   bundle a key. You go get one yourself.
3. **The Picovoice packages are NOT in `package.json`**. The base
   install doesn't include them. You manually `npm install
   @picovoice/porcupine-node @picovoice/pvrecorder-node` in the
   unpacked app directory if you want this feature.

The result: the 99% of users who don't care never pay any cost (no
extra binary, no extra dependency, no extra CPU). The 1% who care can
opt in fully informed.

This is what "feature-rich but privacy-first" actually looks like in
code, not in marketing copy. It's friction in the right places.

## The build infrastructure

The interesting part of shipping a desktop app isn't the desktop app.
It's everything around it.

- **CI**: GitHub Actions builds Win NSIS / macOS DMG / Linux AppImage +
  .deb on every push, publishes to GitHub Releases on tag.
- **Code signing**: Authenticode for Windows, Developer ID for macOS,
  notarization wired up. Linux doesn't need signing.
- **Auto-update**: electron-updater pointed at GitHub Releases. The
  user clicks "install," the new version downloads in the background,
  the next launch uses it.
- **License webhook server**: a 330-line zero-dependency Node script
  that listens for Stripe and LemonSqueezy webhooks, signs licenses,
  and emails them via Resend. Comes with a one-shot Ubuntu install
  script that sets up systemd, nginx, and Let's Encrypt SSL.
- **Crash reporting**: Sentry integration in both main and renderer
  processes, gated on user opt-in, PII-scrubbed in `beforeSend`.
- **Analytics**: zero-dependency, opt-in, property-whitelisted.
- **Test suite**: 48 tests across 5 files (redaction, chunking,
  DuckDuckGo HTML parsing, license verification, slash commands).
- **Marketing site**: 6-page static site (landing, pricing, privacy,
  download, changelog, docs) hosted on Cloudflare Pages.

Most of this is not visible to users. All of it is what makes the
difference between "tech demo" and "shippable product."

## What it costs to ship this

If you're thinking of doing the same thing, here's the ground-truth
cost ledger from launch day:

| Item | Cost |
|---|---|
| Domain (Cloudflare Registrar) | ~$10/yr |
| Windows Authenticode EV cert (SSL.com) | ~$300/yr |
| Apple Developer Program | $99/yr |
| Lawyer (privacy + ToS + EULA review) | $300–800 one-time |
| VPS for license server (Hetzner) | $5/mo |
| Resend (transactional email) | free at this scale |
| LemonSqueezy fees | 5% of revenue |
| **Total to launch** | **~$700 one-time + ~$50/mo + 5% of sales** |

That's the floor. You can launch on under $1,000 in cash and ~$50 a
month in operating cost. Anything more is optional.

## What I wish I'd known three weeks ago

Three things, for anyone building something similar:

1. **The hardest part isn't the AI.** It's the boring infrastructure.
   License keys, payment webhooks, code signing, crash reporting, the
   end-to-end purchase → email → activation loop. The actual chat
   interface took a fraction of the time. Plan accordingly.

2. **"Free for personal use" pricing is psychologically different from
   "free trial then paid."** People download the former without thinking
   about it. The conversion to Pro happens later, after trust is built.
   Don't put the paywall in the way of the first 10 minutes.

3. **Privacy is a product feature, not a marketing position.** If you
   actually take the privacy story seriously, every architectural
   decision becomes easier — because most of the choices that lead to
   surveillance ALSO lead to operational headaches. Local-by-default
   means no servers to babysit. No data means no GDPR compliance burden.
   No tracking means no cookie banners. The "expensive" choice
   compounds in your favor.

## Try it

PAiA is free for personal use. Pro is $8/mo or $149 lifetime. There's a
14-day Pro trial on first install — no credit card, no account.

- **Download**: {{DOWNLOAD_URL}}
- **Privacy policy**: {{PAIA_URL}}/privacy
- **Source code**: {{GITHUB_URL}}
- **Discussion**: {{PAIA_URL}} (links to HN, Product Hunt, Reddit
  threads from launch day)

If you try it, I'd genuinely love to hear what you think. Reply
here, email me, ping me on Twitter or Bluesky. I read every one.

— {{YOUR_NAME}}
````

---

## Cross-posting strategy

1. Publish on your own blog first
2. Copy to dev.to with a `canonical_url` pointing back to your blog (preserves SEO)
3. Copy to Hashnode with the same canonical URL
4. Optional: cross-post to Medium ~3 days later (Medium hates immediate cross-posts but tolerates delayed ones)
5. Submit the URL of your own blog post to Hacker News, Lobste.rs, r/programming
6. Tweet the link

The canonical URL trick is important — it tells Google "this content is originally on my blog, even if it appears in 4 other places." Otherwise dev.to and Medium will outrank you for your own post.
