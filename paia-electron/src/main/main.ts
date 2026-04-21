// PAiA — Electron main process.
//
// Architecture:
//   - One frameless transparent always-on-top window (the "ball").
//   - Renderer drives view changes (ball/panel/settings/onboarding) via IPC.
//   - Persistent state lives in:
//        userData/settings.json    (preferences)
//        userData/personas.json    (custom personas)
//        userData/paia.sqlite      (threads + messages + attachments)
//        userData/transformers-cache (whisper model)
//        userData/tesseract-cache  (OCR language models)
//        userData/logs/            (electron-log rotating files)

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import * as path from 'path';
import { redact } from '../shared/redaction';
import { OllamaClient } from '../shared/ollama';
import { logger } from './logger';
import * as settingsStore from './settings';
import * as db from './db';
import * as personas from './personas';
import * as screenSvc from './screen';
import { captureRegion } from './region';
import * as updater from './updater';
import * as rag from './rag';
import * as mcp from './mcp';
import * as providers from './providers';
import * as webSearch from './webSearch';
import { getActiveWindow } from './activeWindow';
import { initCrashReporting, captureException } from './crashReporting';
import * as analytics from './analytics';
import * as piper from './piper';
import * as wakeWord from './wakeWord';
import * as agent from './agent';
import * as researchSvc from './research';
import * as memorySvc from './memory';
import * as experience from './experience';
import * as artifactsSvc from './artifacts';
import * as scheduler from './scheduler';
import * as classroom from './classroom';
import * as ambient from './ambient';
import * as team from './team';
import * as pluginsSvc from './plugins';
import * as enforcement from './enforcement';
import * as sync from './sync';
// Importing for the side-effect of registering its IPC handlers.
import './license';
import './connectors';
import './browserAgent';
import './remoteBrowser';
import './media';
import './companion';
import './apiServer';
import './autopilot';
import './metering';
import * as beta from './beta';
import { transcribe as whisperTranscribe, setActiveWindow as setWhisperWindow } from './whisper';
import { registerHotkeys, unregisterHotkeys, DEFAULT_HOTKEYS } from './hotkeys';
import { buildMenu } from './menu';
import type {
  ChatMessage,
  DbAttachment,
  HotkeyMap,
  Persona,
  RagIngestProgress,
  Settings,
} from '../shared/types';

const ollama = new OllamaClient();

// Window sizes
const BALL_SIZE = 96;
const PANEL_W = 480;
const PANEL_H = 620;
const SETTINGS_W = 520;
const SETTINGS_H = 620;
const ONBOARDING_W = 560;
const ONBOARDING_H = 620;
const QUICK_W = 460;
const QUICK_H = 360;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ─── detached chat windows ─────────────────────────────────────────
//
// Each entry is a standalone resizable window loaded from detached.html
// that shows exactly one thread. The main process is the same for all
// of them, so threads stay coherent across windows automatically.
const detachedWindows = new Map<string, BrowserWindow>();

function createDetachedChatWindow(threadId: string): BrowserWindow {
  const existing = detachedWindows.get(threadId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 360,
    minHeight: 480,
    title: 'PAiA — chat',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Same navigation hardening as the main window.
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'detached.html'), {
    search: `thread=${encodeURIComponent(threadId)}`,
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { detachedWindows.delete(threadId); });
  detachedWindows.set(threadId, win);
  return win;
}

// ─── single-instance lock ──────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function showWindow(): void {
  if (!mainWindow) createMainWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function toggleWindow(): void {
  if (mainWindow?.isVisible()) mainWindow.hide();
  else showWindow();
}

// ─── window factory ────────────────────────────────────────────────

