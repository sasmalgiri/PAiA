// Auto-update wiring via electron-updater. Configured to publish via
// GitHub Releases — see the `build.publish` block in package.json.
//
// On dev/local builds the updater is a no-op (electron-updater detects
// `app.isPackaged === false` and short-circuits).

import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import type { UpdateInfo } from '../shared/types';
import { logger } from './logger';

autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow: BrowserWindow | null = null;

export function attachUpdater(win: BrowserWindow): void {
  mainWindow = win;

  autoUpdater.on('update-available', (info) => {
    logger.info('update available', info.version);
    mainWindow?.webContents.send('paia:update-available', {
      available: true,
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    } satisfies UpdateInfo);
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('no updates');
  });

  autoUpdater.on('error', (err) => {
    logger.error('updater error', err);
  });

  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('paia:update-progress', p);
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('paia:update-downloaded');
  });
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) return { available: false };
    const cur = autoUpdater.currentVersion.version;
    const next = result.updateInfo.version;
    return {
      available: next !== cur,
      version: next,
      releaseNotes:
        typeof result.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate();
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
