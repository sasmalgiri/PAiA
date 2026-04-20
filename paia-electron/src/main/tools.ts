// Built-in tool registry for the Agent orchestrator.
//
// Every tool exposed here lives inside the main process and honours the
// Settings guard rails (fs roots, shell enable/disable). The Agent tool
// loop (`agent.ts`) calls into these via callTool(), which wraps each
// invocation in the approval flow.
//
// Adding a tool: create a Tool object, export via `builtInTools`, and
// document the risk tier in its ToolDefinition. All tools MUST:
//   - validate their own arguments (don't trust the LLM)
//   - clamp/timeout any external I/O
//   - throw on failure so the orchestrator can record it as an error step
//
// MCP tools are registered separately — `listAllTools()` returns the
// union of built-ins + discovered MCP tools.

import { app, clipboard, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type {
  ToolDefinition,
  WebSearchResponse,
} from '../shared/types';
import { extractReadableText as sharedExtract } from '../shared/html';
import * as settingsStore from './settings';
import * as webSearch from './webSearch';
import * as screenSvc from './screen';
import * as ragSvc from './rag';
import * as db from './db';
import * as memorySvc from './memory';
import * as desktop from './desktopControl';
import { getActiveWindow } from './activeWindow';
import { logger } from './logger';

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// ─── helpers ───────────────────────────────────────────────────────

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing required string argument "${field}"`);
  }
  return v;
}

function asOptString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asOptNumber(v: unknown, fallback?: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated, ${text.length - max} more chars]`;
}

function resolveFsPath(userPath: string): string {
  const resolved = path.resolve(userPath);
  const allowed = settingsStore.load().agentAllowedRoots;
  if (allowed.length === 0) {
    // Default sandbox: userData + system temp + current working dir.
    const defaults = [app.getPath('userData'), app.getPath('temp'), process.cwd()];
    if (!defaults.some((r) => isUnder(resolved, r))) {
      throw new Error(
        `Path "${resolved}" is outside the default sandbox. ` +
          `Add it to Settings → Agent → Allowed roots to enable access.`,
      );
    }
    return resolved;
  }
  if (!allowed.some((r) => isUnder(resolved, path.resolve(r)))) {
    throw new Error(`Path "${resolved}" is outside the configured allowed roots.`);
  }
  return resolved;
}

function isUnder(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ─── tool implementations ──────────────────────────────────────────

const webSearchTool: ToolHandler = {
  definition: {
    name: 'web.search',
    description: 'Search the public web via DuckDuckGo. Returns title/URL/snippet for the top results.',
    category: 'web',
    risk: 'safe',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'number', description: 'Max results (default 8, max 20).' },
      },
      required: ['query'],
    },
  },
  async execute(args) {
    const query = asString(args.query, 'query');
    const limit = Math.min(Math.max(asOptNumber(args.limit, 8) ?? 8, 1), 20);
    const res: WebSearchResponse = await webSearch.search(query, limit);
    if (res.error) throw new Error(res.error);
    return JSON.stringify(
      res.results.map((r, i) => ({ n: i + 1, title: r.title, url: r.url, snippet: r.snippet })),
      null,
      2,
    );
  },
};

const webFetchTool: ToolHandler = {
  definition: {
    name: 'web.fetch',
    description: 'Fetch a URL and return its readable text. Strips scripts and navigation.',
    category: 'web',
    risk: 'safe',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL (https:// preferred).' },
        maxChars: { type: 'number', description: 'Cap the extracted text at N chars (default 8000).' },
      },
      required: ['url'],
    },
  },
  async execute(args) {
    const url = asString(args.url, 'url');
    const maxChars = Math.min(asOptNumber(args.maxChars, 8000) ?? 8000, 40000);
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 PAiA/0.3 (agent)',
          Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ctype = res.headers.get('content-type') || '';
      const raw = await res.text();
      if (ctype.includes('application/json')) {
        try {
          return truncate(JSON.stringify(JSON.parse(raw), null, 2), maxChars);
        } catch {
          return truncate(raw, maxChars);
        }
      }
      if (ctype.includes('text/html')) {
        return truncate(extractReadableText(raw), maxChars);
      }
      return truncate(raw, maxChars);
    } finally {
      clearTimeout(timer);
    }
  },
};

