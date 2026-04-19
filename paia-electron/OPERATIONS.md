# PAiA — Operations checklist

This is the playbook for taking PAiA from "code complete" to "people are
paying me money for this." Items are in dependency order — each one
unblocks the next.

**Legend**

- 🟢 = I (Claude) can do it / have done it. Just use the file.
- 🟡 = You'll do it but I've prepared the template/config/script.
- 🔴 = You have to do it yourself (signups, payments, legal, etc.).
- ⏱ = Rough time estimate
- 💰 = Money you'll spend

> Don't skip ahead. Each section assumes the previous one is done.

---

## Phase 0 — Free preflight (do this first, costs nothing)

These are zero-cost gates that catch problems before you start spending money.

### 0.1 Decide your launch identity

🔴 ⏱ 30 min — 💰 0

You need to lock in three things before doing anything else:

| Decision | Why it matters |
|---|---|
| **Product name** — confirm "PAiA" is final | Used in cert subject, app name, store listings, domain. Renaming after launch is painful. |
| **Domain** — `paia.app`, `paia.dev`, `getpaia.com`, etc. | Needed for the website + cert email + license-server URL + Stripe webhook URL |
| **Legal entity** — sole proprietor / LLC / Ltd / etc. | Cert vendors and payment processors need a real legal name. You can launch as a sole proprietor and incorporate later. |

