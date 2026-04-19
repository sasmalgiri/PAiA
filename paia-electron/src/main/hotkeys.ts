// Configurable global hotkeys. Three actions: showHide (toggle the ball),
// capture (trigger a screen capture), pushToTalk (start/stop voice).

import { globalShortcut } from 'electron';
import type { HotkeyMap } from '../shared/types';
import { logger } from './logger';

export interface HotkeyHandlers {
  onShowHide: () => void;
  onCapture: () => void;
  onPushToTalk: () => void;
  onQuickActions: () => void;
}

let registered: HotkeyMap | null = null;

export function registerHotkeys(map: HotkeyMap, handlers: HotkeyHandlers): void {
  unregisterHotkeys();

  const tries: { accel: string; fn: () => void; label: string }[] = [
    { accel: map.showHide,     fn: handlers.onShowHide,     label: 'showHide' },
    { accel: map.capture,      fn: handlers.onCapture,      label: 'capture' },
    { accel: map.pushToTalk,   fn: handlers.onPushToTalk,   label: 'pushToTalk' },
    { accel: map.quickActions, fn: handlers.onQuickActions, label: 'quickActions' },
  ];

  const success: Partial<HotkeyMap> = {};
  for (const t of tries) {
    if (!t.accel) continue;
    try {
      const ok = globalShortcut.register(t.accel, t.fn);
      if (ok) {
        logger.info(`hotkey ${t.label} → ${t.accel}`);
        (success as Record<string, string>)[t.label] = t.accel;
      } else {
        logger.warn(`hotkey ${t.label} could not register: ${t.accel}`);
      }
    } catch (err) {
      logger.warn(`hotkey ${t.label} threw:`, err);
    }
  }

  registered = map;
}

export function unregisterHotkeys(): void {
  if (!registered) return;
  globalShortcut.unregisterAll();
  registered = null;
}

export const DEFAULT_HOTKEYS: HotkeyMap = {
  showHide: 'Control+Alt+P',
  capture: 'Control+Alt+S',
  pushToTalk: 'Control+Alt+V',
  quickActions: 'Control+Alt+Q',
};
