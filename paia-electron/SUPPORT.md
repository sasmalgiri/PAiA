# PAiA — Support runbook

When a customer email lands in `support@paia.app`, this is your reference
for triaging it. Each section has:

- **Detection** — what the email looks like
- **Action** — what to do (and what NOT to do)
- **Reply template** — copy/paste/customize

The goal: respond to every customer within 1 hour for the first week,
within 24 hours steady-state. Most customers are nice. The ones who
aren't usually want a refund and to never see you again — give it to
them and move on.

---

## 0. Triage rules of thumb

| Rule | Why |
|---|---|
| Reply within 24h, ALWAYS | Slow replies become 1-star reviews |
| Read the whole email before replying | Saves a back-and-forth |
| If it's a real bug, file it on the feedback repo and link in your reply | Customers love seeing their report turn into an issue |
| Refund first, debate never | A $8 refund is cheaper than 30 minutes of arguing |
| Don't promise features you don't plan to ship | Better to say "no, but here's what we DO have" |
| If you don't know, say so | "I'm not sure — let me check tomorrow and reply" beats wrong answers |

---

## 1. License key didn't arrive

**Detection:** "I bought Pro but never got my license email"

**Action:**
1. Check Resend's dashboard — did the email send?
2. If not, check `journalctl -u paia-license -f` on the license server — did the webhook fire?
3. If the webhook fired but Resend didn't deliver, check spam/bounce reports
4. If the webhook never fired, check Stripe/LemonSqueezy webhook logs for retries
5. Manually re-issue the license:
   ```bash
   ssh license-server
   sudo -u paia node /opt/paia-license/issue-cli.mjs \
     --email customer@example.com \
     --tier pro
   ```
6. Email it directly

**Reply template:**

> Hey {name},
>
> Sorry about that — looks like our delivery to {email} got delayed. Your license is below; copy the entire JSON block (including the curly braces) and paste it into PAiA → Settings → License → Activate.
>
> ```
> {LICENSE_JSON}
> ```
>
> Let me know if it activates correctly. Thanks for your patience.
>
> — {your-name}

---

## 2. Refund request

**Detection:** "I'd like a refund"

**Action:**
1. Process the refund **immediately** in LemonSqueezy/Stripe — don't ask why
2. Reply within an hour
3. Take notes (in a Notion page or spreadsheet) about WHY they refunded — patterns matter
4. If they said why, ask one polite follow-up about whether you can fix it for them

**Reply template:**

> Hey {name},
>
> Refund processed — you'll see it back on your card in 5–10 business days. No hard feelings.
>
> If you have a moment, I'd love to know what didn't work for you. Even one sentence helps me make PAiA better. (Genuinely no pressure though.)
>
> — {your-name}

---

## 3. Activation isn't working

**Detection:** "I pasted the license but the trial banner is still there"

**Action:**
1. Common causes (in order of frequency):
   - User pasted only the inner braces, not the entire JSON
   - User's clipboard mangled the JSON (line wrapping, smart quotes)
   - Old build that has the wrong public key embedded
   - Their license file got truncated by their email client
2. Ask them to send a screenshot of the License tab
3. Have them try pasting the JSON into a text file first, then copying from there

**Reply template:**

> Hey {name},
>
> A few things to check:
>
> 1. Make sure you copied the **entire** JSON block including the outer `{` and `}`.
> 2. Don't copy from a previewing email — it sometimes wraps lines or replaces quotes. Open the email in plain text mode if possible.
> 3. After pasting, click **Activate** (not Enter).
>
> If it still says "trial," send me a screenshot of Settings → License and the version number from Settings → About. I'll dig in from there.
>
> — {your-name}

---

## 4. Crash on launch

**Detection:** "App crashes immediately when I open it"

**Action:**
1. Ask for OS + version + processor (Intel/Apple Silicon) + PAiA version
2. Ask them to delete `~/Library/Application Support/paia` (macOS) or `%APPDATA%/paia` (Windows) and try again
3. If it persists, ask them to launch from terminal:
   - macOS: `/Applications/PAiA.app/Contents/MacOS/PAiA`
   - Windows: `"C:\Program Files\PAiA\PAiA.exe"` from PowerShell
   - Linux: `./PAiA-0.3.0-x64.AppImage --enable-logging`
4. Have them paste the console output

**Reply template:**

> Hey {name},
>
> Sorry it's not launching. To diagnose:
>
> 1. **OS, processor, PAiA version, please?**
> 2. Try a clean state: delete the user data folder and relaunch.
>    - Windows: `%APPDATA%/paia`
>    - macOS: `~/Library/Application Support/paia`
>    - Linux: `~/.config/paia`
>
> 3. If it still crashes, open a terminal and launch the app from there. Whatever it prints — error messages, stack trace, anything — paste back to me.
>
> Will get this sorted as soon as I see the output.
>
> — {your-name}

---

## 5. Ollama not detected

**Detection:** "PAiA says Ollama is not running"

**Action:**
1. Ask: have they installed Ollama from ollama.com?
2. Is the Ollama service actually running? (`ollama list` from a terminal should work)
3. Check if a firewall is blocking 127.0.0.1:11434
4. Some users run Ollama on a non-default port — check `OLLAMA_HOST` env var

**Reply template:**

