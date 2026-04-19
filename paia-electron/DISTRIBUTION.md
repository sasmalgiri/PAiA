# PAiA — Distribution & licensing playbook

This is the operational checklist for taking PAiA from "compiles on a dev box"
to "I can sell this to strangers." It covers icons, code signing, the license
key system, and the release pipeline.

## 1. Icons

Source vector lives at [assets/icon.svg](assets/icon.svg). To produce the
raster files `electron-builder` needs:

```bash
npm install -g electron-icon-builder
electron-icon-builder --input=assets/icon.svg --output=assets --flatten
```

That writes `assets/icon.png`, `icon.ico`, and `icon.icns`. Commit them.

## 2. Code signing — Windows (Authenticode)

You need an Authenticode certificate. Cheap options:

| Vendor | ~Cost / yr | Notes |
|---|---|---|
| SSL.com EV | ~$300 | EV bypasses SmartScreen reputation building entirely |
| Sectigo OV | ~$200 | OV must build SmartScreen reputation over time |
| DigiCert OV | ~$400 | Same |

Once you have a `.pfx` file:

```powershell
$env:CSC_LINK = "C:\path\to\paia-cert.pfx"
$env:CSC_KEY_PASSWORD = "..."
npm run dist:win
```

`electron-builder` reads `CSC_LINK` and `CSC_KEY_PASSWORD` automatically.
The signed installer drops in `release/PAiA-Setup-<version>.exe`.

For an EV cert on a USB token, follow electron-builder's docs on
`win.certificateSubjectName` instead — the token can't be exported.

## 3. Code signing — macOS (Developer ID)

You need an Apple Developer account ($99/yr) and the
**Developer ID Application** + **Developer ID Installer** certs in your
local keychain.

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
npm run dist:mac
```

Then **flip `mac.notarize` from `false` to `true` in package.json** before
shipping. electron-builder will submit the .dmg to Apple's notary service
automatically (takes a few minutes per build).

The hardened runtime + entitlements file is already wired up in
[assets/entitlements.mac.plist](assets/entitlements.mac.plist).

## 4. Linux

No signing required, but the repos people will use are:

- **AppImage** — drop on the website
- **deb** — push to your own apt repo or `cloudsmith.io`
- **flatpak** — separate manifest, future work

## 5. Auto-update

Set `build.publish.owner` in [package.json](package.json) to your real
GitHub org/user, then:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The CI workflow at [.github/workflows/build.yml](.github/workflows/build.yml)
picks up the tag, builds all 3 platforms, and uploads the installers as a
GitHub Release. The running app polls that release feed via
[electron-updater](https://www.electron.build/auto-update) and notifies
the user when an update is available.

## 6. License key system

PAiA uses **Ed25519** signatures verified offline. The system has two parts:

### One-time setup (when you start selling)

```bash
node scripts/issue-license.mjs --gen-keys
```

This drops `.keys/private.b64` and `.keys/public.b64` into the project. **Commit nothing in `.keys/`** — add it to `.gitignore`. The private key never leaves your machine; the public key gets baked into release builds:

```bash
PAIA_PUBLIC_KEY="$(cat .keys/public.b64)" npm run dist
```

(Or hard-code it in [src/main/license.ts](src/main/license.ts) and rebuild.)

### Per-customer issuance

After a successful purchase, run:

```bash
node scripts/issue-license.mjs \
  --private .keys/private.b64 \
  --email customer@example.com \
  --name "Customer Name" \
  --tier pro \
  --expires 2027-04-01
```

The script prints a JSON blob. Email that to the customer. They paste it into Settings → License → Activate. Done. No phone-home, no DRM dance.

### Integrating with Stripe / LemonSqueezy

Wrap `issue-license.mjs` in a webhook handler:

```js
// pseudo-code
app.post('/stripe-webhook', async (req) => {
  if (req.body.type === 'checkout.session.completed') {
    const email = req.body.data.object.customer_email;
    const license = execSync(`node issue-license.mjs --private private.b64 --email ${email} --tier pro`).toString();
    await sendEmail(email, 'Your PAiA license', license);
  }
});
```

### Trial mode

A 14-day trial is built in. On first launch, [src/main/license.ts](src/main/license.ts) writes `userData/trial.json`. During the trial every Pro feature is unlocked. When the trial expires, the user falls back to the free tier (chat + voice + multi-thread) until they activate a license.

The trial state lives in a local file — anyone determined enough can reset it. That's fine. The honest customer pays. The pirate isn't your customer anyway.

## 7. Free vs Pro

The split is enforced by [src/main/license.ts](src/main/license.ts):

| Feature | Free | Pro |
|---|---|---|
| Chat with local Ollama models | ✅ | ✅ |
| Multi-thread history | ✅ | ✅ |
| Personas (built-in) | ✅ | ✅ |
| Voice input + TTS | ✅ | ✅ |
| Screen capture (full screen) | ✅ | ✅ |
| Slash commands | ✅ | ✅ |
| **RAG / knowledge collections** | ❌ | ✅ |
| **Region screen capture** | ❌ | ✅ |
| **MCP tool servers** | ❌ | ✅ |
| **Cloud providers (OpenAI, Anthropic, …)** | ❌ | ✅ |
| **Custom personas** | ❌ | ✅ |

Edit `FREE_FEATURES` and `PRO_FEATURES` in [src/main/license.ts](src/main/license.ts) to change the split.

## 8. Privacy policy / ToS / EULA

Required before public launch. Get a real lawyer.
Templates: [termly.io](https://termly.io), [iubenda.com](https://iubenda.com).

The minimum content for PAiA's privacy story:

> PAiA is a desktop application. Your conversations, voice recordings, screen
> captures, and uploaded documents are processed entirely on your computer.
> They are not transmitted to PAiA's servers.
>
> PAiA does optionally connect to:
> - A local Ollama daemon on 127.0.0.1 (you must install and run it).
> - The official Hugging Face CDN to download the Whisper speech model on
>   first use, if you select the Whisper STT engine.
> - The official Tesseract OCR data CDN, if you use screen capture OCR.
> - GitHub Releases, to check for updates (only if auto-update is enabled).
> - Optional cloud LLM providers (OpenAI, Anthropic, etc.) if you explicitly
>   enable them in Settings → General. Their privacy policies apply.
>
> PAiA collects no analytics, no telemetry, and no crash reports unless you
> opt in (Phase 2).

## 9. Pre-launch checklist

- [ ] Real `assets/icon.{png,ico,icns}` files
- [ ] Real `build.publish.owner` in package.json
- [ ] Authenticode cert configured in CI secrets
- [ ] macOS Developer ID + notarization configured in CI secrets
- [ ] Public Ed25519 key embedded via `PAIA_PUBLIC_KEY`
- [ ] Privacy policy published on website
- [ ] ToS and EULA published on website
- [ ] Stripe / LemonSqueezy webhook live
- [ ] Support email working
- [ ] First crash-reporting backend (Phase 2 — GlitchTip self-hosted recommended)
- [ ] Closed beta with 10–20 users for at least a week
- [ ] Smoke-tested on Windows 10 + Windows 11 + macOS Sonoma + Ubuntu 22.04
