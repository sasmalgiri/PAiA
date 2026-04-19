# Launch day — operational runbook

One-hour-before-launch, launch-day, and launch-week checklists. Keep
this tab open on launch day. Check off as you go.

**Target launch slot:** Tuesday or Wednesday, **08:00 Pacific** (best
for Hacker News / Product Hunt concurrency on English-speaking
engineering audiences).

---

## T-7 days

- [ ] Pick the date. Block the entire day + the next one off.
- [ ] Email beta cohort: launch date, request amplification.
- [ ] Create Product Hunt "upcoming" page, schedule for T+0.
- [ ] Draft Show HN post in `marketing/HACKERNEWS.md` — keep it
      under-pitched.
- [ ] Draft Twitter/X thread in `marketing/TWITTER.md`.
- [ ] Draft LinkedIn post in `marketing/LINKEDIN.md` — professional
      voice, different angle than HN.
- [ ] Confirm every subreddit post's rules allow self-promo; if not,
      skip that one.
- [ ] Line up one friend per channel as a reply-seed (HN, PH, Reddit,
      LinkedIn). Not to astroturf — to make sure the first five
      comments aren't tumbleweeds.
- [ ] Test the full purchase flow with a real card twice, from two
      different computers. Verify email delivery of the license blob.
      Verify activation succeeds.

## T-3 days

- [ ] Final regression pass: `npm run lint && npx vitest run && npm run
      pack` on macOS, Windows, Linux. Install the packaged build on a
      fresh user profile and smoke-test the golden path:
  - [ ] Onboarding all 5 steps
  - [ ] Chat with a local model
  - [ ] Voice in / voice out
  - [ ] Screen capture + OCR
  - [ ] Agent run (with cloud key if configured)
  - [ ] Checkout + license activation
- [ ] Drive the crash rate dashboard to <1 per 100 sessions. If loud,
      delay.
- [ ] Confirm status.html shows everything green.
- [ ] Confirm security.txt is reachable at both paths.
- [ ] Confirm sitemap.xml + robots.txt are live.

## T-1 day

- [ ] Tag `v1.0.0` in git. Wait for CI to build all three platforms.
- [ ] Confirm signed Windows installer opens without SmartScreen
      warning.
- [ ] Confirm notarized macOS DMG passes `spctl --assess`.
- [ ] Confirm Linux AppImage runs on a Debian-derivative + a Fedora.
- [ ] Upload every artifact to the GitHub Release. Mark as "Latest
      release", not prerelease.
- [ ] Cross-check `paia.app/download.html` links to the real artifacts.
- [ ] Set up the monitoring tabs (see "monitoring" below).
- [ ] Go to bed early. No late-night hero commits.

## T-0 — launch day

### T+0 minutes

- [ ] **08:00 PT:** publish Show HN. Submit the title; paste your
      long-form intro as the first comment within 60 seconds.
- [ ] Mark Product Hunt upcoming page as Launched (PH does this at
      00:01 PT automatically).
- [ ] Pin your Twitter launch thread.

### T+15 minutes

- [ ] Reply to the first HN comment regardless of its tone. Set the
      inbox norm: the author is here and responsive.
- [ ] Post to LinkedIn.
- [ ] Post to r/LocalLLaMA (rules-aware phrasing — "I built" is fine;
      "you should buy" is not).
- [ ] Post to r/selfhosted, r/Anthropic, r/OpenAI, r/privacy (pick 2-3
      whose rules allow it).

### T+1 hour

- [ ] Post to personal Twitter/X with the product-thread link.
- [ ] Email your newsletter (if you have one).
- [ ] Reply to every single comment. Still. Keep going.

### T+3 hours

- [ ] First break. Eat something. Do NOT check the HN ranking again
      until T+4h — the algorithm punishes active-checking behaviour.

### All day (run these tabs in a pinned window)

- [ ] GitHub Releases download-counter per asset
- [ ] Sentry issue feed
- [ ] Merchant dashboard (sales ticker)
- [ ] Support inbox
- [ ] HN comment thread
- [ ] Product Hunt comments
- [ ] Twitter mentions
- [ ] Reply SLA: < 15 minutes for the first 6 hours, < 1 hour for the
      rest of day 1.

### Before you go to sleep

- [ ] Write a `launch-day-retrospective.md` while it's fresh. What
      questions came up most? Any confusion you should fix tomorrow?
