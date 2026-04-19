# Beta tester welcome email — template

Subject: **You're in the PAiA beta**

---

Hey {{name}},

Thanks for jumping into the PAiA beta. Quick context, then everything you need to get started.

## What is PAiA?

A privacy-first AI desktop assistant. It lives as a small ball in your screen corner. Click it to chat, talk, capture your screen, search the web, work with documents — all running locally on your machine. No cloud, no telemetry, no surveillance. The opposite of Microsoft Recall.

## Your license

Below is your free Lifetime Pro license — it never expires, works on up to 3 of your machines. Save this email.

```
{{LICENSE_JSON_BLOB}}
```

## Install

| OS | Download |
|---|---|
| Windows | {{WINDOWS_URL}} |
| macOS (Apple Silicon) | {{MACOS_ARM_URL}} |
| macOS (Intel) | {{MACOS_X64_URL}} |
| Linux (AppImage) | {{LINUX_APPIMAGE_URL}} |
| Linux (.deb) | {{LINUX_DEB_URL}} |

The installer is unsigned for now (code signing certs are coming next week). On Windows you'll see a SmartScreen warning — click "More info" then "Run anyway." On macOS, right-click → Open the first time.

## Get set up

1. Install the app
2. Install [Ollama](https://ollama.com/download) if you don't already have it
3. Run the first-launch wizard. It'll offer to pull `llama3.2` for you (~2 GB)
4. Open Settings → License → paste the JSON above into the Activate field
5. The status pill should flip to "Licensed to {{name}}"

## What I want from you

- **Run through the smoke checklist** (attached as a separate doc, 16 items, ~15 minutes). Tell me which ones broke.
- **Use it for a week as you normally would.** Not "test" it — actually use it. Take notes when something annoys you.
- **One paragraph of feedback at the end.** What surprised you? What would you change? Would you actually use it?

## How to report bugs

- **Critical bug (crash, data loss, license broken):** reply to this email immediately
- **Anything else:** open an issue at {{FEEDBACK_REPO_URL}} — labels for `bug`, `feature-request`, `question`
- **Discord:** join the beta channel at {{DISCORD_INVITE}} for live chatter

## What's already known to be rough

- The installers are unsigned — Windows SmartScreen and macOS Gatekeeper will warn. Real certs by EOW.
- Wake word requires a Picovoice account + manual `npm install` of the porcupine packages. Skip this feature for the beta unless you specifically want to test it.
- Auto-update isn't wired to a real release feed yet — for now, I'll email you when there's a new build.

## Thank you

Genuinely. Beta testers are gold. The whole point of this is to find what breaks before strangers do.

Talk soon,
{{your-name}}
{{your-email}}

---

P.S. The smoke checklist is in the next email. If you don't see it, check spam.
