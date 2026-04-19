// Region screen capture.
//
// Workflow:
//   1. capturePrimaryDisplay() — grabs the full primary screen as a
//      nativeImage at the display's pixel resolution
//   2. openRegionOverlay() — pops a transparent, click-through-disabled,
//      always-on-top window covering the primary display. The overlay
//      renders a dim layer + a rubber-band selection rectangle.
//   3. The overlay calls back to main with the selected rect (in CSS px).
//   4. main converts CSS px → device px using the display's scale factor
//      and crops the captured image with nativeImage.crop().
//   5. The cropped data URL is returned to the original caller (the chat
//      flow) for OCR + display in the message.

import { BrowserWindow, desktopCapturer, nativeImage, screen, ipcMain, type Rectangle } from 'electron';
import * as path from 'path';
import { logger } from './logger';

let overlay: BrowserWindow | null = null;
let pendingResolve: ((rect: Rectangle | null) => void) | null = null;

/**
 * Captures the primary display at full resolution and returns a
 * nativeImage. This is the highest-fidelity image we can get from
 * Electron without platform-specific FFI.
 */
async function captureFullPrimary(): Promise<Electron.NativeImage> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  // Multiply by scale factor so we capture at native pixels, not CSS px.
  const scaled = {
    width: Math.round(width * display.scaleFactor),
    height: Math.round(height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: scaled,
  });
  // Find the primary screen source — its display_id matches the primary's id.
  const primary = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!primary) throw new Error('No screen source available');
  return primary.thumbnail;
}

/**
 * Opens the rubber-band overlay and resolves to the user's selection
 * rectangle (CSS px relative to the primary display origin) or null on
 * cancel. Only one overlay can be open at a time.
 */
function openRegionOverlay(): Promise<Rectangle | null> {
  if (overlay) {
    overlay.close();
    overlay = null;
  }
  const display = screen.getPrimaryDisplay();
  const { workArea, bounds } = display;

  return new Promise((resolve) => {
    pendingResolve = resolve;

    overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      fullscreenable: false,
      // Need pointer events; not click-through.
      focusable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.loadFile(path.join(__dirname, '..', 'renderer', 'region.html'));
    overlay.once('ready-to-show', () => {
      overlay?.show();
      overlay?.focus();
    });

    overlay.on('closed', () => {
      overlay = null;
      // If the window was closed without a selection (user pressed Esc
      // and we already resolved, this is a no-op), make sure the
      // promise resolves so callers don't hang.
      if (pendingResolve) {
        pendingResolve(null);
        pendingResolve = null;
      }
    });
    void workArea; // suppress unused
  });
}

ipcMain.handle('paia:region-result', (_e, rect: Rectangle | null) => {
  if (pendingResolve) {
    pendingResolve(rect);
    pendingResolve = null;
  }
  if (overlay) {
    overlay.close();
    overlay = null;
  }
});

ipcMain.handle('paia:region-cancel', () => {
  if (pendingResolve) {
    pendingResolve(null);
    pendingResolve = null;
  }
  if (overlay) {
    overlay.close();
    overlay = null;
  }
});

/**
 * Public: capture a user-selected region of the primary screen.
 * Returns a PNG data URL of the cropped region, or null if cancelled.
 */
export async function captureRegion(): Promise<string | null> {
  const fullImage = await captureFullPrimary();
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor;

  const rect = await openRegionOverlay();
  if (!rect) return null;
  if (rect.width < 4 || rect.height < 4) return null;

  // Convert CSS pixels (what the overlay reports) to device pixels (what
  // the captured image uses).
  const deviceRect: Rectangle = {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };

  try {
    const cropped = fullImage.crop(deviceRect);
    return cropped.toDataURL();
  } catch (err) {
    logger.error('region crop failed', err);
    return null;
  }
}
