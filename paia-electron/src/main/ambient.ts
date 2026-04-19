// Ambient / proactive watcher.
//
// Runs in the background when `settings.ambient.enabled`. On every tick:
//
//   1. Samples the active window and clipboard (respecting the per-source
//      watch toggles).
//   2. Runs a small suite of HEURISTIC triggers that look for obvious
//      situations where the user probably wants help:
//        - An error string is selected / on the clipboard
//        - A stack trace is in the clipboard
//        - A URL sits on the clipboard
//        - The user has been idle on the same file for a while (editor in
//          foreground, same title for N polls)
//        - Optional screen-OCR pass finds error / exception / traceback
//          keywords on-screen
//   3. If a trigger fires AND we're not in cooldown, pushes a
//      `paia:ambient-suggestion` event to the renderer. The renderer owns
//      the toast UI and calls back when the user accepts or dismisses.
//
// Triggers are deliberately conservative — the point is to be useful
// without being creepy. Everything is local; nothing leaves the machine
// until the user accepts a suggestion.
//
// The ambient watcher respects classroom mode: in student mode with the
// policy disallowing agent/web tools, suggestions that would invoke them
// are suppressed.

import { app, clipboard, ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import type {
  AmbientSettings,
  AmbientSuggestion,
  AmbientTriggerKind,
} from '../shared/types';
import * as settingsStore from './settings';
import * as classroom from './classroom';
import * as plugins from './plugins';
import * as autopilot from './autopilot';
import { notify } from './notifications';
import { getActiveWindow } from './activeWindow';
import { logger } from './logger';

let timer: NodeJS.Timeout | null = null;
// Increments on every start/restart. The tick loop checks its captured
// generation against the current value and aborts if it's stale — so a
// rapid restart() can't leave an old in-flight runTick firing under
// new-generation settings.
let generation = 0;
let activeWindow: Electron.BrowserWindow | null = null;

const recent: AmbientSuggestion[] = [];
const lastFiredAt: Record<AmbientTriggerKind, number> = {
  'error-on-screen': 0,
  'question-in-clipboard': 0,
  'long-idle-on-file': 0,
  'url-in-clipboard': 0,
  custom: 0,
};

interface TickState {
  lastClipboard: string;
  lastActiveKey: string;
  sameActiveTicks: number;
}
const tick: TickState = {
  lastClipboard: '',
  lastActiveKey: '',
  sameActiveTicks: 0,
};

export function setActiveWindow(win: Electron.BrowserWindow): void {
  activeWindow = win;
}

function send(channel: string, payload: unknown): void {
  activeWindow?.webContents.send(channel, payload);
}

// ─── triggers ─────────────────────────────────────────────────────

interface TriggerContext {
  settings: AmbientSettings;
  clipboardText: string;
  activeTitle: string;
  activeApp: string;
  activeUrl?: string;
}

type Trigger = (ctx: TriggerContext) => AmbientSuggestion | null;

const ERROR_PATTERNS = [
  /\b(?:Error|Exception|Traceback|Unhandled|Uncaught)\b[^\n]{0,200}/,
  /\b(?:TypeError|ValueError|ReferenceError|SyntaxError|NullPointerException)\b/,
  /Error:\s*\S[^\n]+/,
];

const QUESTION_PATTERNS = [
  /^how (?:do|can|should) i\b/i,
  /^why (?:is|does|doesn't|don't)\b/i,
  /^what (?:is|are|does)\b/i,
  /\?$/, // ends with a question mark
];

const URL_PATTERN = /^https?:\/\/[^\s]+$/;

const errorTrigger: Trigger = ({ clipboardText }) => {
  if (!clipboardText) return null;
  for (const re of ERROR_PATTERNS) {
    const m = clipboardText.match(re);
    if (m) {
      const excerpt = clipboardText.slice(0, 300);
      return {
        id: randomUUID(),
        kind: 'error-on-screen',
        title: 'Looks like an error',
        detail: m[0].slice(0, 140),
        actionPrompt: `I just copied this error. Help me debug it:\n\n${excerpt}`,
        actionKind: 'chat',
        createdAt: Date.now(),
      };
    }
  }
  return null;
};

const questionTrigger: Trigger = ({ clipboardText }) => {
  if (!clipboardText || clipboardText.length > 400 || clipboardText.length < 10) return null;
  for (const re of QUESTION_PATTERNS) {
    if (re.test(clipboardText.trim())) {
      return {
        id: randomUUID(),
        kind: 'question-in-clipboard',
        title: 'Answer this?',
        detail: clipboardText.slice(0, 140),
        actionPrompt: clipboardText,
        actionKind: 'chat',
        createdAt: Date.now(),
      };
    }
  }
  return null;
};

const urlTrigger: Trigger = ({ clipboardText }) => {
  const trimmed = clipboardText.trim();
  if (!URL_PATTERN.test(trimmed)) return null;
  return {
    id: randomUUID(),
    kind: 'url-in-clipboard',
    title: 'Summarize this URL?',
    detail: trimmed,
    actionPrompt: `Fetch this URL and give me a concise summary with the key points: ${trimmed}`,
    actionKind: 'agent',
    createdAt: Date.now(),
  };
};

const idleTrigger: Trigger = ({ activeApp, activeTitle }) => {
  if (!activeApp || !activeTitle) return null;
  if (tick.sameActiveTicks < 6) return null; // ~1 minute at default poll
  const lower = activeApp.toLowerCase();
  if (!/vscode|code|idea|pycharm|cursor|sublime|emacs|vim|neovim/.test(lower)) return null;
  return {
    id: randomUUID(),
    kind: 'long-idle-on-file',
    title: 'Stuck on something?',
    detail: `You've been on "${activeTitle}" for a while.`,
    actionPrompt: `I've been staring at ${activeTitle}. What would you ask if you were me?`,
    actionKind: 'chat',
    createdAt: Date.now(),
  };
};

const builtinTriggers: Trigger[] = [errorTrigger, questionTrigger, urlTrigger, idleTrigger];

function allTriggers(): Trigger[] {
  const pluginTriggers: Trigger[] = plugins.contributedAmbientTriggers().map((t) => (ctx) =>
    t.fn({
      clipboardText: ctx.clipboardText,
      activeTitle: ctx.activeTitle,
      activeApp: ctx.activeApp,
    }),
  );
  return [...builtinTriggers, ...pluginTriggers];
}

// ─── main loop ────────────────────────────────────────────────────

async function runTick(gen: number): Promise<void> {
  // Guard against a tick scheduled by a previous generation that's
  // still in flight when start()/restart() is called.
  if (gen !== generation) return;
  const settings = settingsStore.load();
  if (!settings.ambient.enabled) return;

  const ctx: TriggerContext = {
    settings: settings.ambient,
    clipboardText: settings.ambient.watchClipboard ? clipboard.readText().trim() : '',
    activeTitle: '',
    activeApp: '',
  };

  if (settings.ambient.watchActiveWindow) {
    try {
      const aw = await getActiveWindow();
      if (aw) {
        ctx.activeApp = aw.appName;
        ctx.activeTitle = aw.title;
        ctx.activeUrl = aw.url;
        const key = `${aw.appName}|${aw.title}`;
        if (key === tick.lastActiveKey) tick.sameActiveTicks++;
        else { tick.sameActiveTicks = 0; tick.lastActiveKey = key; }
      }
    } catch {
      /* non-fatal */
    }
  }

  // Only fire a trigger when the clipboard actually changed since last tick;
  // we don't want to nag repeatedly about the same content.
  const clipboardChanged = ctx.clipboardText !== tick.lastClipboard;
  tick.lastClipboard = ctx.clipboardText;

  for (const trigger of allTriggers()) {
    try {
      const candidate = trigger(ctx);
      if (!candidate) continue;

      // Clipboard-based triggers only fire when the clipboard changed.
      if ((candidate.kind === 'error-on-screen' || candidate.kind === 'question-in-clipboard' || candidate.kind === 'url-in-clipboard') && !clipboardChanged) {
        continue;
      }

      // Classroom-aware filtering.
      const policy = classroom.currentPolicy();
      if (policy) {
        if (candidate.actionKind === 'agent' && !policy.allowAgent) continue;
        if (candidate.actionKind === 'research' && !policy.allowWebTools) continue;
      }

      // Cooldown per trigger kind.
      const now = Date.now();
      const cooldownMs = settings.ambient.cooldownSeconds * 1000;
      if (now - lastFiredAt[candidate.kind] < cooldownMs) continue;
      lastFiredAt[candidate.kind] = now;

      recent.unshift(candidate);
      if (recent.length > 50) recent.pop();

      // Autopilot: if the user has pre-approved this pattern, fire it
      // silently instead of asking. Autopilot.fire() emits its own
      // notification so the user knows something happened.
      const rule = autopilot.find(candidate);
      if (rule) {
        candidate.resolvedAt = Date.now();
        candidate.resolution = 'accepted';
        logger.info(`ambient: autopilot "${rule.name}" fired on ${candidate.kind}`);
        void autopilot.fire(rule, candidate);
      } else {
        send('paia:ambient-suggestion', candidate);
        notify({
          title: candidate.title,
          body: candidate.detail,
          silent: true,
        });
        logger.info(`ambient: ${candidate.kind} — "${candidate.title}"`);
      }
      // Only fire one suggestion per tick so we don't spam.
      return;
    } catch (err) {
      logger.warn('ambient trigger crashed', err);
    }
  }
}

export function start(): void {
  stop();
  const s = settingsStore.load();
  if (!s.ambient.enabled) return;
  const interval = Math.max(2, s.ambient.pollSeconds) * 1000;
  generation++;
  const gen = generation;
  timer = setInterval(() => { void runTick(gen); }, interval);
  // Fire once immediately so the first sample lands quickly.
  void runTick(gen);
  logger.info(`ambient: started (every ${s.ambient.pollSeconds}s)`);
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function restart(): void {
  stop();
  start();
}

export function listRecent(): AmbientSuggestion[] {
  return [...recent];
}

export function resolveSuggestion(id: string, resolution: 'accepted' | 'dismissed'): void {
  const s = recent.find((x) => x.id === id);
  if (!s) return;
  s.resolvedAt = Date.now();
  s.resolution = resolution;
  send('paia:ambient-resolved', s);
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:ambient-list', () => listRecent());
ipcMain.handle('paia:ambient-resolve', (_e, p: { id: string; resolution: 'accepted' | 'dismissed' }) => {
  resolveSuggestion(p.id, p.resolution);
});
ipcMain.handle('paia:ambient-restart', () => { restart(); });

void app;