function createMainWindow(): void {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const settings = settingsStore.load();

  const defaultX = workArea.x + workArea.width - BALL_SIZE - 24;
  const defaultY = workArea.y + workArea.height - BALL_SIZE - 24;

  // Onboarding view is wider than the ball; if the user hasn't onboarded
  // yet we open straight into the panel-sized window.
  const initialW = settings.onboarded ? BALL_SIZE : ONBOARDING_W;
  const initialH = settings.onboarded ? BALL_SIZE : ONBOARDING_H;

  mainWindow = new BrowserWindow({
    width: initialW,
    height: initialH,
    x: settings.onboarded ? (settings.ballX ?? defaultX) : undefined,
    y: settings.onboarded ? (settings.ballY ?? defaultY) : undefined,
    center: !settings.onboarded,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // disabled so getUserMedia + WebAudio work in the renderer
    },
  });

  applyAlwaysOnTop(settings.alwaysOnTop);

  // Harden the window: the renderer loads index.html from disk and
  // should NEVER navigate anywhere else. Block both in-window
  // navigation and target="_blank" / window.open, routing the latter
  // through our protocol-whitelisted openExternal handler.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    logger.warn('blocked will-navigate on mainWindow to', url);
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    settingsStore.save({ ballX: x, ballY: y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  updater.attachUpdater(mainWindow);
  mcp.setActiveWindow(mainWindow);
  agent.setActiveWindow(mainWindow);
  researchSvc.setActiveWindow(mainWindow);
  classroom.setActiveWindow(mainWindow);
  ambient.setActiveWindow(mainWindow);
  team.setActiveWindow(mainWindow);
  sync.setActiveWindow(mainWindow);
  setWhisperWindow(mainWindow);

  // Auto-check for updates 30 seconds after launch (production builds only).
  if (app.isPackaged && settings.autoUpdate) {
    setTimeout(() => {
      void updater.checkForUpdates();
    }, 30_000);
  }
}

function applyAlwaysOnTop(enabled: boolean): void {
  if (!mainWindow) return;
  if (enabled) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
  }
}

// ─── tray ──────────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('PAiA');
  const menu = Menu.buildFromTemplate([
    { label: 'Show PAiA', click: showWindow },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Capture screen', click: () => triggerCapture() },
    { type: 'separator' },
    { label: 'Check for updates', click: () => void updater.checkForUpdates() },
    { type: 'separator' },
    {
      label: 'Quit PAiA',
      click: () => {
        (app as unknown as { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleWindow);
}

function triggerCapture(): void {
  showWindow();
  mainWindow?.webContents.send('paia:trigger-capture');
}

function triggerPushToTalk(): void {
  showWindow();
  mainWindow?.webContents.send('paia:trigger-ptt');
}

function triggerQuickActions(): void {
  // Read whatever is on the clipboard right now. The user is expected to
  // have copied their text first (Ctrl+C → Ctrl+Alt+Q).
  const text = clipboard.readText().trim();
  showWindow();
  mainWindow?.webContents.send('paia:trigger-quick-actions', { text });
}

// ─── view resize ───────────────────────────────────────────────────

type ViewName = 'ball' | 'panel' | 'settings' | 'onboarding' | 'quick';

ipcMain.handle('paia:set-view', (_e, view: ViewName) => {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: curX, y: curY });
  const wa = display.workArea;

  let w = BALL_SIZE;
  let h = BALL_SIZE;
  if (view === 'panel')      { w = PANEL_W;      h = PANEL_H; }
  else if (view === 'settings')   { w = SETTINGS_W;   h = SETTINGS_H; }
  else if (view === 'onboarding') { w = ONBOARDING_W; h = ONBOARDING_H; }
  else if (view === 'quick')      { w = QUICK_W;      h = QUICK_H; }

  let x = curX;
  let y = curY;
  if (x + w > wa.x + wa.width)  x = wa.x + wa.width - w;
  if (y + h > wa.y + wa.height) y = wa.y + wa.height - h;
  if (x < wa.x) x = wa.x;
  if (y < wa.y) y = wa.y;

  mainWindow.setBounds({ x, y, width: w, height: h }, false);
});

// ─── settings IPC ──────────────────────────────────────────────────

ipcMain.handle('paia:get-settings', () => settingsStore.load());

ipcMain.handle('paia:save-settings', (_e, patch: Partial<Settings>) => {
  const next = settingsStore.save(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'alwaysOnTop')) {
    applyAlwaysOnTop(next.alwaysOnTop);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'startAtLogin')) {
    app.setLoginItemSettings({ openAtLogin: next.startAtLogin });
  }
  if (patch.hotkeys) {
    setupHotkeys(next.hotkeys);
  }
  // Restart the wake-word listener if any of its inputs changed.
  if (
    patch.wakeWordEnabled !== undefined ||
    patch.wakeWordAccessKey !== undefined ||
    patch.wakeWordKeyword !== undefined
  ) {
    void wakeWord.restart(() => triggerPushToTalk());
  }
  // Ambient watcher follows settings.ambient.*; restart so changes land.
  if (patch.ambient !== undefined) {
    ambient.restart();
  }
  if (patch.pluginsEnabled !== undefined) {
    if (next.pluginsEnabled) pluginsSvc.loadAllEnabled();
    else pluginsSvc.scan();
  }
  return next;
});

