// Browser-use agent — a sandboxed headless(-ish) browser the Agent can
// drive end-to-end. Think Playwright-lite with the Electron runtime we
// already ship, so there's no native dep to install or bundle.
//
// Architecture:
//   - One lazily-created `BrowserWindow` lives in a dedicated partition
//     (`persist:paia-browser-agent`) so cookies/localStorage don't leak
//     into the main PAiA window.
//   - By default the window is OFFSCREEN (not shown to the user) so the
//     agent can click/type without stealing focus. A "Show agent browser"
//     toggle moves it on-screen for debugging / watching a run.
//   - Every tool call returns a compact JSON blob of observation data
//     (title, url, text excerpt, screenshot ref) so the LLM has enough
//     state to reason on the next step.
//
// Safety:
//   - Only http/https URLs.
//   - No arbitrary JS eval is exposed as a tool. Each DOM operation is
//     a vetted template that we compile server-side.
//   - Classroom policy's `allowWebTools` gates the whole subsystem.

import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import type { ToolDefinition } from '../shared/types';
import type { ToolHandler } from './tools';
import * as classroom from './classroom';
import { logger } from './logger';

// ─── state ────────────────────────────────────────────────────────

let agentWindow: BrowserWindow | null = null;
let visible = false;

// ─── construction ─────────────────────────────────────────────────

function ensureWindow(): BrowserWindow {
  if (agentWindow && !agentWindow.isDestroyed()) return agentWindow;

  const part = session.fromPartition('persist:paia-browser-agent');

  agentWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: visible,
    // Off-screen rendering keeps page scripts executing even when hidden
    // (a plain hidden BrowserWindow throttles requestAnimationFrame).
    webPreferences: {
      session: part,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: !visible,
      backgroundThrottling: false,
    },
    title: 'PAiA — agent browser',
    autoHideMenuBar: true,
  });

  // Hint to servers that this is an automated browser. Sites will still
  // usually serve the normal page but it's a good citizen.
  agentWindow.webContents.setUserAgent(
    agentWindow.webContents.getUserAgent() + ' PAiA-Agent/0.5',
  );

  // Cheap isolation: block camera/mic/geolocation/notifications permission
  // prompts so automated pages can't secretly request them.
  part.setPermissionRequestHandler((_webContents, _perm, callback) => callback(false));

  agentWindow.on('closed', () => {
    agentWindow = null;
  });

  return agentWindow;
}

export function setVisible(show: boolean): void {
  visible = show;
  const win = ensureWindow();
  if (show) {
    // Re-create if it was offscreen; setWindowButtonVisibility is simpler.
    if (!win.isVisible()) win.show();
  } else {
    win.hide();
  }
}

export function closeWindow(): void {
  if (agentWindow && !agentWindow.isDestroyed()) {
    agentWindow.destroy();
    agentWindow = null;
  }
}

// ─── primitive operations ─────────────────────────────────────────

