# PAiA — commercialization playbook

Living document. Check items off as you execute. Phases are sequential;
skipping ahead creates rework.

Last structured update: 2026-04-19 alongside v0.10.0.

## Phase 0 — Foundations (weeks 0-2, decisions only)

- [ ] Form a legal entity (LLC / Ltd / OPC / equivalent). Budget $50–$500.
- [ ] Pick ONE ICP:
  - [ ] Privacy-conscious solo professionals
  - [ ] Developers who want Jarvis
  - [ ] Teachers / tutors running computer labs
- [ ] Pick pricing model. Recommended starting point:
  - Personal Pro: $9 / mo
  - Team: $19 / seat / mo (min 5 seats)
  - 14-day trial, real free tier
- [ ] Write the commercial brief (one page: entity, ICP, pricing,
      positioning). Everything downstream checks back against it.
- [ ] Commit to the "local-first, cloud-optional" narrative in marketing
      even when you offer hosted conveniences. Drifting is how privacy
      companies die.

## Phase 1 — Pre-launch essentials (weeks 2-6)

### Payment infrastructure

- [ ] Pick a merchant of record (Paddle / LemonSqueezy) OR Stripe + a
      tax platform. For non-US founders, MoR is almost always correct.
- [ ] Wire the chosen processor's webhook into
      `server/license-server.mjs`. One day of work.
- [ ] Test checkout end-to-end with a real card twice.

### Code signing + notarization

- [ ] Buy an EV code-signing cert for Windows ($400–$700/yr). Sectigo,
      DigiCert, or SSL.com.
- [ ] Enroll in Apple Developer Program ($99/yr).
- [ ] Generate Developer ID Application cert, export as .p12.
- [ ] Set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in GitHub Actions
      secrets.
- [ ] First tagged build produces signed + notarized artifacts. Follow
      `SIGNING.md`.

### Legal review

- [ ] Send `legal/*.md` to a lawyer in your target jurisdiction. Budget
      2–4 hours of their time, ~$1.5k–$4k.
- [ ] Apply redlines back into the repo.
- [ ] Replace root `LICENSE` with the signed-off EULA.
- [ ] Publish `paia.app/privacy` + `paia.app/terms` at stable URLs
      BEFORE the first paying customer.

### Support infrastructure

- [ ] `support@paia.app` — Help Scout, Google Group, or a shared inbox.
- [ ] `paia.app/status` — one HTML page you edit manually is enough.
- [ ] Docs site covers every Pro-gated feature.
- [ ] Sentry DSN pasted into `settings → privacy` config; crash reports
      flowing.

### Product gates for paid tiers

Already shipped in v0.10+:

- `free`: chat, voice, screen capture, RAG (3-doc cap), memory, slash
  commands, Ollama only, 1 persona, 3 threads retained.
- `pro`: agent mode, deep research, canvas, unlimited RAG, unlimited
  threads, cloud providers, connectors, ambient/autopilot, browser
  agent, remote browser, media generation, API server, E2E sync,
  plugins, multi-window, duplex voice.
- `team`: classroom mode, enforcement, companion PWA, DPA, priority
  support, SSO (future).

- [ ] Final gates enforced across every subsystem (see v0.11).
- [ ] Upgrade prompt UI on gate hit.
- [ ] Trial countdown visible in header after day 7.
- [ ] Soft metering for free-tier features (agent runs / research /
      cloud tokens per day).

### Pricing page + checkout

- [ ] Fill `website/pricing.html` with real numbers + real checkout URL.
- [ ] Add "what stays on your device vs what doesn't" comparison chart.
- [ ] Leave a slot for beta testimonials (fill after beta).

### Release pipeline

- [ ] Pre-release tag convention (`v1.0.0-beta.1`) publishes a
      GitHub Release marked prerelease.
- [ ] Beta users' `electron-updater` channel set to "beta" so they get
      prereleases.

## Phase 2 — Closed beta (weeks 6-10)

### Beta cohort

- [ ] Assemble 50 invites. Target 20 active users.
- [ ] Sources (in quality order):
  - Personal network matching ICP
  - HN "who's looking for testers"
  - Subreddits that match ICP (r/LocalLLaMA / r/Teachers / etc.)
- [ ] Issue invites with
      `node scripts/issue-beta-invite.mjs --email … --name … --cohort wave-1`

### Feedback loops

- [ ] Beta feedback widget endpoint set to a Slack / Discord channel.
- [ ] Weekly 15-min Zooms with 2-3 active users.
- [ ] Track metrics:
  - Activation: % of installed users who send their first message.
    Target >80%.
  - Day-7 retention: target >40%.
  - NPS after 14 days: target >20.
- [ ] Activation <60% → fix onboarding before launch.
- [ ] Day-7 retention <20% → delay launch; sticky problem.

### Bug triage

- [ ] Weekly patch releases to beta.
- [ ] P0 (data loss / crash / paywall bypass) fixed <48h.
- [ ] P1 (major feature broken) fixed within a week.
- [ ] Crash rate <1 per 100 sessions before public launch.