// ─── personas IPC ──────────────────────────────────────────────────

ipcMain.handle('paia:list-personas', () => personas.listPersonas());
ipcMain.handle('paia:create-persona', (_e, p: { name: string; emoji: string; systemPrompt: string }) =>
  personas.createPersona(p.name, p.emoji, p.systemPrompt),
);
ipcMain.handle('paia:update-persona', (_e, p: { id: string; patch: Partial<Persona> }) =>
  personas.updatePersona(p.id, p.patch),
);
ipcMain.handle('paia:delete-persona', (_e, id: string) => personas.deletePersona(id));

// ─── threads / messages IPC ────────────────────────────────────────

ipcMain.handle('paia:list-threads', () => db.listThreads());

ipcMain.handle('paia:get-thread', (_e, id: string) => db.getThread(id));

ipcMain.handle(
  'paia:create-thread',
  (_e, p: { title: string; personaId: string | null; model: string | null }) =>
    db.createThread(p.title, p.personaId, p.model),
);

ipcMain.handle('paia:update-thread', (_e, p: { id: string; patch: Partial<{ title: string; personaId: string | null; model: string | null; pinned: boolean }> }) =>
  db.updateThread(p.id, p.patch),
);

ipcMain.handle('paia:delete-thread', (_e, id: string) => db.deleteThread(id));
ipcMain.handle('paia:restore-thread', (_e, id: string) => db.restoreThread(id));

ipcMain.handle('paia:list-messages', (_e, threadId: string) => db.listMessages(threadId));

ipcMain.handle('paia:search-messages', (_e, p: { query: string; limit?: number }) =>
  db.searchMessages(p.query, p.limit),
);

// ─── chat / ollama / redact ───────────────────────────────────────

ipcMain.handle('paia:redact', (_e, text: string) => redact(text));

ipcMain.handle('paia:ollama-status', () => ollama.status());

ipcMain.handle('paia:ollama-delete-model', (_e, name: string) => ollama.deleteModel(name));

// Active pull AbortControllers keyed by model name so the renderer can
// cancel an in-flight pull. Only one pull per model at a time.
const activePulls = new Map<string, AbortController>();

ipcMain.handle(
  'paia:ollama-pull-model',
  async (event: IpcMainInvokeEvent, name: string) => {
    // If a pull for this model is already running, let the caller know.
    if (activePulls.has(name)) return false;
    const controller = new AbortController();
    activePulls.set(name, controller);
    try {
      const ok = await ollama.pullModel(
        name,
        (p) => {
          event.sender.send('paia:ollama-pull-progress', { name, ...p });
        },
        controller.signal,
      );
      return ok;
    } catch (err) {
      // Surface abort as a clean `false` return (not an exception) so the
      // renderer can distinguish cancelled vs. crashed. Other errors
      // bubble up.
      const msg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted || /abort/i.test(msg)) {
        event.sender.send('paia:ollama-pull-progress', {
          name,
          status: 'cancelled',
        });
        return false;
      }
      throw err;
    } finally {
      activePulls.delete(name);
    }
  },
);

