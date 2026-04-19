#!/usr/bin/env node
// electron-builder afterSign hook — notarize the macOS .app bundle with
// Apple's notary service.
//
// No-op outside macOS builds so the hook is safe in any electron-builder
// invocation. Also no-op when credentials are missing, so `npm run dist`
// locally produces an unsigned + unnotarized build rather than erroring.
//
// Uses Apple's modern `notarytool` via `xcrun`. We stream its output so
// you can see progress; it typically finishes in 30–120 seconds.

import { execSync } from 'node:child_process';
import * as path from 'node:path';

export default async function notarize(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !password || !teamId) {
    console.log('notarize: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping notarization.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`notarize: submitting ${appPath} to Apple…`);

  // notarytool submit expects a ZIP or DMG. electron-builder hasn't built
  // the DMG yet at afterSign time, so we zip the .app ourselves.
  const zipPath = path.join(appOutDir, `${appName}.zip`);
  try {
    execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

    const submitCmd =
      `xcrun notarytool submit "${zipPath}"` +
      ` --apple-id "${appleId}"` +
      ` --password "${password}"` +
      ` --team-id "${teamId}"` +
      ` --wait`;

    execSync(submitCmd, { stdio: 'inherit' });

    // Once approved, staple the ticket so Gatekeeper works offline.
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('notarize: success.');
  } catch (err) {
    console.error('notarize: FAILED.', err.message);
    throw err;
  } finally {
    try { execSync(`rm -f "${zipPath}"`); } catch { /* ignore */ }
  }
}
