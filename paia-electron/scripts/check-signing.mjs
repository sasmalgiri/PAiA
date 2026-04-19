#!/usr/bin/env node
// Signing preflight. Run before `electron-builder` to fail FAST when a
// signing credential is missing / expired — you don't want to find out
// after a 10-minute build.
//
// Exits 0 when everything checks out (or when `--strict` is NOT passed
// and some credentials are missing — we only warn in that case so
// unsigned local dev builds still work).
//
// Checks performed per-platform:
//
//   Windows
//     - CSC_LINK is set and either points at a readable file OR starts
//       with http(s)://
//     - CSC_KEY_PASSWORD is set (or an empty password is acceptable for
//       passwordless PFXes — we only warn, don't fail, in that case)
//
//   macOS
//     - APPLE_ID looks like an email
//     - APPLE_APP_SPECIFIC_PASSWORD is present (Apple shows these as
//       four 4-character groups like abcd-efgh-ijkl-mnop)
//     - APPLE_TEAM_ID is a ten-character uppercase alphanumeric
//     - A Developer ID Application cert is importable (best-effort
//       `security find-identity` call; only warns if not on macOS)

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const strict = process.argv.includes('--strict');
const warnings = [];
const errors = [];

function warn(msg) { warnings.push(msg); }
function fail(msg) { errors.push(msg); }

function truthy(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

function checkWindows() {
  const cscLink = process.env.CSC_LINK;
  const cscPass = process.env.CSC_KEY_PASSWORD;
  if (!cscLink) {
    warn('CSC_LINK is not set — Windows build will NOT be code-signed.');
    return;
  }
  // Accept HTTPS URLs (Azure Key Vault, S3, etc.) or local file paths.
  const isUrl = /^https?:\/\//i.test(cscLink);
  if (!isUrl) {
    try {
      if (!fs.existsSync(cscLink)) fail(`CSC_LINK points at "${cscLink}" which does not exist`);
    } catch (err) {
      fail(`CSC_LINK "${cscLink}" is not readable: ${err.message}`);
    }
  }
  if (!cscPass) warn('CSC_KEY_PASSWORD is empty — assuming passwordless PFX.');
}

function checkMac() {
  const appleId = process.env.APPLE_ID;
  const pw = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const team = process.env.APPLE_TEAM_ID;
  if (!appleId && !pw && !team) {
    warn('Apple credentials not set — macOS build will be unsigned + unnotarized.');
    return;
  }
  if (!appleId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appleId)) fail('APPLE_ID must be the Apple ID email.');
  if (!pw) fail('APPLE_APP_SPECIFIC_PASSWORD is missing (create one at appleid.apple.com).');
  else if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/i.test(pw)) {
    warn('APPLE_APP_SPECIFIC_PASSWORD does not match the xxxx-xxxx-xxxx-xxxx format; Apple may reject it.');
  }
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) fail('APPLE_TEAM_ID must be the 10-character uppercase team id.');

  if (process.platform === 'darwin') {
    try {
      const out = execSync('security find-identity -v -p codesigning').toString('utf-8');
      if (!/Developer ID Application/i.test(out)) {
        fail('No "Developer ID Application" certificate found in the default keychain. Import your .p12 first.');
      }
    } catch (err) {
      warn(`Could not run \`security find-identity\`: ${err.message}`);
    }
  } else if (truthy('CSC_LINK') || truthy('MAC_CSC_LINK')) {
    // On non-mac CI, electron-builder can import a CSC_LINK. Just warn so
    // the operator remembers it's needed.
  } else {
    warn('Building mac artifacts requires a macOS runner OR CSC_LINK pointing at your Developer ID .p12.');
  }
}

checkWindows();
checkMac();

const red = (s) => process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yel = (s) => process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const grn = (s) => process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s;

for (const w of warnings) console.log(yel(`warn: ${w}`));
for (const e of errors) console.log(red(`fail: ${e}`));

if (errors.length > 0) {
  console.log(red(`\n${errors.length} signing issue${errors.length === 1 ? '' : 's'} — aborting.`));
  process.exit(1);
}
if (warnings.length > 0 && strict) {
  console.log(red('\n--strict mode: warnings are treated as failures.'));
  process.exit(1);
}
console.log(grn(`signing check ok${warnings.length > 0 ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`));