ipcMain.handle('paia:ollama-cancel-pull', (_e, name: string) => {
  const ctrl = activePulls.get(name);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
});

interface ChatPayload {
  threadId: string;
  model: string;
  systemPrompt: string;
  userText: string;
  attachments: Omit<DbAttachment, 'id' | 'messageId'>[];
}

ipcMain.handle('paia:chat-send', async (event, payload: ChatPayload) => {
  const { threadId, model, systemPrompt, userText, attachments } = payload;

  // 1. Redact PII before persisting or sending.
  const redacted = redact(userText);

  // 2. Persist the user message.
  db.addMessage(threadId, 'user', redacted.redacted, redacted.matchCount, attachments);

  // 3. Optionally include the active window's title/app as context.
  let augmentedSystem = systemPrompt;
  if (settingsStore.load().includeActiveWindow) {
    try {
      const aw = await getActiveWindow();
      if (aw && (aw.title || aw.appName)) {
        augmentedSystem += `\n\n[Context] The user's foreground window when they sent this message was: "${aw.title}" in ${aw.appName || 'unknown app'}.`;
      }
    } catch {
      /* non-fatal */
    }
  }
  try {
    const memCtx = await memorySvc.buildContextBlock(redacted.redacted);
    if (memCtx) {
      augmentedSystem = `${augmentedSystem}\n\n${memCtx}`;
    }
  } catch (err) {
    logger.warn('memory context build failed (continuing)', err);
  }

  try {
    const collectionIds = db.listThreadCollections(threadId);
    if (collectionIds.length > 0) {
      const chunks = await rag.retrieve(collectionIds, redacted.redacted, 5);
      if (chunks.length > 0) {
        const ctx = rag.formatContext(chunks);
        // Append to augmentedSystem (which may already include the active
        // window context from step 3) rather than overwriting it.
        augmentedSystem = `${augmentedSystem}\n\n${ctx}`;
        event.sender.send('paia:rag-cited', {
          threadId,
          sources: chunks.map((c, i) => ({
            n: i + 1,
            filename: c.filename,
            ordinal: c.ordinal,
            score: c.score,
          })),
        });
      }
    }
  } catch (err) {
    logger.warn('RAG retrieval failed (continuing without context):', err);
  }

  // 4. Build the chat history (augmented system prompt + persisted thread messages).
  const history = db.listMessages(threadId);
  const messages: ChatMessage[] = [
    { role: 'system', content: augmentedSystem },
    ...history.map((m) => {
      const msg: ChatMessage = { role: m.role, content: m.content };
      const imgs = m.attachments
        .filter((a) => a.kind === 'image')
        .map((a) => a.content.replace(/^data:[^;]+;base64,/, ''));
      if (imgs.length > 0) msg.images = imgs;
      return msg;
    }),
  ];

  // 5. Stream the response back to the renderer + assemble the full text.
  //    Routed through the provider dispatcher so cloud providers (OpenAI,
  //    Anthropic, openai-compatible) work transparently when enabled.
  //
  //    Wrap the call in an inactivity watchdog: if no token arrives for
  //    90 seconds (model is stuck / daemon deadlocked / network hung), we
  //    reject so the user gets an actionable error instead of an
  //    indefinite spinner. The watchdog is reset on each received token,
  //    so a legitimately-slow long response won't trip it.
  let assembled = '';
  const INACTIVITY_MS = 90_000;
  try {
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let rejectWatchdog: ((err: Error) => void) | null = null;
    const armWatchdog = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        rejectWatchdog?.(
          new Error(
            `No response from the model for ${INACTIVITY_MS / 1000}s. The daemon may be stuck — try sending again, or check that Ollama is running.`,
          ),
        );
      }, INACTIVITY_MS);
    };
    const watchdogPromise = new Promise<never>((_res, rej) => {
      rejectWatchdog = rej;
    });
    armWatchdog();
    const chatPromise = providers.chat(model, messages, (token) => {
      assembled += token;
      armWatchdog();
      event.sender.send('paia:chat-token', { threadId, token });
    });
    const finalText = await Promise.race([chatPromise, watchdogPromise]);
    if (watchdog) clearTimeout(watchdog);
    const text = finalText || assembled;

    // 6. Persist the assistant reply.
    db.addMessage(threadId, 'assistant', text, 0);
    event.sender.send('paia:chat-done', { threadId, text });

    // 7. Schedule a post-turn reflection — PAiA reviews the exchange
    //    after a 20 s idle window and extracts durable lessons into
    //    memory. Non-blocking; pure local-model call; skipped entirely
    //    if memory is disabled or no local model is configured.
    try { experience.scheduleReflection(threadId); } catch (err) { logger.warn('scheduleReflection failed', err); }

    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    event.sender.send('paia:chat-error', { threadId, error: message });
    return { ok: false, error: message };
  }
});

