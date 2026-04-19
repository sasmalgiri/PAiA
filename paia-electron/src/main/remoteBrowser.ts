// Remote browser agent (Chrome DevTools Protocol).
//
// Gives the Agent a browser running on a different machine — a VM, a
// Docker container, a kiosk box, a remote workstation — without PAiA
// ever running Chromium itself as the target. The user launches a
// vanilla Chrome / Chromium with:
//
//     chromium --remote-debugging-port=9222 --remote-allow-origins=*
//
// then points PAiA at http://host:9222. PAiA discovers the open page
// target via the JSON endpoint, opens a WebSocket to its
// `webSocketDebuggerUrl`, and speaks CDP (JSON-RPC over WS).
//
// Why this is useful:
//   - The remote browser is fully sandboxed on its own host; a misbehaving
//     site can't touch the PAiA machine at all.
//   - Perfect for automation inside a throwaway VM (Docker Chrome, kasm,
//     etc.) or for driving a browser on a VPS with a residential IP.
//   - Zero native deps here — we only use the `WebSocket` global shipped
//     with Electron's Node 22 runtime.
//
// Tool parity: the same set of tools as browserAgent.ts is exposed here
// (plus a `remote.connect` utility to re-establish the session). The
// Agent's tool registry picks `browser.*` for the local one and
// `remote.*` for this one, so the LLM can choose per-step.

import { app, ipcMain } from 'electron';
import type { RemoteBrowserConfig, RemoteBrowserState, ToolDefinition } from '../shared/types';
import type { ToolHandler } from './tools';
import * as classroom from './classroom';
import { logger } from './logger';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

// ─── persisted config ─────────────────────────────────────────────

function configPath(): string {
  return path.join(app.getPath('userData'), 'remote-browser.json');
}

const DEFAULTS: RemoteBrowserConfig = {
  enabled: false,
  endpoint: 'http://127.0.0.1:9222',
};

export function loadConfig(): RemoteBrowserConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RemoteBrowserConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(next: RemoteBrowserConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
}

// ─── CDP client ───────────────────────────────────────────────────

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

let socket: WebSocket | null = null;
let pending = new Map<number, { resolve: (v: unknown) => void; reject: (err: Error) => void }>();
let nextId = 1;
let attachedTarget: CdpTarget | null = null;
let lastError: string | undefined;

async function discoverTarget(cfg: RemoteBrowserConfig): Promise<CdpTarget> {
  const base = cfg.endpoint.replace(/\/$/, '');
  // Loopback is fine over plain HTTP; any other host should be HTTPS
  // because the CDP WebSocket carries page DOM + the token in the query
  // string. We warn instead of blocking — legitimate dev / LAN setups
  // exist where HTTP is the user's explicit choice.
  const isLoopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\b/i.test(base);
  if (base.startsWith('http://') && !isLoopback) {
    logger.warn(`remote browser: HTTP endpoint ${base} is vulnerable to network eavesdropping — use HTTPS.`);
  }
  const q = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : '';
  const res = await fetch(`${base}/json${q}`);
  if (!res.ok) throw new Error(`CDP discover failed: HTTP ${res.status}`);
  const targets = (await res.json()) as CdpTarget[];
  const page = targets.find((t) => t.type === 'page' && !!t.webSocketDebuggerUrl);
  if (!page) throw new Error('No debuggable page target found. Open about:blank in the remote Chromium first.');
  return page;
}

function connectSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = new (globalThis as any).WebSocket(url) as WebSocket;
    const openHandler = (): void => {
      ws.removeEventListener('open', openHandler);
      ws.removeEventListener('error', errorHandler);
      resolve(ws);
    };
    const errorHandler = (e: Event): void => {
      ws.removeEventListener('open', openHandler);
      ws.removeEventListener('error', errorHandler);
      reject(new Error(`WebSocket open failed: ${String(e)}`));
    };
    ws.addEventListener('open', openHandler);
    ws.addEventListener('error', errorHandler);
  });
}