### Pricing calibration

- [ ] Show pricing to 10 beta users. Ask "would you pay?" not "do you
      like?"
- [ ] Move the number until ≥50% say yes without hesitation.
- [ ] Kill features no beta user used.

## Phase 3 — Public launch (week 10-11, one hard day)

### T-week

- [ ] Day -7: email beta, give launch date, request amplification.
- [ ] Day -5: Product Hunt "upcoming" page live.
- [ ] Day -3: tweets + LinkedIn + Show HN drafts finalized.
- [ ] Day -2: regression on `npm run dist` on all three platforms.
- [ ] Day -2: upload signed artifacts to GitHub Releases, tag `v1.0.0`.
- [ ] Day -1: sleep.

### Launch day — Tuesday or Wednesday at 08:00 Pacific

- [ ] **T+0:** publish Show HN (use `marketing/HACKERNEWS.md`).
- [ ] **T+15m:** Product Hunt launch live.
- [ ] **T+30m:** Twitter/X thread.
- [ ] **T+1h:** r/LocalLLaMA + r/selfhosted (check rules first).
- [ ] **T+3h:** LinkedIn, newsletter.
- [ ] All day: reply to every comment within 15 minutes.

### Launch-day infrastructure gates

- [ ] Download links working + CDN verified.
- [ ] Checkout tested with a real card twice.
- [ ] Support inbox monitored.
- [ ] Sentry + analytics dashboards open.
- [ ] FAQ answers: "is it open source", "do you store my chats", "does
      it work offline", "how is this different from ChatGPT".

### Pre-empt failure modes

- [ ] Paywall bypass via devtools — license checks run in main process,
      not renderer. Verify in a packaged build.
- [ ] Cloud call without opt-in — run the app offline in Wireshark one
      last time before launch.
- [ ] Hug of death on `paia.app/download.html` — GitHub Releases
      handles, but stress-test any redirect.

## Phase 4 — Early growth (months 4-9)

Pick **two** channels. Ignore the rest.

### Content engine (recommended #1)

- [ ] One blog post per week.
- [ ] Hosted at `paia.app/blog`.
- [ ] Every post aims at one long-tail SEO keyword.
- [ ] Topics that work:
  - "Running a fully offline coding agent on a Mac Mini"
  - "Why I built my own Jarvis instead of subscribing"
  - Tutorial per integration
  - Comparisons: PAiA vs ChatGPT Desktop vs Claude Desktop vs Raycast
    AI

### Dev community (recommended #2)

- [ ] Ship one plugin per month into `plugins-examples/`.
- [ ] Each plugin = one blog post + one r/LocalLLaMA post.
- [ ] Engage in HN comments on AI / privacy threads as yourself.
- [ ] Open-source `src/shared/redaction.ts` as a standalone npm
      package.

### Partnerships

- [ ] Submit Home Assistant plugin to HA community integrations.
- [ ] Ask Ollama to add PAiA to their "apps using Ollama" page.
- [ ] Obsidian / Logseq / Notion community integrations (RAG + memory).

### Anti-patterns — don't

- [ ] Don't buy Google Ads until $10k MRR (CPA for privacy-tool
      keywords is brutal).
- [ ] Don't hire marketing before $10k MRR.
- [ ] Don't chase enterprise before $30k MRR from self-serve.
- [ ] Don't build a feature because one loud user asked. Three
      unrelated users = a signal.

## Phase 5 — Scale decisions (months 9-18)

At $10k MRR, address in order:

- [ ] Hire #1: part-time customer support.
- [ ] Hire #2: another engineer OR a designer (by backlog shape).
- [ ] Hand-sell 3-5 enterprise deals before a salesperson.
- [ ] Open plugin marketplace only after ~20 organic third-party
      plugins exist.
- [ ] Translate top 3 revenue-generating locales via human translators
      (~$2k/language).
- [ ] Mobile native app — deliberately last. Companion PWA carries
      until phone users are 30% of revenue.

## Realistic cost + milestone table

| Milestone | Wall-clock | Direct cost |
|---|---|---|
| Entity + legal | Week 2 | $3.1k |
| Signed installers | Week 4 | $500 |
| Payments + license flow | Week 4 | $0 |
| Beta launch | Week 6 | $50/mo infra |
| Public launch | Week 10-11 | $0 |
| $1k MRR | Month 4-6 | $100/mo |
| $10k MRR | Month 9-14 | $500/mo |
| Hire #1 | Month 12-16 | $1500-3000/mo |

**Minimum to launch:** ~$3,500 out-of-pocket. Everything else is time.

**12-month realistic revenue band:** $30k–$120k. Median indie dev-tool
launch does $15k and sunsets. Variance is mostly distribution, not
product.

## Commercial brief (fill before Phase 1)

_Keep this section one page._

**Legal entity:**  
`[name, jurisdiction]`

**Primary ICP:**  
`[one sentence]`

**Pricing:**  
`[free / pro / team $]`

**Positioning line:**  
`[≤12 words]`

**What we DON'T do (guardrails against drift):**  
`[one-line per non-goal]`