// ─── RAG / knowledge IPC ──────────────────────────────────────────

ipcMain.handle('paia:list-collections', () => db.listCollections());

ipcMain.handle(
  'paia:create-collection',
  (_e, p: { name: string; description: string; embeddingModel: string }) =>
    db.createCollection(p.name, p.description, p.embeddingModel),
);

ipcMain.handle('paia:delete-collection', (_e, id: string) => db.deleteCollection(id));

ipcMain.handle('paia:list-documents', (_e, collectionId: string) =>
  db.listDocuments(collectionId),
);

ipcMain.handle('paia:delete-document', (_e, id: string) => db.deleteDocument(id));

interface IngestPayload {
  collectionId: string;
  filename: string;
  mimeType: string;
  // Either path on disk OR base64-encoded bytes (for paste/drop in renderer).
  filePath?: string;
  bytesBase64?: string;
  embeddingModel?: string;
}

ipcMain.handle('paia:ingest-document', async (event, payload: IngestPayload) => {
  let filePath = payload.filePath;
  let cleanup: string | null = null;
  try {
    if (!filePath && payload.bytesBase64) {
      // Stash the bytes in a temp file so the extractor can read them.
      // Strip any directory components from the user-supplied filename so a
      // crafted value like "../../etc/passwd" can't escape the temp dir.
      const safeName = path.basename(payload.filename).replace(/[\\/:]/g, '_') || 'upload';
      const tmp = path.join(app.getPath('temp'), `paia-${Date.now()}-${safeName}`);
      const fs = await import('fs');
      fs.writeFileSync(tmp, Buffer.from(payload.bytesBase64, 'base64'));
      filePath = tmp;
      cleanup = tmp;
    }
    if (!filePath) throw new Error('No file source provided');

    const doc = await rag.ingestFile({
      collectionId: payload.collectionId,
      filePath,
      filename: payload.filename,
      mimeType: payload.mimeType,
      embeddingModel: payload.embeddingModel,
      onProgress: (p: RagIngestProgress) => {
        event.sender.send('paia:ingest-progress', { collectionId: payload.collectionId, ...p });
      },
    });
    return { ok: true, document: doc };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    event.sender.send('paia:ingest-progress', {
      collectionId: payload.collectionId,
      stage: 'error',
      current: 0,
      total: 0,
      message,
    });
    return { ok: false, error: message };
  } finally {
    if (cleanup) {
      try {
        const fs = await import('fs');
        fs.unlinkSync(cleanup);
      } catch { /* ignore */ }
    }
  }
});

ipcMain.handle('paia:list-thread-collections', (_e, threadId: string) =>
  db.listThreadCollections(threadId),
);

// ─── web search IPC ───────────────────────────────────────────────

ipcMain.handle('paia:web-search', (_e, p: { query: string; limit?: number }) =>
  webSearch.search(p.query, p.limit),
);

// ─── active window IPC ──────────────────────────────────────────