**Action:**
1. Trademark search at [tmsearch.uspto.gov](https://tmsearch.uspto.gov) (US) and [euipo.europa.eu](https://euipo.europa.eu/eSearch) (EU). Search for "PAiA" in Class 9 (software). Note any conflicts.
2. If clear: register the domain via Cloudflare Registrar or Porkbun (~$10/yr — cheaper than GoDaddy).
3. Decide if you're operating as yourself or as a company. **For a v1 launch, sole proprietor / individual is fine.** Incorporate when revenue justifies the accounting overhead.

### 0.2 Create the GitHub repo

🔴 ⏱ 15 min — 💰 0

1. New repo on GitHub. Public OR private — both work for releases.
2. Push the existing code:
   ```bash
   cd D:/PAiA
   git remote add origin https://github.com/YOUR-USER/paia.git
   git push -u origin main
   ```
3. Edit [paia-electron/package.json](package.json) `build.publish.owner` and `build.publish.repo` from `REPLACE_ME` to your real values.
4. Edit [website/download.html](../website/download.html) — search/replace `REPLACE_ME` with your real GitHub user/org.
5. Commit, push.

### 0.3 Generate the license signing keypair

🟡 ⏱ 5 min — 💰 0

```bash
cd paia-electron
node scripts/issue-license.mjs --gen-keys
```

Drops `.keys/private.b64` and `.keys/public.b64`.

**The private key NEVER leaves your password manager / VPS.** Add it to:
- 1Password / Bitwarden / your password manager (the long-term canonical copy)
- The license server's environment (when you deploy in step 3.2)

The public key goes into:
- GitHub Actions secrets as `PAIA_PUBLIC_KEY` (so CI builds can verify licenses)
- Optionally hard-coded in [src/main/license.ts](src/main/license.ts) if you want a default when the env var is missing

`.gitignore` already excludes `.keys/` so the private key won't get committed by accident.

### 0.4 Run the preflight script

🟢 ⏱ 1 min — 💰 0

```bash
cd paia-electron
bash scripts/release-preflight.sh
```

This script (added below) checks: tests pass, build is clean, version matches CHANGELOG, no uncommitted changes, public key is set. **All green before you tag a release.**

### 0.5 Cut an unsigned v0.3.0 tag and verify CI

🟡 ⏱ 30 min (mostly waiting) — 💰 0

```bash
git tag v0.3.0
git push origin v0.3.0
```

Watch [.github/workflows/build.yml](.github/workflows/build.yml) run on three platforms. The first run will probably fail somewhere subtle — fix it, push another tag, repeat. You want to see green builds on all 3 OSes producing real installer artifacts BEFORE you spend money on certs.

> **Why before certs:** if the cert step is broken because of an environment issue, you waste signing operations and possibly burn cert reputation. Get unsigned-but-clean working first.

### 0.6 Self-test the unsigned installers

🔴 ⏱ 1 hour — 💰 0

Download all 3 installers from your GitHub release. Install on:

- A clean Windows VM (or a friend's machine)
- A clean macOS install (Sonoma or later)
- A clean Ubuntu 22.04 / 24.04

For each one, run through the **smoke checklist** in section 0.7. **Fix anything that's broken before moving to Phase 1.**

### 0.7 Smoke checklist (run on every release)

🟢 ⏱ 15 min — 💰 0

| # | Step | Pass criteria |
|---|---|---|
| 1 | Install the binary | No SmartScreen / Gatekeeper full block. Warning is OK pre-cert. |
| 2 | Launch | Onboarding wizard appears |
| 3 | Onboarding → detect Ollama | Either says "Ollama running" or "install Ollama" |
| 4 | Onboarding → pull `llama3.2` | Progress bar advances; eventually "done" |
| 5 | Finish onboarding | Window collapses to ball in screen corner |
| 6 | Drag the ball | New position persists after relaunch |
| 7 | Click ball → panel | Panel expands with chat UI |
| 8 | Send a message | Streaming response appears, no errors in console |
| 9 | Hit `Ctrl+Alt+P` | Ball toggles visibility |
| 10 | Hit `Ctrl+Alt+S` | Screen captures, OCR runs, message sent with screenshot |
| 11 | Click 📚 → create collection → drop a PDF | RAG ingest progress visible, completes |
| 12 | Ask a question about the PDF | Answer cites `[1]`, `[2]`… |
| 13 | Settings → Voice → switch to Whisper STT | Click mic, speak, see text appear |
| 14 | Settings → Tools → add MCP server | Status pill goes green |
| 15 | Settings → License | Shows "trial · 14 days remaining" |
| 16 | Quit from tray | Process actually exits (check task manager) |

**One ⌘red on this checklist = do not ship.**

---

## Phase 1 — Infrastructure (do this before money)

### 1.1 Buy and configure your domain

🔴 ⏱ 20 min — 💰 ~$10/yr

1. Register `paia.app` (or whatever) at Cloudflare Registrar
2. Add DNS records:
   - `A` or `CNAME` for the apex → your hosting (set up in 1.2)
   - `MX` records for email forwarding (Cloudflare Email Routing is free)
3. Set up Cloudflare Email Routing:
   - `hello@paia.app` → forwards to your real Gmail
   - `support@paia.app` → forwards to your real Gmail
   - `noreply@paia.app` → DKIM/SPF records for outbound (set up in 3.4)

### 1.2 Host the marketing website

🔴 ⏱ 15 min — 💰 0 (Cloudflare Pages or Netlify free tier)

The site is plain static HTML. Two free options:

**Option A — Cloudflare Pages (recommended)**
1. Push the `website/` folder to a `paia-website` GitHub repo (separate from the code)
2. Cloudflare Pages → Connect repo → Build command: `(none)` → Output dir: `/`
3. Custom domain: point at `paia.app`
4. Done. Free, fast, no rebuild step.

**Option B — Netlify**
Same flow, drag/drop the `website/` folder onto netlify.com.

**After deploy:**
1. Visit your live site
2. Click every link in the nav and footer — fix any 404s
3. Verify the 6 pages all render: `/`, `/pricing.html`, `/privacy.html`, `/download.html`, `/changelog.html`, `/docs.html`
4. Edit [website/download.html](../website/download.html) to point at your real GitHub release URLs
5. Commit + push

### 1.3 Set up an analytics / monitoring stack (optional)

🔴 ⏱ 30 min — 💰 0–10/mo

You DO NOT need analytics on day 1. But you should know if your site is up and if your license server is running.

**Minimum useful monitoring:**

| What | Where | Cost |
|---|---|---|
| Uptime check on `paia.app` | [UptimeRobot](https://uptimerobot.com) free tier | $0 |
| Uptime check on the license-server `/health` endpoint | Same | $0 |
| Site analytics (if you want them) | [Plausible](https://plausible.io) self-hosted on a $5 VPS, or Cloudflare Web Analytics (free, privacy-friendly) | $0–10/mo |
| App-side opt-in analytics endpoint | The same Plausible / PostHog instance — or skip entirely | $0 |

**Action:** at minimum, set up an UptimeRobot check on `https://paia.app/`. Set up the license-server check after Phase 3.2.

### 1.4 Set up a transactional email provider

🔴 ⏱ 20 min — 💰 0

For sending license emails after a purchase. Three good choices:

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** (recommended) | 100/day, 3000/mo | Simplest API, good DX, good deliverability |
| **Postmark** | 100/mo trial | Best deliverability, $15/mo after trial |
| **Mailgun** | 100/day for 3 months | Then $35/mo. Skip unless you already use it. |

**Action:**
1. Sign up for [Resend](https://resend.com)
2. Verify your domain (`paia.app`) by adding the SPF + DKIM DNS records they give you
3. Create an API key → save as `RESEND_API_KEY` (you'll use it in Phase 3.2)
4. Send a test email from their dashboard to confirm delivery

### 1.5 Set up crash reporting (optional, opt-in)

🔴 ⏱ 30 min — 💰 0

Only do this if you actually want users to be able to send you crash reports. Two options:

**Option A — Hosted Sentry (sentry.io)**
- Free tier: 5K events/mo, 1 user
- Create a project → "Electron" → copy the DSN
- Save as `PAIA_BUILTIN_SENTRY_DSN` in GitHub Actions secrets
- That bakes the DSN into release builds — users still have to opt in

**Option B — Self-hosted GlitchTip**
- Sentry-protocol-compatible, free, runs on a $5 VPS
- Better aligned with the "privacy-first" brand
- Setup: `docker compose up -d` from [their docs](https://glitchtip.com/documentation)

**Action:** even if you skip this, document the choice in [DISTRIBUTION.md](DISTRIBUTION.md) so it's clear to users that you don't have crash reporting, not that you're hiding it.

---

## Phase 2 — Code signing (the painful but necessary one)

### 2.1 Buy a Windows code-signing certificate

🔴 ⏱ 1–7 days (vendor verification time) — 💰 $200–400/yr

| Vendor | Cert type | Cost | SmartScreen behavior |
|---|---|---|---|
| **SSL.com EV** | EV (USB token or HSM) | ~$300/yr | Bypasses SmartScreen reputation building entirely. Best option. |
| **Sectigo OV** | OV (file-based) | ~$200/yr | Has to build SmartScreen reputation over weeks/months. Cheaper but worse UX. |
| **DigiCert OV** | OV (file-based) | ~$400/yr | Same as Sectigo but more expensive. Skip. |

**My recommendation:** SSL.com EV. The $100 difference is worth not having angry users for the first 3 months.

**Action:**
1. Buy from [SSL.com](https://ssl.com) or [Sectigo](https://sectigo.com)
2. Complete the **legal entity verification** — this is where they call your bank, ask for D-U-N-S numbers, ask for articles of incorporation. Takes 1–7 business days.
3. Receive the cert. For EV: a USB hardware token. For OV: a `.pfx` file + password.
4. **Test signing manually** before wiring CI:
   ```powershell
   # OV (.pfx)
   signtool sign /fd sha256 /tr http://timestamp.sectigo.com /td sha256 /f cert.pfx /p "password" PAiA-Setup-0.3.0.exe

   # EV (USB token) — requires the vendor's tool installed
   signtool sign /fd sha256 /tr http://ts.ssl.com /td sha256 /sha1 THUMBPRINT PAiA-Setup-0.3.0.exe
   ```
5. Verify with `signtool verify /pa /v PAiA-Setup-0.3.0.exe`

### 2.2 Wire Windows signing into CI

🟡 ⏱ 30 min — 💰 0

For OV (file-based cert), it's straightforward:

1. GitHub repo → Settings → Secrets and variables → Actions → New repository secret
2. Add `WIN_CSC_LINK` — base64-encoded contents of your `.pfx`:
   ```bash
   base64 -w 0 cert.pfx > cert.b64
   # Paste contents of cert.b64 as the secret value
   ```
3. Add `WIN_CSC_KEY_PASSWORD` — the .pfx password
4. Tag a release — CI workflow already reads these vars (set up in [.github/workflows/build.yml](.github/workflows/build.yml))
5. Download the resulting installer from the Release → verify with `signtool verify /pa /v`

For EV (USB token), CI signing is **harder** because the token can't be exported. Two options:
- **Self-hosted runner** on a Windows machine with the token plugged in
- **Cloud signing service** like SSL.com's eSigner (~$10/mo extra)

If you went EV, plan on using eSigner. Update the CI workflow per their docs.

### 2.3 Buy and configure Apple code signing

🔴 ⏱ 1–2 days — 💰 $99/yr

1. Apple Developer Program enrollment at [developer.apple.com/programs](https://developer.apple.com/programs/) — $99/yr, requires legal entity verification (1–2 days for individuals, 1–2 weeks for orgs)
2. Generate two certs in Xcode → Settings → Accounts → Manage Certificates:
   - **Developer ID Application** (signs the .app)
   - **Developer ID Installer** (signs the .pkg if you make one)
3. Note your **Team ID** from developer.apple.com → Membership
4. Generate an **app-specific password** at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
5. Save these to GitHub Actions secrets:
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — the 16-char password from step 4
   - `APPLE_TEAM_ID` — the 10-char team ID from step 3
6. Export the certs as `.p12` and base64-encode them for CI:
   ```bash
   security export -k login.keychain -t identities -f pkcs12 -o macos-certs.p12 -P "exportpassword"
   base64 -w 0 macos-certs.p12 > macos-certs.b64
   ```
7. Add to GitHub secrets:
   - `MAC_CSC_LINK` — base64 contents
   - `MAC_CSC_KEY_PASSWORD` — the export password
8. Edit [package.json](package.json) — flip `mac.notarize` from `false` to `true`
9. Tag a release — CI signs and submits to Apple's notary service automatically (5–15 minutes per build)

> **Notarization gotcha:** every native binary in `node_modules` (sql.js wasm, onnxruntime, etc.) has to be signed too. The hardened runtime entitlements in [assets/entitlements.mac.plist](assets/entitlements.mac.plist) cover the common cases. If notarization fails, the error message tells you which file is the culprit — usually adding `com.apple.security.cs.allow-unsigned-executable-memory` (already there) or `disable-library-validation` (already there) fixes it.

### 2.4 Linux: nothing to sign

🟢 — 💰 0

AppImage and .deb don't require signing for distribution. You can optionally sign your apt repo if you publish to one (we don't yet — Phase 4 work).

---

## Phase 3 — Payments + license issuance

### 3.1 Set up a payment processor

🔴 ⏱ 1 hour — 💰 transaction fees only

Two equally good choices:

| Provider | Take rate | Tax handling | Notes |
|---|---|---|---|
| **Stripe** | 2.9% + 30¢ | You handle sales tax / VAT | More flexible, the standard |
| **LemonSqueezy** | 5% + 50¢ | Merchant of record — they handle EU VAT, sales tax, etc. | Pricier but eliminates a huge legal headache for international sales |

**My recommendation:** **LemonSqueezy** for the first year. The 2% extra is cheap insurance against accidentally owing VAT to 27 EU countries. Switch to Stripe later if you outgrow it.

**Action (LemonSqueezy):**
1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com)
2. Create a **Store** → fill in legal/tax info
3. Create three **Products**:
   - "PAiA Pro Monthly" — $8/mo subscription
   - "PAiA Pro Yearly" — $80/yr subscription (~17% discount)
   - "PAiA Pro Lifetime" — $149 one-time
4. Each product → enable **"License keys"** OFF (we sign our own — LS only triggers the webhook)
5. **Settings → Webhooks → Create webhook**:
   - URL: `https://license.paia.app/webhook/lemonsqueezy` (you'll deploy this in 3.2)
   - Secret: any random string (save it as `LEMONSQUEEZY_WEBHOOK_SECRET`)
   - Events: `Order created`
6. Copy the checkout URLs for each product → these are what you link to from `pricing.html`

### 3.2 Deploy the license-issuance webhook server

🟡 ⏱ 1 hour — 💰 $5/mo (Hetzner / DigitalOcean / Hostinger VPS)

You have three deployment options for [server/license-server.mjs](server/license-server.mjs):

**Option A — Cheap VPS** (recommended)
1. Spin up a $5/mo Ubuntu 24.04 droplet on DigitalOcean / Hetzner / Vultr
2. SSH in, run the deploy script (added below) — it installs Node, sets up systemd, configures nginx + Let's Encrypt
3. Point `license.paia.app` DNS at the VPS IP
4. Set the env vars in `/etc/paia-license/.env`:
   ```
   PAIA_PRIVATE_KEY_B64=<paste from .keys/private.b64>
   LEMONSQUEEZY_WEBHOOK_SECRET=<from step 3.1.5>
   STRIPE_WEBHOOK_SECRET=<if using Stripe>
   RESEND_API_KEY=<from Phase 1.4>
   RESEND_FROM=hello@paia.app
   ```
5. `systemctl restart paia-license`
6. Test: `curl https://license.paia.app/health` should return `ok`

**Option B — Cloudflare Worker** (free, but rewrite needed)
The current `license-server.mjs` uses Node's `http`/`crypto`/`tls` modules. Cloudflare Workers don't run Node — you'd need to port to the Workers fetch handler API. Use this if you want zero infrastructure to babysit. ~1 hour rewrite.

**Option C — Fly.io / Railway** (free tier exists)
Both can run the existing Node script as-is. Fly's free tier is the smallest, Railway gives you $5/mo of credit. Either works. Push the `server/` folder as its own repo, point them at `node license-server.mjs`.

**Action:** pick Option A. The deploy script (added in `server/deploy/`) does almost all of it for you.

### 3.3 Test the webhook end-to-end

🔴 ⏱ 30 min — 💰 0 (in test mode)

1. LemonSqueezy → switch store to **test mode**
2. Make a test purchase using their test card
3. Check `journalctl -u paia-license -f` on the VPS for the incoming webhook
4. Check Resend's dashboard for the outbound license email
5. Open the email, copy the JSON license, paste it into PAiA → Settings → License → Activate
6. Verify the tier flips from "trial" to "Licensed to <your name>"
7. Switch LemonSqueezy back to live mode

**If anything breaks at this stage, fix it now.** A broken webhook on launch day means real customers paying you and not getting their license.

### 3.4 Add the buy buttons to the website

🔴 ⏱ 10 min — 💰 0

Edit [website/pricing.html](../website/pricing.html):
- Find the `<a href="#buy-pro">` and `<a href="#buy-lifetime">` lines
- Replace with the LemonSqueezy checkout URLs from step 3.1.6
- Commit, push

---

## Phase 4 — Legal (the part you actually need a lawyer for)

### 4.1 Privacy policy

🔴 ⏱ 1–2 hours of lawyer time — 💰 $200–500

I've already written a **template** at [website/privacy.html](../website/privacy.html). It's accurate to PAiA's actual data handling. But I'm not a lawyer.

**Action:**
1. Hire a lawyer for a one-time review. Reasonable price points:
   - [Termly](https://termly.io) — $10–30/mo for an automated generator (cheap but generic)
   - [iubenda](https://iubenda.com) — $30/yr for "documents only", $100/yr with cookie banner
   - **An actual lawyer on Upwork** — $200–500 for a one-time review of your existing draft
3. The lawyer's job is to verify it complies with GDPR (EU users), CCPA (California users), and your local privacy laws
4. Update [website/privacy.html](../website/privacy.html) with whatever they suggest
5. Add the date of last review

### 4.2 Terms of Service

🔴 ⏱ 1 hour of lawyer time — 💰 $100–300

Same lawyer can do this in the same session. Required content:
- Who you are, what the software does
- What "Pro" entitles you to
- Refund policy (30 days, no questions, matches website/pricing.html)
- Liability limits (the standard "AS IS, no warranty")
- Dispute resolution + governing law

### 4.3 EULA

🔴 ⏱ 30 min — 💰 0–100

The EULA goes inside the installer (NSIS shows it on Windows). It's usually a shorter version of the ToS focused on the software license itself.

**Action:** I've added a `LICENSE` template in `paia-electron/LICENSE` (added below). Edit the placeholder values, get the lawyer to glance at it during the same session.

### 4.4 Refund policy

🟡 ⏱ 30 min — 💰 0

Already documented on [pricing.html](../website/pricing.html). Make sure your refund process is real:
- Decide who handles refund requests (you, for now)
- Document the refund flow: customer emails support → you process refund in LemonSqueezy → license stops working at end of billing period (or for lifetime: you don't bother removing it)
- Link to your refund policy from the footer of every page

---

## Phase 5 — Closed beta

### 5.1 Recruit beta testers

🔴 ⏱ 1 day — 💰 0

You want **10–20 users** for a closed beta of at least **1 week**.

Sources:
- Personal friends who use desktop apps daily
- Twitter / Mastodon / Bluesky followers
- Hacker News "Show HN: looking for beta testers" post
- /r/LocalLLaMA, /r/selfhosted Reddit posts
- LinkedIn — your professional network

**Action:**
1. Write a single tweet/post: "I built a privacy-first AI desktop assistant. Beta testers wanted — get a free Lifetime license. DM me your OS."
2. Issue free Lifetime licenses for them via `node scripts/issue-license.mjs --private .keys/private.b64 --email beta-tester@example.com --tier pro --name "Tester Name"`
3. Send the welcome email (template added in `BETA_WELCOME_EMAIL.md`)

### 5.2 Set up beta feedback channel

🔴 ⏱ 30 min — 💰 0

You need a single place where beta testers report bugs / feature requests.

Options:
- **Discord server** — easiest, low friction, but messages are ephemeral
- **GitHub Issues** on a public repo — discoverable, structured, but requires GitHub accounts
- **A Notion / Linear board** — best for prioritization, more work for users

**My recommendation:** GitHub Issues. Create a separate `paia-feedback` repo (not the source code repo) so users don't see your private TODO list. Issue templates: `bug`, `feature-request`, `question`.

### 5.3 Run the beta

🔴 ⏱ 1–2 weeks — 💰 0

For each beta tester:
1. Send them the welcome email + license + download link
2. Ask them to run through the smoke checklist (0.7) and report what breaks
3. Ask for one paragraph of "what surprised me" feedback after a week
4. Fix the top 5 issues (whatever they are)
5. Cut a `v0.3.1` patch release with the fixes
6. Ask them to update + retest

**Pass criteria for ending the beta:** at least 7 out of 10 testers say "I'd actually use this" without prompting.

### 5.4 Update the website + changelog

🟡 ⏱ 30 min — 💰 0

After beta:
- Add a "What our beta testers say" section to `index.html` with 2-3 quotes (with permission)
- Update `changelog.html` with the v0.3.1 release notes

---

## Phase 6 — Public launch

### 6.1 Pre-launch checklist (do everything below before announcing)

🟢 ⏱ checklist — 💰 0

```
[ ] All Phase 0 items green
[ ] All Phase 1 items green
[ ] All Phase 2 items green (cert installed, signing works in CI)
[ ] All Phase 3 items green (test purchase → email → activation works)
[ ] Privacy policy + ToS + EULA are lawyer-reviewed and live
[ ] Beta complete with positive feedback
[ ] v0.3.x is stable on Win + Mac + Linux for at least 1 week
[ ] License webhook server has been running 7 days without crashing
[ ] Uptime monitor on website + license server are both green
[ ] Domain DNS is propagated, SSL works
[ ] Resend domain verification is green
[ ] You have a real email account at hello@paia.app that you check daily
[ ] You have screenshots ready for marketing (5+ good ones)
[ ] You have a 60-second demo video (Loom is free)
[ ] You have written your launch posts in advance
[ ] You have the bandwidth to respond to support emails for 48 hours after launch
```

**Do not skip any of these.** Each one prevents a specific failure mode I've seen kill launches.

### 6.2 Announce

🔴 ⏱ 1 day — 💰 0

The standard launch surface:

1. **Hacker News** — "Show HN: PAiA — privacy-first AI desktop assistant" — submit Tuesday or Wednesday morning (US time) for max traffic. Comment yourself first explaining the why.
2. **Product Hunt** — schedule a Tuesday launch. Make a hunter ask in advance.
3. **Reddit** — /r/LocalLLaMA, /r/selfhosted, /r/privacy, /r/macapps, /r/windows. Read each subreddit's rules — some require flair / specific format.
4. **Twitter / X / Bluesky / Mastodon** — your own followers. Thread format works best: "I built X. Here's why. Here's what it does. Here's the link."
5. **Indie Hackers** — milestone post about shipping your first paid product
6. **LinkedIn** — your professional network. More formal tone.

**The most important rule:** be present in the comments. Most launches die because the maker disappears after posting. Stay online for the first 12 hours and reply to every comment within 30 minutes. This is exhausting but it's the difference between #1 on the front page and #50.

### 6.3 Day-one support

🔴 ⏱ 8 hours of attention — 💰 0

The first 24 hours after launch you will get:
- Bug reports (real ones, not the ones from beta — new platforms, new edge cases)
- Refund requests (rare but they happen)
- "Does it support X?" questions
- Feature requests
- Some small percentage of trolls and weirdos (it's the internet)

Have [SUPPORT.md](SUPPORT.md) (added below) open. It has templates for the most common requests. **Reply to everything within an hour for the first day.** Slow replies kill momentum.

---

## Phase 7 — After launch (the part nobody plans for)

### 7.1 First-week metrics

🔴 ⏱ ongoing — 💰 0

Track these (a Notion page or Google Sheet is fine):

| Metric | Target for week 1 |
|---|---|
| Downloads | 200+ |
| Trial activations | 100+ |
| Paid conversions | 5+ |
| Refund rate | <10% |
| Critical bugs reported | <5 |
| Support emails answered | 100% within 24h |

### 7.2 Patch cadence

🟢 ⏱ ongoing — 💰 0

- **Critical bug** (crash on launch, data loss, license not working): patch within 24h
- **Major bug** (feature broken, rendering issue): patch within a week
- **Minor bug / polish**: roll into the next minor release
- **Minor releases**: every 2–4 weeks, batched
- **Major releases**: every 2–4 months

Use semantic versioning: bug fixes = 0.3.x, new features = 0.4.0, breaking changes = 1.0.

### 7.3 Build the second product

🔴 ⏱ ongoing — 💰 0

Once PAiA is generating ~$1000/mo, the right move is to start thinking about #2 — not pour all your time into PAiA polish. The biggest mistake first-time indie devs make is gilding the lily on a single product instead of building a portfolio.

But that's a problem for after Phase 7 starts working.

---

## Quick reference: total cost to launch

| Item | One-time | Recurring |
|---|---|---|
| Domain | — | $10/yr |
| Windows EV cert | — | $300/yr |
| Apple Developer | — | $99/yr |
| Lawyer (privacy + ToS + EULA review) | $300–800 | — |
| VPS for license server | — | $5/mo |
| Resend (free tier covers Phase 0–1) | — | $0 (until 3K emails/mo) |
| LemonSqueezy fees | — | 5% of revenue |
| **Total cash to ship** | **$300–800** | **~$50/mo + 5% of sales** |

That's the floor. You can launch on under $1000 in cash and ~$50/mo in operating cost. Anything more is optional.

---

## What I (Claude) cannot do for you

These are the unblockable items where you have to act yourself:

1. **Make purchases** — certs, Apple Dev, domain, VPS
2. **Sign contracts** — payment processor terms, lawyer engagement letter
3. **Receive verification calls** — cert vendors will call your bank, your registered phone
4. **Hire and brief a lawyer** — they need to review YOUR setup and your business
5. **Recruit beta testers** — your network, your reach
6. **Be present during launch** — replying to comments and emails
7. **Make support decisions** — refund requests, edge cases, ban-or-warn calls

Everything else has a script, a template, or a config file in this repo.