async function ensureConnected(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  const cfg = loadConfig();
  if (!cfg.enabled) throw new Error('Remote browser is not enabled. Configure it in Settings → Remote browser.');
  // Reject any promises from a prior socket so they don't hang forever.
  // The new socket starts with id=1, and a caller that was waiting on
  // an old id now gets a clear error instead of silence.
  for (const waiter of pending.values()) {
    try { waiter.reject(new Error('CDP socket reconnected — prior request aborted')); }
    catch { /* ignore */ }
  }
  pending.clear();
  attachedTarget = await discoverTarget(cfg);
  socket = await connectSocket(attachedTarget.webSocketDebuggerUrl);
  pending = new Map();
  nextId = 1;
  socket.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as CdpMessage;
      if (typeof msg.id === 'number') {
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message));
        else waiter.resolve(msg.result);
      }
      // Events (no id) go on the floor — we're command-driven.
    } catch { /* ignore malformed */ }
  });
  socket.addEventListener('close', () => { socket = null; });
  socket.addEventListener('error', (e) => { lastError = String(e); });
  // Enable page + runtime domains so commands work.
  await call('Page.enable');
  await call('Runtime.enable');
  logger.info(`remote browser attached to ${attachedTarget.url}`);
}

function call(method: string, params: unknown = {}): Promise<unknown> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('CDP socket not connected'));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket!.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout on ${method}`));
      }
    }, 30_000);
  });
}

// ─── primitive ops ────────────────────────────────────────────────

async function evalInPage<T>(expression: string): Promise<T> {
  const res = await call('Runtime.evaluate', {
    expression: `(async () => { try { return { ok: true, value: (${expression}) }; } catch (e) { return { ok: false, error: String(e) }; } })()`,
    awaitPromise: true,
    returnByValue: true,
  }) as { result?: { value?: { ok: boolean; value?: T; error?: string } }; exceptionDetails?: { text?: string } };
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text ?? 'JS exception');
  const payload = res.result?.value;
  if (!payload || !payload.ok) throw new Error(payload?.error ?? 'JS failed');
  return payload.value as T;
}

async function navigate(url: string): Promise<void> {
  await call('Page.navigate', { url });
  // Poll document.readyState; we can't rely on Page.loadEventFired without
  // having subscribed before the call.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const state = await evalInPage<string>('document.readyState');
      if (state === 'complete' || state === 'interactive') return;
    } catch { /* still loading */ }
  }
}

async function screenshot(): Promise<string> {
  const r = await call('Page.captureScreenshot', { format: 'png' }) as { data?: string };
  if (!r.data) throw new Error('Screenshot returned no data.');
  return `data:image/png;base64,${r.data}`;
}

async function pressEnter(): Promise<void> {
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r',
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13,
  });
}

interface PageSummary {
  title: string;
  url: string;
  textExcerpt: string;
  links: { text: string; href: string }[];
}

async function summarize(): Promise<PageSummary> {
  const js = `(() => {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (clone) {
      clone.querySelectorAll('script,style,nav,header,footer,aside,svg,noscript').forEach(n => n.remove());
    }
    const text = (clone?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000);
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 80)
      .map(a => ({ text: (a.textContent || '').trim().slice(0, 120), href: a.href }))
      .filter(l => l.text && /^https?:/.test(l.href));
    return { title: document.title, url: location.href, textExcerpt: text, links };
  })()`;
  return evalInPage<PageSummary>(js);
}

async function clickSelector(selector: string): Promise<boolean> {
  const safe = JSON.stringify(selector);
  return evalInPage<boolean>(`(() => {
    const el = document.querySelector(${safe});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);
}

async function clickText(text: string): Promise<boolean> {
  const safe = JSON.stringify(text.toLowerCase());
  return evalInPage<boolean>(`(() => {
    const target = ${safe};
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
    for (const el of candidates) {
      const t = (el.textContent || el.value || '').trim().toLowerCase();
      if (t === target || t.includes(target)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
    }
    return false;
  })()`);
}