ipcMain.handle('paia:active-window', () => getActiveWindow());

// ─── piper TTS IPC ───────────────────────────────────────────────

ipcMain.handle('paia:piper-status', () => piper.status());
ipcMain.handle('paia:piper-voices', () => piper.PIPER_VOICES);
ipcMain.handle('paia:piper-delete-voice', (_e, voiceId: string) => piper.deleteVoice(voiceId));

ipcMain.handle('paia:piper-synthesize', async (event, p: { voiceId: string; text: string }) => {
  try {
    const wav = await piper.synthesize({
      voiceId: p.voiceId,
      text: p.text,
      onProgress: (progress) => event.sender.send('paia:piper-progress', progress),
    });
    return { ok: true, wav };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    captureException(err, { stage: 'piper.synthesize' });
    return { ok: false, error: message };
  }
});

// ─── wake word IPC ───────────────────────────────────────────────

ipcMain.handle('paia:wake-word-status', () => wakeWord.status());
ipcMain.handle('paia:wake-word-keywords', () => wakeWord.BUILTIN_KEYWORDS);

// ─── analytics IPC ──────────────────────────────────────────────

ipcMain.handle('paia:analytics-event', (_e, p: { name: string; props?: Record<string, unknown> }) =>
  analytics.event(p.name, p.props),
);

ipcMain.handle('paia:analytics-reset-id', () => {
  analytics.resetAnonymousId();
});

ipcMain.handle('paia:analytics-current-id', () => analytics.getCurrentAnonymousId());

// ─── clipboard IPC ───────────────────────────────────────────────
//
// Reading clipboard images from the renderer is unreliable across OSes
// (DataTransfer items only work for paste events). Electron's clipboard
// module reads images directly from the OS clipboard, which is what we
// want for the /image slash command.

ipcMain.handle('paia:read-clipboard-image', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toDataURL();
});

ipcMain.handle('paia:read-clipboard-text', () => clipboard.readText());

// ─── provider IPC ─────────────────────────────────────────────────

ipcMain.handle('paia:list-provider-states', () => providers.listAllStates());
ipcMain.handle('paia:get-provider-configs', () => providers.loadConfigs());
ipcMain.handle('paia:save-provider-configs', (_e, list) => {
  providers.saveConfigs(list);
  return providers.loadConfigs();
});

ipcMain.handle('paia:attach-collection', (_e, p: { threadId: string; collectionId: string }) =>
  db.attachCollectionToThread(p.threadId, p.collectionId),
);

ipcMain.handle('paia:detach-collection', (_e, p: { threadId: string; collectionId: string }) =>
  db.detachCollectionFromThread(p.threadId, p.collectionId),
);

// ─── screen capture / OCR IPC ─────────────────────────────────────

ipcMain.handle('paia:capture-list-sources', () => screenSvc.listSources());

ipcMain.handle('paia:capture-source', (_e, sourceId: string) => screenSvc.captureSource(sourceId));

ipcMain.handle('paia:capture-primary', () => screenSvc.capturePrimary());

ipcMain.handle('paia:capture-region', async () => {
  // Hide the main window so it isn't part of the captured screen.
  const wasVisible = mainWindow?.isVisible() ?? false;
  if (wasVisible) mainWindow?.hide();
  // Brief delay to let the compositor finish the hide animation.
  await new Promise((r) => setTimeout(r, 120));
  try {
    const dataUrl = await captureRegion();
    return dataUrl;
  } finally {
    if (wasVisible) {
      mainWindow?.show();
      mainWindow?.focus();
    }
  }
});

ipcMain.handle('paia:ocr', (_e, p: { dataUrl: string; lang?: string }) =>
  screenSvc.ocrImage(p.dataUrl, p.lang),
);

// ─── voice / whisper IPC ──────────────────────────────────────────

ipcMain.handle('paia:transcribe', async (_e, payload: { pcm: Float32Array; lang?: string }) => {
  try {
    const text = await whisperTranscribe(payload.pcm, { language: payload.lang });
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('whisper failed', message);
    return { ok: false, error: message };
  }
});