export const extractReadableText = sharedExtract;

const fsReadTool: ToolHandler = {
  definition: {
    name: 'fs.read',
    description: 'Read a text file from disk. Path must be inside the configured allowed roots.',
    category: 'fs',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        maxBytes: { type: 'number', description: 'Cap file size (default 200000).' },
      },
      required: ['path'],
    },
  },
  async execute(args) {
    if (!settingsStore.load().agentAllowFs) throw new Error('Filesystem access is disabled in Settings → Agent.');
    const p = resolveFsPath(asString(args.path, 'path'));
    const maxBytes = Math.min(asOptNumber(args.maxBytes, 200_000) ?? 200_000, 2_000_000);
    const stat = fs.statSync(p);
    if (!stat.isFile()) throw new Error(`${p} is not a file`);
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
      fs.readSync(fd, buf, 0, buf.length, 0);
      const truncated = stat.size > maxBytes ? `\n…[truncated, ${stat.size - maxBytes} bytes not shown]` : '';
      return buf.toString('utf-8') + truncated;
    } finally {
      fs.closeSync(fd);
    }
  },
};

const fsWriteTool: ToolHandler = {
  definition: {
    name: 'fs.write',
    description: 'Write (or overwrite) a text file. Creates parent directories as needed.',
    category: 'fs',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean', description: 'If true, append rather than overwrite.' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(args) {
    if (!settingsStore.load().agentAllowFs) throw new Error('Filesystem access is disabled in Settings → Agent.');
    const p = resolveFsPath(asString(args.path, 'path'));
    const content = asString(args.content, 'content');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (args.append) {
      fs.appendFileSync(p, content, 'utf-8');
    } else {
      fs.writeFileSync(p, content, 'utf-8');
    }
    return `Wrote ${content.length} chars to ${p}`;
  },
};