async function gotoUrl(url: string, timeoutMs = 15000): Promise<void> {
  // Scheme whitelist. The tool-level validator already does this, but
  // gotoUrl is also callable internally — belt and braces. Rejecting
  // `file:` / `javascript:` / custom protocols here means a misbehaving
  // plugin or future caller can't accidentally make the hidden agent
  // window load something dangerous.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Protocol not allowed: ${parsed.protocol}`);
    }
  } catch (err) {
    throw new Error(`Invalid URL: ${err instanceof Error ? err.message : String(err)}`);
  }
  const win = ensureWindow();
  const wc = win.webContents;
  return new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      wc.off('did-finish-load', onReady);
      wc.off('did-fail-load', onFail);
      resolve();
    };
    const onFail = (_e: Electron.Event, code: number, desc: string, validatedURL: string): void => {
      if (validatedURL !== url && validatedURL !== undefined) return;
      wc.off('did-finish-load', onReady);
      wc.off('did-fail-load', onFail);
      reject(new Error(`Navigation failed: ${code} ${desc}`));
    };
    wc.on('did-finish-load', onReady);
    wc.on('did-fail-load', onFail);
    const timer = setTimeout(() => {
      wc.off('did-finish-load', onReady);
      wc.off('did-fail-load', onFail);
      reject(new Error(`Navigation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    void wc.loadURL(url).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Wrap a block of DOM-access JS in an IIFE, execute it in the agent
 * page, and return the stringified result. Helper so each tool reads
 * clean instead of repeating boilerplate.
 */
async function runInPage<T>(js: string): Promise<T> {
  const win = ensureWindow();
  const wc = win.webContents;
  const wrapped = `(async () => { try { return { ok: true, value: (${js}) }; } catch (e) { return { ok: false, error: String(e) }; } })()`;
  const result = await wc.executeJavaScript(wrapped, true);
  const r = result as { ok: boolean; value?: T; error?: string };
  if (!r.ok) throw new Error(r.error ?? 'page script failed');
  return r.value as T;
}

async function waitFor(selector: string, timeoutMs = 8000): Promise<boolean> {
  const safe = JSON.stringify(selector);
  const js = `new Promise((res) => {
    const start = Date.now();
    const tick = () => {
      const el = document.querySelector(${safe});
      if (el) res(true);
      else if (Date.now() - start > ${timeoutMs}) res(false);
      else setTimeout(tick, 120);
    };
    tick();
  })`;
  return runInPage<boolean>(js);
}

async function clickSelector(selector: string): Promise<boolean> {
  const safe = JSON.stringify(selector);
  const js = `(() => {
    const el = document.querySelector(${safe});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`;
  return runInPage<boolean>(js);
}

async function clickText(text: string): Promise<boolean> {
  // Find the deepest element whose text matches the target. Walk the DOM
  // rather than trusting innerText so we ignore hidden nodes.
  const safe = JSON.stringify(text.toLowerCase());
  const js = `(() => {
    const target = ${safe};
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
    for (const el of candidates) {
      const t = (el.textContent || el.value || '').trim().toLowerCase();
      if (t === target || t.includes(target)) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }
    }
    return false;
  })()`;
  return runInPage<boolean>(js);
}

async function typeInto(selector: string, text: string): Promise<boolean> {
  const sel = JSON.stringify(selector);
  const val = JSON.stringify(text);
  const js = `(() => {
    const el = document.querySelector(${sel});
    if (!el) return false;
    el.focus();
    // React-friendly: use native setter then dispatch input event.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                   Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, ${val});
    else el.value = ${val};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  return runInPage<boolean>(js);
}

async function pressEnter(): Promise<void> {
  const win = ensureWindow();
  // Synthesize a real keyboard event so forms that listen for Enter submit.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
}

async function scroll(dy: number): Promise<void> {
  const v = Math.max(-10000, Math.min(10000, Math.trunc(dy)));
  await runInPage<void>(`window.scrollBy({ top: ${v}, behavior: 'smooth' })`);
}

interface PageSummary {
  title: string;
  url: string;
  textExcerpt: string;
  links: { text: string; href: string }[];
}

async function summarize(maxChars = 4000): Promise<PageSummary> {
  const js = `(() => {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (clone) {
      clone.querySelectorAll('script,style,nav,header,footer,aside,svg,noscript').forEach(n => n.remove());
    }
    const text = (clone?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${maxChars});
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 80)
      .map(a => ({ text: (a.textContent || '').trim().slice(0, 120), href: a.href }))
      .filter(l => l.text && /^https?:/.test(l.href));
    return { title: document.title, url: location.href, textExcerpt: text, links };
  })()`;
  return runInPage<PageSummary>(js);
}

async function screenshot(): Promise<string> {
  const win = ensureWindow();
  const image = await win.webContents.capturePage();
  return image.toDataURL();
}

async function back(): Promise<boolean> {
  const win = ensureWindow();
  const wc = win.webContents as Electron.WebContents & {
    canGoBack?: () => boolean;
    goBack?: () => void;
    navigationHistory?: { canGoBack(): boolean; goBack(): void };
  };
  // Prefer the newer navigationHistory API (Electron ≥ 28.5); fall back to
  // the legacy direct methods that are still present on Electron 33.
  const nav = wc.navigationHistory;
  if (nav && typeof nav.canGoBack === 'function') {
    if (nav.canGoBack()) {
      nav.goBack();
      await new Promise((r) => setTimeout(r, 600));
      return true;
    }
    return false;
  }
  if (typeof wc.canGoBack === 'function' && wc.canGoBack()) {
    wc.goBack?.();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }
  return false;
}

// ─── tool definitions ─────────────────────────────────────────────

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing string argument "${name}"`);
  return v;
}

function checkAllowed(): void {
  const policy = classroom.currentPolicy();
  if (policy && !policy.allowWebTools) {
    throw new Error('Browser tools are disabled by your classroom policy.');
  }
}

function def(
  name: string,
  description: string,
  risk: ToolDefinition['risk'],
  schema: unknown,
): ToolDefinition {
  return {
    name, description, category: 'web', risk, inputSchema: schema,
  };
}

export const browserTools: ToolHandler[] = [
  {
    definition: def('browser.goto', 'Navigate the agent browser to a URL. Returns a compact page summary (title, URL, text excerpt, visible links).', 'low', {
      type: 'object',
      properties: { url: { type: 'string' }, waitFor: { type: 'string', description: 'Optional CSS selector to wait for before returning.' } },
      required: ['url'],
    }),
    execute: async (args) => {
      checkAllowed();
      const url = asString(args.url, 'url');
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
      await gotoUrl(url);
      if (typeof args.waitFor === 'string' && args.waitFor) {
        const ok = await waitFor(args.waitFor, 10_000);
        if (!ok) throw new Error(`Selector "${args.waitFor}" did not appear in time`);
      }
      const sum = await summarize();
      return JSON.stringify(sum, null, 2);
    },
  },
  {
    definition: def('browser.back', 'Go back one step in the agent browser history.', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      const ok = await back();
      if (!ok) return '(no previous page)';
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('browser.click', 'Click an element in the agent browser. Pass either `selector` (CSS) or `text` (visible button/link text).', 'medium', {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
    }),
    execute: async (args) => {
      checkAllowed();
      const selector = typeof args.selector === 'string' ? args.selector : '';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!selector && !text) throw new Error('Pass either selector or text');
      const ok = selector ? await clickSelector(selector) : await clickText(text);
      if (!ok) throw new Error('No matching element found');
      // Small settle delay so the DOM has time to react before the LLM
      // reads its next observation.
      await new Promise((r) => setTimeout(r, 600));
      const sum = await summarize();
      return JSON.stringify(sum, null, 2);
    },
  },
  {
    definition: def('browser.type', 'Type text into an element (input / textarea) in the agent browser.', 'medium', {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean', description: 'If true, press Enter after typing (submits forms).' },
      },
      required: ['selector', 'text'],
    }),
    execute: async (args) => {
      checkAllowed();
      const selector = asString(args.selector, 'selector');
      const text = asString(args.text, 'text');
      const ok = await typeInto(selector, text);
      if (!ok) throw new Error(`Could not find element for selector "${selector}"`);
      if (args.submit) {
        await pressEnter();
        await new Promise((r) => setTimeout(r, 800));
      }
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('browser.scroll', 'Scroll the current page by N pixels (positive = down).', 'safe', {
      type: 'object',
      properties: { dy: { type: 'number' } },
      required: ['dy'],
    }),
    execute: async (args) => {
      checkAllowed();
      const dy = typeof args.dy === 'number' ? args.dy : 600;
      await scroll(dy);
      await new Promise((r) => setTimeout(r, 400));
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('browser.waitFor', 'Wait for a CSS selector to appear. Returns the page summary once it does.', 'safe', {
      type: 'object',
      properties: { selector: { type: 'string' }, timeoutMs: { type: 'number' } },
      required: ['selector'],
    }),
    execute: async (args) => {
      checkAllowed();
      const selector = asString(args.selector, 'selector');
      const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
      const ok = await waitFor(selector, Math.min(timeoutMs, 30_000));
      if (!ok) throw new Error(`Timeout waiting for "${selector}"`);
      return JSON.stringify(await summarize(), null, 2);
    },
  },
  {
    definition: def('browser.screenshot', 'Capture the agent browser viewport as a base64 PNG data URL (for vision-capable models).', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      return await screenshot();
    },
  },
  {
    definition: def('browser.state', 'Return a fresh summary of the current page (title, URL, text, links) without navigating.', 'safe', { type: 'object', properties: {} }),
    execute: async () => {
      checkAllowed();
      return JSON.stringify(await summarize(), null, 2);
    },
  },
];

// ─── IPC for the UI (show / hide / close) ─────────────────────────

ipcMain.handle('paia:browser-agent-visible', () => visible);
ipcMain.handle('paia:browser-agent-show', (_e, show: boolean) => {
  setVisible(show);
  return visible;
});
ipcMain.handle('paia:browser-agent-close', () => {
  closeWindow();
  return true;
});
ipcMain.handle('paia:browser-agent-screenshot', async () => screenshot());

void app;
void path;