// ─── updater IPC ──────────────────────────────────────────────────

ipcMain.handle('paia:check-for-updates', () => updater.checkForUpdates());
ipcMain.handle('paia:download-update', () => updater.downloadUpdate());
ipcMain.handle('paia:quit-and-install', () => updater.quitAndInstall());

// ─── misc IPC ─────────────────────────────────────────────────────

ipcMain.handle('paia:open-external', (_e, url: string) => {
  // Protocol whitelist — the renderer calls this with arbitrary URLs
  // derived from web search / research sources / plugin manifests.
  // Allowing `file://` or `javascript:` here would let renderer XSS
  // exfiltrate files or run attacker code in the user's default browser.
  // Only http(s) and mailto: are permitted.
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      logger.warn('blocked openExternal with disallowed protocol:', parsed.protocol);
      throw new Error(`Protocol not allowed: ${parsed.protocol}`);
    }
  } catch (err) {
    logger.warn('blocked openExternal with invalid URL:', url);
    throw err instanceof Error ? err : new Error('Invalid URL');
  }
  return shell.openExternal(url);
});

// Separate IPC for opening local folders in the OS file explorer.
// The renderer doesn't need to know the file:// URL scheme — we just
// take the path and validate it's one of our known userData-relative
// paths before delegating to shell.openPath.
ipcMain.handle('paia:open-user-path', async (_e, subpath: string) => {
  const userData = app.getPath('userData');
  const resolved = path.resolve(userData, subpath);
  // Must stay inside userData.
  const rel = path.relative(userData, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes userData sandbox');
  }
  const err = await shell.openPath(resolved);
  if (err) throw new Error(err);
  return { ok: true };
});

ipcMain.handle('paia:get-app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  userDataPath: app.getPath('userData'),
}));

ipcMain.handle('paia:quit', () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  app.quit();
});

// ─── detached chat IPC ─────────────────────────────────────────────

ipcMain.handle('paia:detach-thread', (_e, threadId: string) => {
  if (!threadId) return { ok: false, error: 'threadId required' };
  createDetachedChatWindow(threadId);
  return { ok: true };
});

// ─── memory IPC ───────────────────────────────────────────────────

ipcMain.handle('paia:memory-list', (_e, scope?: Parameters<typeof memorySvc.listAll>[0]) =>
  memorySvc.listAll(scope),
);

