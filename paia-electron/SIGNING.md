# Code signing + notarization

Everything below is scaffolding that sits idle until you supply real
credentials. `npm run dist` produces unsigned installers when nothing is
configured; local development works without touching any of this.

## Preflight

```
npm run signing:check           # warns on missing creds, exits 0
npm run signing:check:strict    # warnings become failures, for CI tags
```

The preflight covers:

- `CSC_LINK` (Windows cert path/URL) is readable or a valid https URL.
- `CSC_KEY_PASSWORD` is present (passwordless PFX is a warning, not a fail).
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` are all set
  and shaped correctly.
- On macOS hosts, a `Developer ID Application` certificate is importable
  via `security find-identity`.

Run it BEFORE spending 10 minutes on a full `electron-builder` run.

## Windows Authenticode

1. Obtain an EV code-signing cert (Sectigo, DigiCert, SSL.com — ~$400/yr).
2. Export as `.p12` / `.pfx`.
3. Set env vars before `npm run dist:win`:

   ```
   export CSC_LINK=/absolute/path/to/paia-codesign.p12   # or an https URL
   export CSC_KEY_PASSWORD="<password you set when exporting>"
   ```

   electron-builder auto-imports the cert and signs the installer. You
   can verify with:

   ```
   signtool verify /pa /v release/PAiA-Setup-<version>.exe
   ```

4. (Optional) Flip `build.win.verifyUpdateCodeSignature: true` in
   `package.json` so auto-updates refuse unsigned updates. Only do this
   AFTER your first signed release is published — otherwise existing
   installs will refuse to take the first signed update.

### Azure Key Vault signing (no local PFX)

electron-builder 25 supports Azure Trusted Signing via the
`signingHashAlgorithms` + external signer flow. Set `CSC_LINK` to an
https URL pointing at your vault-managed cert and `CSC_KEY_PASSWORD`
to the vault access token. (Internal docs only — this path requires a
Microsoft partner account for EV-equivalent signing.)

## macOS Developer ID + notarization

1. Enroll in Apple Developer Program ($99/yr).
2. Generate a **Developer ID Application** certificate in your developer
   account. Download the `.cer`, install into Keychain on the signing
   machine, then export as `.p12` with a password.
3. Create an **app-specific password** at <https://appleid.apple.com>
   for notarization.
4. Set env vars before `npm run dist:mac`:

   ```
   export APPLE_ID=you@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   export APPLE_TEAM_ID=AB12CD34EF
   # On non-mac hosts (CI) you also need the cert itself:
   export CSC_LINK=/abs/path/to/DeveloperID.p12
   export CSC_KEY_PASSWORD="<p12 password>"
   ```

5. `scripts/notarize.mjs` runs automatically as an `afterSign` hook —
   it zips the `.app`, calls `xcrun notarytool submit … --wait`, and
   staples the ticket on success. The call blocks the build until Apple
   returns; budget 30–120 seconds in steady state.

6. Verify the final DMG:

   ```
   spctl --assess --type open --context context:primary-signature -vv release/PAiA-<version>-arm64.dmg
   ```

   You should see `accepted` and `source=Notarized Developer ID`.

## CI wiring

GitHub Actions secrets (`Settings → Secrets and variables → Actions`):

| Secret | Scope | Description |
|---|---|---|
| `WIN_CSC_LINK` | Windows build | Path or https URL to the `.p12` |
| `WIN_CSC_KEY_PASSWORD` | Windows build | p12 password |
| `APPLE_ID` | macOS build | Developer Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS build | `xxxx-xxxx-xxxx-xxxx` |
| `APPLE_TEAM_ID` | macOS build | 10-character team id |

The workflow runs `signing:check:strict` on tag pushes so a missing or
malformed credential aborts the build immediately instead of after
compilation.

## Troubleshooting

**`notarytool` says "Invalid".** Fetch the log:

```
xcrun notarytool log <submission-id> --apple-id $APPLE_ID \
  --password $APPLE_APP_SPECIFIC_PASSWORD --team-id $APPLE_TEAM_ID
```

Most common cause: a binary in `asarUnpack` was missing `hardenedRuntime`
entitlements. Add the missing entitlement to `assets/entitlements.mac.plist`
and rebuild.

**Windows SmartScreen warning persists after signing.** Regular OV code
signing cert → expect ~30 days of "reputation building" before SmartScreen
stops warning. EV certs ($$$) bypass this.

**`spctl` says `rejected`.** Either the signature is corrupt or the staple
didn't attach. Re-run with verbose flags:

```
codesign --verify --deep --strict --verbose=2 /Applications/PAiA.app
spctl --assess --verbose=4 /Applications/PAiA.app
```