- [ ] Tomorrow's first-hour plan: top 3 things to change based on
      day-1 feedback.

## T+1 to T+7 (launch week)

- [ ] Ship a patch release every 24-48 hours if there's any friction
      to sand off. Velocity during launch week is a trust signal.
- [ ] Publish a "launch day, by the numbers" post on day 2 or 3. HN
      loves transparency.
- [ ] Follow up personally with anyone who emailed support or replied
      on HN.
- [ ] Day 7: open a weekly office-hours slot (Calendly or Cal.com) at
      a fixed time for the next 4 weeks. Real conversations with real
      users drive the next quarter's roadmap more than any analytics.

---

## Monitoring — what to watch

| Dashboard | URL | Watching for |
|---|---|---|
| GitHub Releases | `https://github.com/<you>/paia/releases/tag/v1.0.0` | Download counters per platform |
| Sentry | your DSN's web console | New crash signatures, error spikes |
| Merchant (Paddle / LS / Stripe) | provider dashboard | Successful purchases, declines, refund requests |
| Email inbox | support@paia.app | User questions, bug reports |
| HN | the specific story URL | Comment count, upvotes, position on front page |
| Product Hunt | your listing | Upvotes, comments |
| Twitter | mentions of "PAiA" and "@paia_app" | Bug reports people don't email, testimonials |
| Reddit | submitted posts | Comment replies, questions |
| `paia.app/status.html` | updated manually | Known incidents |

## Failure-mode playbook

| Problem | Immediate response | Post-mortem action |
|---|---|---|
| "Won't install on Windows — SmartScreen blocks" | Reply with exact right-click → Properties → Unblock steps. Publish a post explaining the 30-day EV cert reputation window. | Confirm EV cert was used; check reputation score weekly. |
| "Notarization failed on macOS" | Ask user to send the specific Gatekeeper error. Acknowledge + commit to fix in the next patch. | Run `spctl --assess` ourselves; run Apple `notarytool log <id>` if the signature rejects. |
| "Ollama not found" | Ack; note that Onboarding step 2 has the install command. Offer to walk them through by email. | Add a "Download Ollama for me" button that shells `curl` on macOS/Linux if the user clicks. |
| "Paywall bypass via X" | Acknowledge on HN, thank them. Ship a patch release within 48 hours. | Review every gate for similar patterns. |
| Sentry shows a new crash affecting >1% of sessions | Ship a patch within 24 hours. Publish changelog entry. | Add a vitest for the crashing codepath. |
| "Cloud call happened without me opting in" | IMMEDIATE top priority. Reply, apologize, reproduce locally. Ship a patch within 6 hours regardless of quality gates. | Write a vitest asserting the opt-in boundary. |
| HN front-page dwell ≥ 6 hours | Nothing. You did it. | Schedule a "thank you" Twitter thread for tomorrow. |
| Merchant account limit hit / fraud-flag freeze | Email processor support. Have the KYC docs ready. | Next day, write an idle "backup merchant" runbook so this can't block a launch twice. |

---

## Post-launch — day 8 onwards

- [ ] Pick 2 channels from `COMMERCIALIZATION.md` Phase 4 (content
      engine + dev community, typically). Commit to weekly output on
      both for six months.
- [ ] Book 2 user calls / week. Ask "what almost-but-didn't work" —
      those are the Pro features for the next quarter.
- [ ] Every 4 weeks, review the pricing page conversion rate. Move the
      number up or down until the yes-rate in user calls crosses 50%.
- [ ] Every 8 weeks, read your CHANGELOG and your support inbox and
      write a "what's genuinely changed" blog post. Boring to write,
      but it compounds.

---

## Pre-mortem (fill in before launch day)

Answer these honestly the week before. If any answer is "we'll figure
it out", that's a launch blocker.

1. What's the single most likely way this goes sideways in the first
   24 hours?
2. If that happens, what's my response — publicly and technically —
   in the first 30 minutes?
3. What's the 7-day metric that will tell me the launch worked?
   (Typical: paid conversions / total installs; target 1–5%.)
4. What's the 30-day metric that will tell me the product worked?
   (Typical: day-30 retention of paid customers; target >85%.)
5. At what point do I stop launching and start shipping? (Answer
   should be a calendar date, not a vibe.)