ipcMain.handle(
  'paia:memory-add',
  async (_e, p: { scope: Parameters<typeof memorySvc.remember>[0]; text: string; tags?: string[]; pinned?: boolean }) => {
    try {
      return { ok: true, entry: await memorySvc.remember(p.scope, p.text, p.tags ?? [], p.pinned ?? false) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle(
  'paia:memory-recall',
  async (_e, p: { query: string; topK?: number; scope?: Parameters<typeof memorySvc.listAll>[0] }) => {
    try {
      return { ok: true, entries: await memorySvc.recall(p.query, p.topK ?? 5, p.scope) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle('paia:memory-delete', (_e, id: string) => {
  memorySvc.forget(id);
});

// ─── experience / self-learning IPC ───────────────────────────────

ipcMain.handle(
  'paia:experience-feedback',
  async (_e, p: { messageId: string; kind: 'up' | 'down' | 'clear'; note?: string }) => {
    try {
      const out = await experience.recordFeedback(p.messageId, p.kind, p.note ?? '');
      return { ok: true, ...out };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle('paia:experience-get-feedback', (_e, messageId: string) => experience.getFeedback(messageId));

ipcMain.handle('paia:experience-list-reflections', (_e, p?: { threadId?: string; limit?: number }) =>
  experience.listReflections(p?.threadId, p?.limit ?? 100),
);

// ─── message actions (regenerate + fork) ──────────────────────────

ipcMain.handle('paia:trim-messages-after', (_e, p: { threadId: string; fromMessageId: string }) =>
  db.trimMessagesAfter(p.threadId, p.fromMessageId),
);

ipcMain.handle('paia:fork-thread', (_e, p: { sourceThreadId: string; untilMessageId: string; title: string }) =>
  db.forkThreadAtMessage(p.sourceThreadId, p.untilMessageId, p.title),
);

ipcMain.handle('paia:export-thread-markdown', async (_e, threadId: string) => {
  try {
    const thread = db.getThread(threadId);
    if (!thread) return { ok: false, error: 'Thread not found' };
    const msgs = db.listMessages(threadId);
    const lines: string[] = [];
    lines.push(`# ${thread.title}`);
    lines.push('');
    lines.push(`_Exported ${new Date().toISOString()} from PAiA · persona: ${thread.personaId ?? '—'} · model: ${thread.model ?? '—'}_`);
    lines.push('');
    for (const m of msgs) {
      if (m.role === 'system') continue;
      const header = m.role === 'user' ? '## You' : '## Assistant';
      lines.push(header);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    }
    const safe = thread.title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().slice(0, 80) || 'conversation';
    const defaultPath = `${safe}.md`;
    const { dialog } = await import('electron');
    const res = await dialog.showSaveDialog({
      title: 'Export conversation',
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    const fs = await import('fs');
    fs.writeFileSync(res.filePath, lines.join('\n'), 'utf-8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ─── artifacts IPC ────────────────────────────────────────────────

ipcMain.handle('paia:artifacts-list', (_e, threadId?: string) =>
  artifactsSvc.list(threadId),
);

ipcMain.handle('paia:artifacts-get', (_e, id: string) => artifactsSvc.get(id));

ipcMain.handle(
  'paia:artifacts-create',
  (
    _e,
    p: {
      threadId: string | null;
      title: string;
      kind: Parameters<typeof artifactsSvc.create>[2];
      language: string;
      content: string;
    },
  ) => artifactsSvc.create(p.threadId, p.title, p.kind, p.language, p.content),
);

ipcMain.handle('paia:artifacts-update', (_e, p: { id: string; content: string }) =>
  artifactsSvc.update(p.id, p.content),
);

ipcMain.handle('paia:artifacts-delete', (_e, id: string) => artifactsSvc.remove(id));

// ─── hotkey wiring ────────────────────────────────────────────────

function setupHotkeys(map: HotkeyMap): void {
  registerHotkeys(map, {
    onShowHide: toggleWindow,
    onCapture: triggerCapture,
    onPushToTalk: triggerPushToTalk,
    onQuickActions: triggerQuickActions,
  });
}

// ─── lifecycle ────────────────────────────────────────────────────

// Crash reporting must initialise BEFORE the app does anything heavy so
// it catches errors during database init, window creation, etc. This is
// a no-op when the user hasn't opted in.
initCrashReporting();

app.whenReady().then(async () => {
  logger.info('PAiA starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  });

  try {
    await db.initDatabase();
  } catch (err) {
    captureException(err, { stage: 'db.initDatabase' });
    throw err;
  }

  buildMenu();
  createMainWindow();
  createTray();
  setupHotkeys(settingsStore.load().hotkeys ?? DEFAULT_HOTKEYS);
  void mcp.startAllConfigured();
  void wakeWord.startIfEnabled(() => triggerPushToTalk());
  scheduler.start();

  // Plugins load before ambient so any ambient triggers a plugin contributes
  // are visible when the ambient loop starts.
  if (settingsStore.load().pluginsEnabled) {
    pluginsSvc.loadAllEnabled();
  } else {
    pluginsSvc.scan();
  }
  ambient.start();
  enforcement.selfHealOnStartup();
  void beta.flushQueue();

  // One launch event (only if analytics opted in).
  void analytics.event('app_launched', {
    version: app.getVersion(),
    platform: process.platform,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  unregisterHotkeys();
  void mcp.stopAll();
  void wakeWord.stop();
  scheduler.stop();
  ambient.stop();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});