> Hey {name},
>
> PAiA talks to Ollama on `127.0.0.1:11434`. Quick checks:
>
> 1. **Is Ollama installed?** `ollama --version` in a terminal should print a version. If not, grab it from ollama.com/download.
> 2. **Is the service running?** `ollama list` should show your installed models. On macOS the menubar Ollama icon should be present; on Linux `systemctl status ollama`.
> 3. **Have you pulled at least one model?** `ollama pull llama3.2` (≈2 GB).
> 4. **Custom port?** If you set `OLLAMA_HOST` to anything other than the default, PAiA can't see it yet — let me know and I'll add a setting.
>
> Try those and let me know how far you get.
>
> — {your-name}

---

## 6. Feature request

**Detection:** "It would be cool if PAiA could…"

**Action:**
1. Acknowledge — they took time to write
2. Don't promise. Don't reject. Just file it.
3. Open an issue on the feedback repo with a `feature-request` label
4. Reply with the issue link

**Reply template:**

> Hey {name},
>
> Filed it — {ISSUE_URL}. I'll think about whether/how to fit it into a future release. The fact that you took the time to suggest it actually helps me prioritize.
>
> No promises on timing, but I read every one of these.
>
> — {your-name}

---

## 7. Pricing question

**Detection:** "What's the difference between Pro and Lifetime?" / "Do you have a team plan?" / "Is there a student discount?"

**Action:**
1. Point at the pricing page
2. For team: ask seat count, give a quote off-list (50% off for 5+ seats is reasonable)
3. For students: just give them a free Lifetime if they have a .edu email — costs you nothing, builds goodwill

**Reply template:**

> Hey {name},
>
> Quick rundown:
>
> - **Pro Monthly** ($8/mo) is best if you want to try Pro for a few months before committing
> - **Pro Lifetime** ($149) pays for itself after ~19 months and includes 2 years of major updates
>
> {if team:} For team licenses I do volume pricing — 5+ seats is 50% off. How many seats?
>
> {if student:} Send me a screenshot of your student ID or .edu email and I'll comp you a Lifetime license. Stay in school.
>
> — {your-name}

---

## 8. Privacy concern

**Detection:** "Does PAiA send my data anywhere?" / "Is it really local?"

**Action:**
1. Send them to the privacy page
2. If they have a specific concern, address it directly
3. Don't be defensive — these are exactly the customers PAiA was built for

**Reply template:**

> Hey {name},
>
> Privacy page is at https://paia.app/privacy and it lists every single network call PAiA makes — including the optional ones.
>
> The one-line summary: by default, PAiA only talks to your local Ollama daemon on the loopback interface. Voice, screen capture, OCR, RAG, chat history — all local.
>
> Optional connections (each gated by a setting that defaults to off): Whisper model download from Hugging Face on first use, Tesseract language data on first use, GitHub releases for auto-update, DuckDuckGo for `/search`, cloud LLM providers if you opt in.
>
> If you're worried about something specific, ask away.
>
> — {your-name}

---

## 9. "Does PAiA support [other LLM provider]?"

**Detection:** "Does it work with [Together / Groq / OpenRouter / LM Studio / vLLM / etc.]?"

**Action:** Yes — explain the OpenAI-compatible provider option.

**Reply template:**

> Hey {name},
>
> Yes — PAiA has an OpenAI-compatible provider you can point at any base URL. Settings → General → Allow cloud models → Settings → Models → OpenAI-compatible → enable → paste the base URL and API key.
>
> Tested with: LM Studio, Together, OpenRouter, Groq, Cerebras, vLLM, Ollama-OpenAI-shim. Works with anything that implements the OpenAI chat-completions endpoint.
>
> — {your-name}

---

## 10. Linux: "wake word doesn't work" / "active window doesn't work"

**Detection:** Linux-specific platform integration questions

**Action:** Document your way out. The known limitations are in [PHASE2_NOTES.md](PHASE2_NOTES.md) and the docs page.

**Reply template:**

> Hey {name},
>
> Linux platform integration is the rough edge of PAiA right now.
>
> **Active window detection** works on:
> - X11 with `xdotool` installed
> - Wayland + GNOME with the `window-calls` extension
> - Wayland + KDE Plasma
> - Hyprland
>
> If you're on a Wayland setup that's not in that list, it won't work yet.
>
> **Wake word** requires manually installing two npm packages (`@picovoice/porcupine-node` and `@picovoice/pvrecorder-node`) into the unpacked app directory because Picovoice is commercial software with a paid commercial tier. Steps are in the docs.
>
> If either is a blocker, let me know which distro/desktop combo you're on and I'll add proper support in the next release.
>
> — {your-name}

---

## 11. Trolls / weirdos / abuse

**Detection:** Profanity, threats, demands without context, unhinged tone.

**Action:**
1. **Don't engage.** Don't argue. Don't explain.
2. If they paid: refund them immediately and block their email/checkout
3. If they didn't pay: ignore, or one polite "I'm not the right help for this" reply, then block
4. Take a screenshot for your records
5. Move on

**Reply template (only if you choose to reply at all):**

> Thanks for the message. I don't think PAiA is the right product for you, and I won't be able to help further. Refund processed if applicable.
>
> — {your-name}

---

## 12. The unknown unknowns

When you get an email that doesn't fit any of the above:

1. Read it twice
2. Ask one clarifying question if you need to
3. If it's complex, reply with "I want to make sure I understand. Let me dig in and reply tomorrow."
4. Then actually reply tomorrow
5. After resolving, **add a new section to this file** so the next instance is faster

The runbook gets better with use. Don't let knowledge stay in your head.
