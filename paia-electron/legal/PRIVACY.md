# PAiA Privacy Policy (TEMPLATE)

> ⚠️ Template — not lawyer-reviewed. Fill in the `[BRACKETS]`, then have
> counsel qualified in your jurisdiction review it before publishing.

**VERSION:** 0.1-draft
**Effective:** `[DATE]`

## Who we are

PAiA is published by `[YOUR LEGAL ENTITY, JURISDICTION]` ("we", "us").
You can reach us at `[privacy@example.com]` or by post at `[PHYSICAL
ADDRESS, if required]`.

If you are in the EEA or UK and we are required to designate a data
protection officer, our DPO is `[NAME OR EMAIL]`.

## Our privacy posture in one paragraph

PAiA is a desktop application that runs primarily on your own computer.
Your conversations, voice recordings, screen captures, knowledge-stack
documents, memory entries, agent runs, and artifacts are stored in an
encrypted SQLite database on your machine at `[userData path varies by
OS — see docs]`. We do not receive, store, or have access to any of
this content. This policy describes the narrow set of cases where
PAiA talks to the network, and what happens when it does.

## Data categories + what we do with each

### 1. Everything inside the app (default)

Conversations, attached files, knowledge collections, memory entries,
agent runs, research reports, artifacts, plugin data, classroom
activity logs, ambient suggestions, settings, hotkey bindings,
personas.

- **Where stored:** locally on your device in `paia.sqlite` and related
  JSON files.
- **Who can read it:** only a process on your device with access to your
  user profile.
- **When it leaves your device:** never, unless YOU explicitly enable a
  feature below that transmits some of it.

### 2. Cloud LLM providers (opt-in)

If you enable "Allow cloud models" in Settings and supply an OpenAI /
Anthropic / OpenAI-compatible API key, your prompts — redacted for the
eleven PII categories PAiA detects — are sent to the provider you chose.
PAiA is not a party to that transmission; your relationship is directly
with the provider under their own privacy terms.

### 3. Sync backend (opt-in, E2E encrypted)

If you configure sync with a passphrase, PAiA encrypts every object
client-side with AES-256-GCM before uploading. The storage operator
(WebDAV host, S3 bucket, local folder paired with Syncthing/Dropbox)
sees object counts and byte sizes but cannot decrypt content. PAiA
itself never sees the ciphertext or the passphrase.

### 4. Connectors (opt-in)

If you connect Gmail / Calendar / Drive / GitHub / Slack, the OAuth
tokens are stored on your device and used only to make API calls you
(or an approved agent step) initiated. The tokens never leave your
device to our servers.

### 5. Crash reports (opt-in)

Disabled by default. If you paste a Sentry DSN into Settings → Privacy
and tick "Enable crash reports", PAiA sends error stack traces to that
DSN. Before sending, PAiA runs the same PII redactor as on chat
prompts and scrubs `event.user`, `server_name`, console + DOM input
breadcrumbs. If you later change the DSN to a blank field, sending
stops immediately.

### 6. Anonymous usage analytics (opt-in)

Disabled by default. If you enable analytics in Settings → Privacy,
PAiA POSTs `{ name, props }` JSON payloads to the endpoint you
configured. A per-install UUID is generated once and stored in
`anonymous-id.txt`; you can reset it at any time. Events are
whitelist-enforced: only well-known event names ship, and only the
whitelisted properties inside them.

### 7. Auto-update

If you have "Check for updates automatically" enabled, PAiA asks the
GitHub Releases endpoint for this repo whether a newer version exists
and, if so, downloads the installer. GitHub sees the request IP and
user agent. See GitHub's own privacy policy for what they do with
those.

### 8. License verification

If you activate a paid license, the signed license file is stored on
your device. We do not call home to verify every launch. If you use
an online activation endpoint for your license, that endpoint receives
your license key; see `[your activation endpoint's privacy page]`.

## What we DO NOT collect

- Screen captures or OCR results — these stay on your device.
- Voice recordings or transcripts — Whisper and Piper run locally.
- Chat history.
- Documents added to knowledge collections.
- Anything produced by agent runs, research runs, or canvas artifacts.
- Browsing done through the browser-use or remote-browser tools.

## Subprocessors

A current list of third parties who may touch limited customer data in
the course of delivering the paid tiers is maintained at
[SUBPROCESSORS.md](SUBPROCESSORS.md) and on our website at
`[https://paia.app/subprocessors]`.

## Your rights (EEA / UK / California)

Depending on where you live, you may have rights to access, correct,
delete, restrict processing of, or port your personal data, and to
object to or opt out of certain processing. You can exercise these
rights by contacting us at `[privacy@example.com]`. Because most PAiA
data lives on your own device, "deletion" usually just means clearing
the app's data directory yourself; for data we do hold (license
records, opt-in crash reports that included your DSN, feedback you
submitted through the app), we will act on valid requests within
`[30]` days.

## Children

PAiA is not directed at children under 13 (or the equivalent minimum
age in your jurisdiction). We do not knowingly collect data from
children.

## Security

We use industry-standard safeguards, including:
- AES-256-GCM for sync, PBKDF2 with 200,000 iterations for key derivation.
- Ed25519 signatures for licenses and beta invites.
- Strict Content-Security-Policy in the renderer.
- Signed installers on macOS and Windows (when available).

No security is perfect. If you discover a vulnerability, please report
it via [RESPONSIBLE_DISCLOSURE.md](RESPONSIBLE_DISCLOSURE.md).

## International transfers

Because most PAiA data never leaves your device, most of this section
is not applicable. Where transfers do occur (e.g., your opt-in crash
DSN is hosted in a different country to yours), the transfer is
between you and your chosen provider — PAiA does not proxy the data.

## Changes to this policy

We'll update this document when the app's data behaviour changes.
Material changes trigger a one-time acknowledgement modal on launch.
Older versions are archived in the git history of this repo.

## Contact

`[privacy@example.com]`
`[POSTAL ADDRESS if required in your jurisdiction]`

---

**Change log**

- 0.1 `[DATE]` — initial template draft.
