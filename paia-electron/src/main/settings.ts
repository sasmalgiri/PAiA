// JSON-file settings store. Lives in app.getPath('userData')/settings.json.
// All renderer-visible preferences live here so the UI has one source of
// truth and migrations are trivial (just merge with DEFAULTS).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_HOTKEYS } from './hotkeys';
import type { Settings } from '../shared/types';

const DEFAULTS: Settings = {
  mode: 'chat',
  model: '',
  personaId: 'default',
  currentThreadId: null,

  sttEngine: 'chromium',
  ttsEngine: 'system',
  piperVoice: 'en_US-amy-medium',
  voiceLang: 'en-US',
  ttsEnabled: true,
  wakeWordEnabled: false,
  wakeWordAccessKey: '',
  wakeWordKeyword: 'computer',

  theme: 'system',
  locale: 'en',
  ballX: null,
  ballY: null,
  ballSize: 96,

  alwaysOnTop: false,
  startAtLogin: false,

  hotkeys: DEFAULT_HOTKEYS,

  allowCloudModels: false,

  includeActiveWindow: false,

  // Telemetry — strictly opt-in, off by default. Privacy-first means
  // we never phone home unless the user explicitly turns it on.
  crashReportsEnabled: false,
  crashReportsDsn: '',
  analyticsEnabled: false,
  analyticsEndpoint: '',

  onboarded: false,

  autoUpdate: true,

  agentAutonomy: 'assisted',
  agentStepBudget: 12,
  agentAllowShell: false,
  agentAllowFs: true,
  agentAllowedRoots: [],

  researchDepth: 2,
  researchMaxSources: 8,

  memoryEnabled: true,

  ambient: {
    enabled: false,
    watchScreen: false,
    watchClipboard: true,
    watchActiveWindow: true,
    pollSeconds: 8,
    cooldownSeconds: 120,
  },

  voiceContinuous: false,

  pluginsEnabled: false,
  osAutomationEnabled: false,

  notificationsEnabled: true,

  trialExpiryAcknowledged: false,
};

let cache: Settings | null = null;

function filePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function load(): Settings {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Deep merge for nested hotkeys.
    cache = {
      ...DEFAULTS,
      ...parsed,
      hotkeys: { ...DEFAULTS.hotkeys, ...(parsed.hotkeys ?? {}) },
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function save(patch: Partial<Settings>): Settings {
  const current = load();
  cache = {
    ...current,
    ...patch,
    hotkeys: { ...current.hotkeys, ...(patch.hotkeys ?? {}) },
  };
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist settings:', err);
  }
  return cache;
}