const fsListTool: ToolHandler = {
  definition: {
    name: 'fs.list',
    description: 'List files and subdirectories under a directory (non-recursive).',
    category: 'fs',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  async execute(args) {
    if (!settingsStore.load().agentAllowFs) throw new Error('Filesystem access is disabled in Settings → Agent.');
    const p = resolveFsPath(asString(args.path, 'path'));
    const entries = fs.readdirSync(p, { withFileTypes: true });
    return entries
      .map((e) => `${e.isDirectory() ? 'd' : 'f'}\t${e.name}`)
      .slice(0, 500)
      .join('\n');
  },
};

const shellExecTool: ToolHandler = {
  definition: {
    name: 'shell.exec',
    description: 'Run a single shell command and return combined stdout+stderr. Disabled unless enabled in Settings → Agent.',
    category: 'shell',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
  },
  async execute(args) {
    if (!settingsStore.load().agentAllowShell) {
      throw new Error('Shell execution is disabled. Enable it in Settings → Agent (understand the risks first).');
    }
    const command = asString(args.command, 'command');
    const cwd = asOptString(args.cwd);
    const timeoutMs = Math.min(asOptNumber(args.timeoutMs, 30_000) ?? 30_000, 180_000);
    if (cwd) resolveFsPath(cwd); // sandbox check

    return await new Promise<string>((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', command] : ['-c', command], {
        cwd,
        env: process.env,
        windowsHide: true,
      });
      let out = '';
      const onData = (buf: Buffer) => { out += buf.toString('utf-8'); };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      const to = setTimeout(() => {
        child.kill();
        reject(new Error(`shell.exec timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(to);
        resolve(truncate(`exit ${code}\n${out}`, 20000));
      });
      child.on('error', (err) => {
        clearTimeout(to);
        reject(err);
      });
    });
  },
};

const screenCaptureTool: ToolHandler = {
  definition: {
    name: 'screen.capture',
    description: 'Capture the primary screen and return a base64 PNG data URL.',
    category: 'screen',
    risk: 'low',
    inputSchema: { type: 'object', properties: {} },
  },
  async execute() {
    return await screenSvc.capturePrimary();
  },
};

const screenOcrTool: ToolHandler = {
  definition: {
    name: 'screen.ocr',
    description: 'Capture the primary screen, run OCR, and return the extracted text.',
    category: 'screen',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: { lang: { type: 'string', description: 'Tesseract language code (default: eng).' } },
    },
  },
  async execute(args) {
    const dataUrl = await screenSvc.capturePrimary();
    const ocr = await screenSvc.ocrImage(dataUrl, asOptString(args.lang));
    return ocr.text || '(no text detected)';
  },
};

const clipboardReadTool: ToolHandler = {
  definition: {
    name: 'clipboard.read',
    description: 'Read the current clipboard text contents.',
    category: 'clipboard',
    risk: 'safe',
    inputSchema: { type: 'object', properties: {} },
  },
  async execute() {
    return clipboard.readText() || '(clipboard is empty)';
  },
};

const clipboardWriteTool: ToolHandler = {
  definition: {
    name: 'clipboard.write',
    description: 'Copy text to the system clipboard.',
    category: 'clipboard',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  async execute(args) {
    const text = asString(args.text, 'text');
    clipboard.writeText(text);
    return `Copied ${text.length} chars to clipboard`;
  },
};

const windowGetActiveTool: ToolHandler = {
  definition: {
    name: 'window.active',
    description: 'Return info about the user\'s foreground window (title, app, URL if known).',
    category: 'window',
    risk: 'safe',
    inputSchema: { type: 'object', properties: {} },
  },
  async execute() {
    const info = await getActiveWindow();
    return info ? JSON.stringify(info, null, 2) : '(no active window)';
  },
};

const openExternalTool: ToolHandler = {
  definition: {
    name: 'window.openUrl',
    description: 'Open a URL in the user\'s default browser.',
    category: 'window',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  async execute(args) {
    const url = asString(args.url, 'url');
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
    await shell.openExternal(url);
    return `Opened ${url} in default browser`;
  },
};

const ragQueryTool: ToolHandler = {
  definition: {
    name: 'rag.query',
    description: 'Search the user\'s knowledge collections and return the top matching chunks with citations.',
    category: 'rag',
    risk: 'safe',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        collectionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional — if omitted, searches all collections.',
        },
        topK: { type: 'number' },
      },
      required: ['query'],
    },
  },
  async execute(args) {
    const query = asString(args.query, 'query');
    const topK = Math.min(asOptNumber(args.topK, 5) ?? 5, 20);
    const raw = args.collectionIds;
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : db.listCollections().map((c) => c.id);
    if (ids.length === 0) return '(no collections available)';
    const chunks = await ragSvc.retrieve(ids, query, topK);
    if (chunks.length === 0) return '(no matching chunks)';
    return chunks
      .map((c, i) => `[${i + 1}] ${c.filename ?? c.documentId} (score ${(c.score ?? 0).toFixed(3)})\n${c.text}`)
      .join('\n\n');
  },
};

const memorySaveTool: ToolHandler = {
  definition: {
    name: 'memory.save',
    description: 'Persist a fact, preference, or episode to long-term memory so it survives across conversations.',
    category: 'memory',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        scope: { type: 'string', enum: ['user', 'preference', 'fact', 'episode'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['text'],
    },
  },
  async execute(args) {
    const text = asString(args.text, 'text');
    const scope = (asOptString(args.scope) as MemoryScopeAlias) ?? 'fact';
    const tags = Array.isArray(args.tags)
      ? args.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const saved = await memorySvc.remember(scope, text, tags);
    return `Saved memory ${saved.id} (scope=${saved.scope}, tags=[${saved.tags.join(', ')}])`;
  },
};

const memoryRecallTool: ToolHandler = {
  definition: {
    name: 'memory.recall',
    description: 'Search long-term memory for entries relevant to a query.',
    category: 'memory',
    risk: 'safe',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', enum: ['user', 'preference', 'fact', 'episode'] },
        topK: { type: 'number' },
      },
      required: ['query'],
    },
  },
  async execute(args) {
    const query = asString(args.query, 'query');
    const scope = asOptString(args.scope) as MemoryScopeAlias | undefined;
    const topK = Math.min(asOptNumber(args.topK, 5) ?? 5, 20);
    const results = await memorySvc.recall(query, topK, scope);
    if (results.length === 0) return '(no memories matched)';
    return results
      .map((m, i) => `[${i + 1}] (${m.scope}${m.pinned ? ', pinned' : ''}) ${m.text}`)
      .join('\n');
  },
};

type MemoryScopeAlias = 'user' | 'preference' | 'fact' | 'episode';

const artifactCreateTool: ToolHandler = {
  definition: {
    name: 'artifact.create',
    description: 'Create an artifact (code, markdown, html, svg, or json) in the side Canvas.',
    category: 'artifact',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: ['code', 'markdown', 'html', 'svg', 'json'] },
        language: { type: 'string' },
        content: { type: 'string' },
        threadId: { type: 'string' },
      },
      required: ['title', 'kind', 'content'],
    },
  },
  async execute(args) {
    const title = asString(args.title, 'title');
    const kind = (asOptString(args.kind) ?? 'code') as Parameters<typeof db.createArtifact>[2];
    const language = asOptString(args.language) ?? 'txt';
    const content = asString(args.content, 'content');
    const threadId = asOptString(args.threadId) ?? null;
    const a = db.createArtifact(threadId, title, kind, language, content);
    return `Created artifact ${a.id} "${a.title}" (${a.kind}/${a.language}, v${a.version})`;
  },
};

const artifactUpdateTool: ToolHandler = {
  definition: {
    name: 'artifact.update',
    description: 'Overwrite an existing artifact with new content. Bumps the version automatically.',
    category: 'artifact',
    risk: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['id', 'content'],
    },
  },
  async execute(args) {
    const id = asString(args.id, 'id');
    const content = asString(args.content, 'content');
    const updated = db.updateArtifact(id, content);
    if (!updated) throw new Error(`Artifact ${id} not found`);
    return `Updated artifact ${id} to v${updated.version}`;
  },
};

// ─── desktop automation (OS-level mouse/keyboard) ──────────────────
//
// High-risk. The `assertEnabled()` guard inside desktopControl will throw
// if `settings.osAutomationEnabled` is false, so these tools no-op safely
// until the user opts in.

const desktopMoveMouseTool: ToolHandler = {
  definition: {
    name: 'desktop.move_mouse',
    description: 'Move the OS mouse cursor to absolute screen coordinates (x, y). Off by default; requires Settings → Privacy → OS automation.',
    category: 'desktop',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
  },
  async execute(args) {
    const x = asOptNumber(args.x);
    const y = asOptNumber(args.y);
    if (x === undefined || y === undefined) throw new Error('x and y are required numbers');
    await desktop.mouseMove(x, y);
    return `Moved cursor to (${x}, ${y})`;
  },
};

const desktopClickTool: ToolHandler = {
  definition: {
    name: 'desktop.click',
    description: 'Click the OS mouse at its current position. button is one of left|right|middle (default left). double=true for a double click.',
    category: 'desktop',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        double: { type: 'boolean' },
      },
    },
  },
  async execute(args) {
    const button = (asOptString(args.button) ?? 'left') as 'left' | 'right' | 'middle';
    const double = args.double === true;
    if (double) await desktop.mouseDoubleClick(button);
    else await desktop.mouseClick(button);
    return `${double ? 'Double-clicked' : 'Clicked'} ${button}`;
  },
};

const desktopScrollTool: ToolHandler = {
  definition: {
    name: 'desktop.scroll',
    description: 'Scroll the OS mouse wheel. direction=up|down|left|right, amount = number of ticks (1–50).',
    category: 'desktop',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number' },
      },
      required: ['direction', 'amount'],
    },
  },
  async execute(args) {
    const direction = asString(args.direction, 'direction') as 'up' | 'down' | 'left' | 'right';
    const amount = asOptNumber(args.amount, 3) ?? 3;
    await desktop.mouseScroll(direction, amount);
    return `Scrolled ${direction} by ${amount}`;
  },
};

const desktopTypeTool: ToolHandler = {
  definition: {
    name: 'desktop.type',
    description: 'Type text into whatever app currently has keyboard focus. Clamped to 4000 characters.',
    category: 'desktop',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  async execute(args) {
    const text = asString(args.text, 'text');
    await desktop.keyboardType(text);
    return `Typed ${text.length} characters`;
  },
};

const desktopShortcutTool: ToolHandler = {
  definition: {
    name: 'desktop.shortcut',
    description: 'Press a key combination (e.g. ["ctrl","c"] or ["cmd","shift","t"]). Max 6 keys. Common aliases: ctrl, cmd, alt, shift, enter, esc, tab, up/down/left/right, pageup, pagedown.',
    category: 'desktop',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'array', items: { type: 'string' } } },
      required: ['keys'],
    },
  },
  async execute(args) {
    const raw = args.keys;
    if (!Array.isArray(raw)) throw new Error('keys must be an array of strings');
    const keys = raw.map((k, i) => { if (typeof k !== 'string') throw new Error(`keys[${i}] must be a string`); return k; });
    await desktop.keyboardShortcut(keys);
    return `Sent shortcut: ${keys.join('+')}`;
  },
};

const desktopMousePosTool: ToolHandler = {
  definition: {
    name: 'desktop.mouse_position',
    description: 'Return the current OS mouse cursor position (absolute screen coords).',
    category: 'desktop',
    risk: 'medium',
    inputSchema: { type: 'object', properties: {} },
  },
  async execute() {
    const p = await desktop.mousePosition();
    return JSON.stringify(p);
  },
};

const desktopScreenSizeTool: ToolHandler = {
  definition: {
    name: 'desktop.screen_size',
    description: 'Return the primary display resolution in pixels.',
    category: 'desktop',
    risk: 'low',
    inputSchema: { type: 'object', properties: {} },
  },
  async execute() {
    const s = await desktop.screenSize();
    return JSON.stringify(s);
  },
};

// ─── registry ──────────────────────────────────────────────────────

export const builtInTools: ToolHandler[] = [
  webSearchTool,
  webFetchTool,
  fsReadTool,
  fsWriteTool,
  fsListTool,
  shellExecTool,
  screenCaptureTool,
  screenOcrTool,
  clipboardReadTool,
  clipboardWriteTool,
  windowGetActiveTool,
  openExternalTool,
  ragQueryTool,
  memorySaveTool,
  memoryRecallTool,
  artifactCreateTool,
  artifactUpdateTool,
  desktopMoveMouseTool,
  desktopClickTool,
  desktopScrollTool,
  desktopTypeTool,
  desktopShortcutTool,
  desktopMousePosTool,
  desktopScreenSizeTool,
];

const handlerMap = new Map<string, ToolHandler>();
for (const t of builtInTools) handlerMap.set(t.definition.name, t);

export function findTool(name: string): ToolHandler | undefined {
  return handlerMap.get(name);
}

export function listBuiltInDefinitions(): ToolDefinition[] {
  return builtInTools.map((t) => t.definition);
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const handler = handlerMap.get(name);
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  logger.debug('tool call', name, Object.keys(args));
  return await handler.execute(args);
}
