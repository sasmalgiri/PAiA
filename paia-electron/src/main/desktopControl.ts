// OS-level mouse + keyboard automation via nut-js.
//
// Power-user territory. Every public function in this module requires:
//   1. `settings.osAutomationEnabled === true` (off by default).
//   2. Agent-autonomy gating in the caller (each tool is tagged 'high').
//
// The nut-js fork ships prebuilt native binaries for Win/Mac/Linux; we
// lazy-load so a user who never enables this never pays the startup cost.
// On Wayland, nut-js fails gracefully — we surface that as an error
// rather than crashing the agent loop.

import * as settingsStore from './settings';
import { logger } from './logger';

type NutModule = typeof import('@nut-tree-fork/nut-js');

let nutPromise: Promise<NutModule> | null = null;

async function loadNut(): Promise<NutModule> {
  if (!nutPromise) {
    nutPromise = import('@nut-tree-fork/nut-js').then((mod) => {
      // Short timeouts so a misfire doesn't freeze the agent.
      mod.mouse.config.mouseSpeed = 1000; // px/s
      mod.keyboard.config.autoDelayMs = 25;
      return mod;
    });
  }
  return nutPromise;
}

function assertEnabled(): void {
  if (!settingsStore.load().osAutomationEnabled) {
    throw new Error(
      'OS-level desktop automation is disabled. Enable it in Settings → Privacy → OS automation (off by default).',
    );
  }
}

// ─── mouse ─────────────────────────────────────────────────────────

export async function mouseMove(x: number, y: number): Promise<void> {
  assertEnabled();
  const { mouse, Point, straightTo } = await loadNut();
  logger.info?.('[desktop] mouseMove', { x, y });
  await mouse.move(straightTo(new Point(x, y)));
}

export async function mouseClick(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  assertEnabled();
  const { mouse, Button } = await loadNut();
  const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
  logger.info?.('[desktop] mouseClick', { button });
  await mouse.click(btn);
}

export async function mouseDoubleClick(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  assertEnabled();
  const { mouse, Button } = await loadNut();
  const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
  await mouse.doubleClick(btn);
}

export async function mouseScroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
  assertEnabled();
  const { mouse } = await loadNut();
  const n = Math.max(1, Math.min(50, Math.trunc(amount)));
  if (direction === 'up') await mouse.scrollUp(n);
  else if (direction === 'down') await mouse.scrollDown(n);
  else if (direction === 'left') await mouse.scrollLeft(n);
  else await mouse.scrollRight(n);
}

export async function mousePosition(): Promise<{ x: number; y: number }> {
  assertEnabled();
  const { mouse } = await loadNut();
  const p = await mouse.getPosition();
  return { x: p.x, y: p.y };
}

// ─── keyboard ──────────────────────────────────────────────────────

export async function keyboardType(text: string): Promise<void> {
  assertEnabled();
  if (typeof text !== 'string') throw new Error('text must be a string');
  // Clamp insane payloads: the LLM is well-meaning but mistakes happen.
  const capped = text.length > 4000 ? text.slice(0, 4000) : text;
  const { keyboard } = await loadNut();
  await keyboard.type(capped);
}

// Map common human-readable key names to the Key enum. We deliberately
// limit the surface to what the Agent realistically needs, rather than
// exposing every key. The Key enum in nut-js uses title-case names
// ("LeftControl", "A", "F5", "Num1"), so we normalise aggressively.
async function resolveKeys(keys: string[]): Promise<number[]> {
  const { Key } = await loadNut();
  const KeyAny = Key as unknown as Record<string, number>;
  const aliases: Record<string, string> = {
    ctrl: 'LeftControl',
    control: 'LeftControl',
    cmd: 'LeftCmd',
    meta: 'LeftSuper',
    super: 'LeftSuper',
    win: 'LeftSuper',
    alt: 'LeftAlt',
    option: 'LeftAlt',
    shift: 'LeftShift',
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  };
  function resolve(k: string): number {
    const low = k.toLowerCase();
    const aliased = aliases[low];
    if (aliased !== undefined) {
      const code = KeyAny[aliased];
      if (typeof code === 'number') return code;
    }
    // Single letter → uppercase ("a" → "A").
    if (k.length === 1 && /[a-zA-Z]/.test(k)) {
      const code = KeyAny[k.toUpperCase()];
      if (typeof code === 'number') return code;
    }
    // Single digit → "Num1" etc.
    if (/^\d$/.test(k)) {
      const code = KeyAny[`Num${k}`];
      if (typeof code === 'number') return code;
    }
    // Function key: "f1" → "F1".
    if (/^f(\d{1,2})$/i.test(k)) {
      const code = KeyAny[`F${k.slice(1)}`];
      if (typeof code === 'number') return code;
    }
    // Last resort: try the raw string + title-cased.
    const raw = KeyAny[k];
    if (typeof raw === 'number') return raw;
    const titled = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    const t = KeyAny[titled];
    if (typeof t === 'number') return t;
    throw new Error(`Unknown key: ${k}`);
  }
  return keys.map(resolve);
}

export async function keyboardShortcut(keys: string[]): Promise<void> {
  assertEnabled();
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys[] is required');
  if (keys.length > 6) throw new Error('shortcut has at most 6 keys');
  const { keyboard } = await loadNut();
  const resolved = await resolveKeys(keys);
  await keyboard.pressKey(...resolved);
  await keyboard.releaseKey(...resolved);
}

// ─── screen ────────────────────────────────────────────────────────

export async function screenSize(): Promise<{ width: number; height: number }> {
  assertEnabled();
  const { screen } = await loadNut();
  const width = await screen.width();
  const height = await screen.height();
  return { width, height };
}