async function typeInto(selector: string, text: string): Promise<boolean> {
  const sel = JSON.stringify(selector);
  const val = JSON.stringify(text);
  return evalInPage<boolean>(`(() => {
    const el = document.querySelector(${sel});
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                   Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, ${val}); else el.value = ${val};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function waitFor(selector: string, timeoutMs: number): Promise<boolean> {
  const safe = JSON.stringify(selector);
  return evalInPage<boolean>(`new Promise((res) => {
    const start = Date.now();
    const tick = () => {
      if (document.querySelector(${safe})) res(true);
      else if (Date.now() - start > ${timeoutMs}) res(false);
      else setTimeout(tick, 120);
    };
    tick();
  })`);
}

// ─── tool handlers ────────────────────────────────────────────────

function checkAllowed(): void {
  const policy = classroom.currentPolicy();
  if (policy && !policy.allowWebTools) throw new Error('Browser tools are disabled by your classroom policy.');
}

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing string argument "${name}"`);
  return v;
}

function def(name: string, description: string, risk: ToolDefinition['risk'], schema: unknown): ToolDefinition {
  return { name, description, category: 'web', risk, inputSchema: schema };
}

export const remoteBrowserTools: ToolHandler[] = [
  {
    definition: def('remote.connect', 'Connect (or reconnect) to the remote Chrome DevTools endpoint configured in Settings.', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      await ensureConnected();
      return JSON.stringify({ attached: attachedTarget?.url ?? '' });
    },
  },
  {
    definition: def('remote.goto', 'Navigate the remote browser to a URL and return a page summary.', 'low', {
      type: 'object', properties: { url: { type: 'string' } }, required: ['url'],
    }),
    execute: async (args) => {
      checkAllowed();
      await ensureConnected();
      const url = asString(args.url, 'url');
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
      await navigate(url);
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('remote.click', 'Click by CSS selector or visible text in the remote browser.', 'medium', {
      type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } },
    }),
    execute: async (args) => {
      checkAllowed();
      await ensureConnected();
      const selector = typeof args.selector === 'string' ? args.selector : '';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!selector && !text) throw new Error('Pass either selector or text');
      const ok = selector ? await clickSelector(selector) : await clickText(text);
      if (!ok) throw new Error('No matching element found');
      await new Promise((r) => setTimeout(r, 600));
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('remote.type', 'Type text into an element in the remote browser.', 'medium', {
      type: 'object', properties: {
        selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' },
      }, required: ['selector', 'text'],
    }),
    execute: async (args) => {
      checkAllowed();
      await ensureConnected();
      const selector = asString(args.selector, 'selector');
      const text = asString(args.text, 'text');
      const ok = await typeInto(selector, text);
      if (!ok) throw new Error(`Could not find element for selector "${selector}"`);
      if (args.submit) { await pressEnter(); await new Promise((r) => setTimeout(r, 800)); }
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('remote.scroll', 'Scroll the remote page by N pixels.', 'safe', {
      type: 'object', properties: { dy: { type: 'number' } }, required: ['dy'],
    }),
    execute: async (args) => {
      checkAllowed();
      await ensureConnected();
      const dy = Math.max(-10_000, Math.min(10_000, Math.trunc(typeof args.dy === 'number' ? args.dy : 600)));
      await evalInPage<void>(`window.scrollBy({ top: ${dy}, behavior: 'smooth' })`);
      await new Promise((r) => setTimeout(r, 400));
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('remote.waitFor', 'Wait for a CSS selector in the remote page.', 'safe', {
      type: 'object', properties: { selector: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['selector'],
    }),
    execute: async (args) => {
      checkAllowed();
      await ensureConnected();
      const selector = asString(args.selector, 'selector');
      const timeoutMs = typeof args.timeoutMs === 'number' ? Math.min(args.timeoutMs, 30_000) : 8_000;
      const ok = await waitFor(selector, timeoutMs);
      if (!ok) throw new Error(`Timeout waiting for "${selector}"`);
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('remote.screenshot', 'Capture the remote viewport as a base64 PNG data URL.', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      await ensureConnected();
      return await screenshot();
    },
  },
  {
    definition: def('remote.state', 'Return a page summary without navigating.', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      await ensureConnected();
      return JSON.stringify(await summarize(), null, 2);
    },
  },
];

// ─── local Chromium orchestration ─────────────────────────────────
//
// User just clicks "Start local Chromium" and we:
//   1. Probe the usual install paths for Chrome / Chromium / Edge.
//   2. Pick a free port.
//   3. Spawn it with --remote-debugging-port + a disposable --user-data-dir.
//   4. Auto-populate the remote-browser config to point at it.
//   5. Track the child so we can shut it down on request.
//
// This turns "BYO remote browser" into a one-click feature while keeping
// the manual endpoint-URL path for users with a fancier setup.

let localChromium: ChildProcess | null = null;
let localChromiumTempDir: string | null = null;

function chromiumCandidates(): string[] {
  const pf = process.platform;
  if (pf === 'win32') {
    const pfDir = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(pfDir, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfDir, 'Chromium', 'Application', 'chrome.exe'),
      path.join(pfDir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
  }
  if (pf === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  // Linux: rely on PATH lookups via `which` style + usual spots.
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

function resolveChromiumBinary(): string | null {
  for (const p of chromiumCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr !== 'object') {
        srv.close();
        reject(new Error('no address'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startLocalChromium(): Promise<{ pid: number; port: number; binary: string }> {
  if (localChromium && !localChromium.killed) {
    const port = loadConfig().endpoint.match(/:(\d+)/)?.[1];
    return { pid: localChromium.pid ?? 0, port: Number(port ?? 0), binary: '' };
  }
  const binary = resolveChromiumBinary();
  if (!binary) {
    throw new Error('No Chrome / Chromium / Edge found in the usual install paths. Install one, or set the remote endpoint manually.');
  }
  const port = await pickFreePort();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paia-remote-chromium-'));
  localChromiumTempDir = tmpRoot;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpRoot}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--remote-allow-origins=*',
    'about:blank',
  ];
  const child = spawn(binary, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('exit', () => {
    localChromium = null;
    if (localChromiumTempDir) {
      try { fs.rmSync(localChromiumTempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      localChromiumTempDir = null;
    }
  });
  localChromium = child;

  // Auto-update the config so the existing connect path just works.
  const cfg = loadConfig();
  saveConfig({ ...cfg, enabled: true, endpoint: `http://127.0.0.1:${port}` });

  // Wait up to 10 seconds for the JSON endpoint to answer.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch { /* still booting */ }
  }

  logger.info(`local Chromium spawned: pid=${child.pid} port=${port} binary=${binary}`);
  return { pid: child.pid ?? 0, port, binary };
}

export function stopLocalChromium(): boolean {
  if (!localChromium) return false;
  try { localChromium.kill(); } catch { /* ignore */ }
  localChromium = null;
  // Clean up the temp profile dir on next tick (the exit handler may
  // have already fired; this is belt-and-braces).
  if (localChromiumTempDir) {
    const dir = localChromiumTempDir;
    localChromiumTempDir = null;
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }, 1000);
  }
  return true;
}

// Clean up when PAiA itself quits so we don't leave orphan Chrome processes.
app.on('will-quit', () => {
  stopLocalChromium();
});

// ─── state / IPC ──────────────────────────────────────────────────

export function state(): RemoteBrowserState {
  const cfg = loadConfig();
  return {
    connected: !!socket && socket.readyState === WebSocket.OPEN,
    endpoint: cfg.endpoint,
    currentUrl: attachedTarget?.url,
    error: lastError,
  };
}

ipcMain.handle('paia:remote-browser-config', () => loadConfig());
ipcMain.handle('paia:remote-browser-save-config', (_e, next: RemoteBrowserConfig) => {
  saveConfig(next);
  return loadConfig();
});
ipcMain.handle('paia:remote-browser-state', () => state());
ipcMain.handle('paia:remote-browser-connect', async () => {
  try { await ensureConnected(); return { ok: true, state: state() }; }
  catch (err) { lastError = err instanceof Error ? err.message : String(err); return { ok: false, error: lastError, state: state() }; }
});
ipcMain.handle('paia:remote-browser-disconnect', () => {
  try { socket?.close(); } catch { /* ignore */ }
  socket = null;
  attachedTarget = null;
  return state();
});

ipcMain.handle('paia:remote-browser-start-local', async () => {
  try {
    const info = await startLocalChromium();
    return { ok: true, info, state: state() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), state: state() };
  }
});

ipcMain.handle('paia:remote-browser-stop-local', () => {
  const stopped = stopLocalChromium();
  return { ok: true, stopped, state: state() };
});

ipcMain.handle('paia:remote-browser-has-local-chromium', () => ({
  available: !!resolveChromiumBinary(),
  path: resolveChromiumBinary(),
}));
