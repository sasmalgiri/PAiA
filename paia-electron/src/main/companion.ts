// Mobile companion endpoint.
//
// Exposes PAiA to a phone browser on the same LAN as a tiny PWA. The
// phone sends chat messages that flow through the same pipeline as the
// desktop panel (redaction + persona prompt + RAG context + memory
// context + provider dispatch + token streaming) and receives streaming
// replies via Server-Sent Events.
//
// Security:
//   - Bound to 0.0.0.0 only when the user explicitly starts the server.
//   - Every API call must carry a bearer pair-token.
//   - The token is generated once per server start, shown on the desktop
//     as a QR + URL, and stored on the phone in localStorage on first
//     load. Restarting the server invalidates the previous token.
//   - No cookies, no CORS — same-origin bearer-auth only.
//
// The PWA is embedded inline in this file (no external bundle step) so
// the first visit from a phone instantly loads a self-contained app.

import { app, ipcMain } from 'electron';
import * as crypto from 'crypto';
import * as http from 'http';
import * as os from 'os';
import type { CompanionState } from '../shared/types';
import type { ChatMessage } from '../shared/types';
import * as db from './db';
import * as settingsStore from './settings';
import * as providers from './providers';
import * as memorySvc from './memory';
import * as personas from './personas';
import { redact } from '../shared/redaction';
import { logger } from './logger';

// ─── state ────────────────────────────────────────────────────────

let server: http.Server | null = null;
let pairToken = '';
let boundHost = '';
let boundPort = 0;
let lastError: string | undefined;

const sseClients = new Set<http.ServerResponse>();

function hostLanIp(): string {
  const nets = os.networkInterfaces();
  for (const key of Object.keys(nets)) {
    for (const iface of nets[key] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ─── PWA HTML (inline) ────────────────────────────────────────────

const PWA_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1a1a20" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <title>PAiA mobile</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #15151b;
      --bg-2: #23232b;
      --bg-3: #2a2a32;
      --border: #333;
      --text: #eee;
      --muted: #aaa;
      --system: #888;
      --accent: #3498db;
      --accent-bg: #2a5f8d;
      --accent-fg: #fff;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --bg-2: #f5f5f7;
        --bg-3: #eceef2;
        --border: #d0d4db;
        --text: #1a1a20;
        --muted: #5b5f66;
        --system: #7a7f87;
        --accent: #2a7fbf;
        --accent-bg: #d7e7f5;
        --accent-fg: #0b2a44;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, system-ui, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
    #app { display: flex; flex-direction: column; height: 100dvh; }
    header { padding: env(safe-area-inset-top) 16px 10px; background: var(--bg-2); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    header strong { font-size: 16px; }
    header small { color: var(--muted); font-size: 11px; }
    .thread-list { padding: 8px; display: flex; gap: 6px; overflow-x: auto; border-bottom: 1px solid var(--border); }
    .thread-chip { flex: 0 0 auto; background: var(--bg-3); border: 1px solid var(--border); border-radius: 14px; padding: 5px 10px; font-size: 12px; color: var(--text); }
    .thread-chip.active { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-fg); }
    .messages { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; font-size: 14px; }
    .msg.user { background: var(--accent-bg); color: var(--accent-fg); align-self: flex-end; }
    .msg.assistant { background: var(--bg-3); align-self: flex-start; border: 1px solid var(--border); }
    .msg.system { align-self: center; font-style: italic; color: var(--system); font-size: 12px; }
    footer { padding: 8px 12px env(safe-area-inset-bottom); background: var(--bg-2); border-top: 1px solid var(--border); display: flex; gap: 6px; }
    textarea { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 14px; resize: none; font-family: inherit; }
    button { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0 14px; font-size: 14px; }
    button:disabled { opacity: 0.5; }
    .pair { padding: 40px; display: flex; flex-direction: column; gap: 10px; }
    .pair input { width: 100%; padding: 10px; font-size: 16px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
  (function () {
    const tokenKey = 'paia-pair-token';

    function qs(name) {
      return new URLSearchParams(location.search).get(name);
    }

    function saveToken(t) { localStorage.setItem(tokenKey, t); }
    function getToken() { return localStorage.getItem(tokenKey); }

    const urlToken = qs('t');
    if (urlToken) {
      saveToken(urlToken);
      history.replaceState({}, '', location.pathname);
    }

    const token = getToken();
    const app = document.getElementById('app');

    if (!token) {
      app.innerHTML = '<div class="pair"><strong>Paste pair token</strong><input id="pt" placeholder="from desktop PAiA"><button onclick="(function(){var v=document.getElementById(\\'pt\\').value.trim();if(v){localStorage.setItem(\\'paia-pair-token\\',v);location.reload();}})()">Pair</button></div>';
      return;
    }

    const auth = { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };

    async function api(path, opts) {
      const merged = Object.assign({}, auth, opts || {});
      if (!merged.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        merged.signal = AbortSignal.timeout(15000);
      }
      const res = await fetch(path, merged);
      if (res.status === 401) {
        localStorage.removeItem(tokenKey);
        location.reload();
        return null;
      }
      return res;
    }

    let threads = [];
    let currentThreadId = null;
    let messages = [];

    async function render() {
      app.innerHTML = ''
        + '<header><strong>PAiA</strong><small id="hdrmeta"></small></header>'
        + '<div class="thread-list" id="threads"></div>'
        + '<div class="messages" id="messages"></div>'
        + '<footer><textarea id="draft" rows="2" placeholder="Message PAiA..."></textarea><button id="send">Send</button></footer>';

      document.getElementById('send').addEventListener('click', send);
      document.getElementById('draft').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });

      await refreshThreads();
      connectSse();
    }

    async function refreshThreads() {
      const res = await api('/api/threads');
      if (!res || !res.ok) return;
      threads = await res.json();
      if (!currentThreadId && threads[0]) currentThreadId = threads[0].id;
      const el = document.getElementById('threads');
      el.innerHTML = '';
      threads.forEach(function (t) {
        const b = document.createElement('button');
        b.className = 'thread-chip' + (t.id === currentThreadId ? ' active' : '');
        b.textContent = t.title || '(no title)';
        b.onclick = function () { currentThreadId = t.id; refreshMessages(); refreshThreads(); };
        el.appendChild(b);
      });
      const newBtn = document.createElement('button');
      newBtn.className = 'thread-chip';
      newBtn.textContent = '＋';
      newBtn.onclick = async function () {
        const r = await api('/api/threads', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) });
        if (r && r.ok) {
          const t = await r.json();
          currentThreadId = t.id;
          await refreshThreads();
          await refreshMessages();
        }
      };
      el.appendChild(newBtn);
      await refreshMessages();
    }

    async function refreshMessages() {
      if (!currentThreadId) return;
      const res = await api('/api/messages?thread_id=' + encodeURIComponent(currentThreadId));
      if (!res || !res.ok) return;
      messages = await res.json();
      renderMessages();
    }

    function renderMessages() {
      const list = document.getElementById('messages');
      if (!list) return;
      list.innerHTML = '';
      messages.forEach(function (m) {
        const div = document.createElement('div');
        div.className = 'msg ' + m.role;
        div.textContent = m.content;
        div.dataset.id = m.id;
        list.appendChild(div);
      });
      list.scrollTop = list.scrollHeight;
    }

    async function send() {
      const ta = document.getElementById('draft');
      const text = ta.value.trim();
      if (!text || !currentThreadId) return;
      ta.value = '';
      messages.push({ id: 'opt-' + Date.now(), role: 'user', content: text });
      messages.push({ id: 'opt-asst-' + Date.now(), role: 'assistant', content: '' });
      renderMessages();
      await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ threadId: currentThreadId, text: text }),
      });
    }

    function connectSse() {
      const src = new EventSource('/api/events?token=' + encodeURIComponent(token));
      src.addEventListener('token', function (e) {
        const d = JSON.parse(e.data);
        if (d.threadId !== currentThreadId) return;
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant') {
          last.content += d.token;
          renderMessages();
        }
      });
      src.addEventListener('done', function () { void refreshMessages(); });
      src.onerror = function () { src.close(); setTimeout(connectSse, 2000); };
    }

    render();
  })();
  </script>
</body>
</html>`;

// ─── HTTP handlers ────────────────────────────────────────────────

function unauthorized(res: http.ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function tokenFromRequest(req: http.IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('token');
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf-8');
      try { resolve(s ? JSON.parse(s) : null); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // PWA HTML — no auth.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/m' || url.pathname === '/mobile')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(PWA_HTML);
    return;
  }

  // Every API call needs the pair token — compared in constant time
  // to defeat timing oracles from LAN attackers probing the server.
  const t = tokenFromRequest(req);
  const ok = t != null
    && t.length === pairToken.length
    && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(pairToken));
  if (!ok) { unauthorized(res); return; }

  if (req.method === 'GET' && url.pathname === '/api/threads') {
    json(res, 200, db.listThreads());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/threads') {
    const body = (await readBody(req)) as { title?: string } | null;
    const s = settingsStore.load();
    const t = db.createThread(body?.title ?? 'New chat', s.personaId, s.model || null);
    json(res, 200, t);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    const threadId = url.searchParams.get('thread_id');
    if (!threadId) { json(res, 400, { error: 'thread_id required' }); return; }
    json(res, 200, db.listMessages(threadId));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = (await readBody(req)) as { threadId?: string; text?: string } | null;
    if (!body?.threadId || !body.text) { json(res, 400, { error: 'threadId + text required' }); return; }
    const settings = settingsStore.load();
    const persona = personas.listPersonas().find((p) => p.id === settings.personaId) ?? personas.listPersonas()[0];
    const model = settings.model;
    if (!model) { json(res, 400, { error: 'No model selected on the desktop.' }); return; }

    const redacted = redact(body.text);
    db.addMessage(body.threadId, 'user', redacted.redacted, redacted.matchCount);
    let systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
    try {
      const mem = await memorySvc.buildContextBlock(redacted.redacted);
      if (mem) systemPrompt += '\n\n' + mem;
    } catch { /* ignore */ }

    const history = db.listMessages(body.threadId);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Streaming reply — emit tokens to every SSE client; the phone that
    // originated this will filter by threadId. Response here returns 202
    // immediately since the phone is listening on /api/events.
    res.statusCode = 202;
    res.end(JSON.stringify({ ok: true }));

    let assembled = '';
    try {
      const text = await providers.chat(model, messages, (token) => {
        assembled += token;
        broadcastSse('token', { threadId: body.threadId, token });
      });
      db.addMessage(body.threadId, 'assistant', text || assembled, 0);
      broadcastSse('done', { threadId: body.threadId });
    } catch (err) {
      broadcastSse('done', { threadId: body.threadId, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); });
    return;
  }

  json(res, 404, { error: 'not found' });
}

function broadcastSse(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.write(msg); } catch { /* client dropped */ }
  }
}

// ─── lifecycle ────────────────────────────────────────────────────

export function start(port: number = 8743): CompanionState {
  stop();
  pairToken = crypto.randomBytes(16).toString('base64url');
  boundHost = hostLanIp();
  boundPort = port;
  server = http.createServer((req, res) => { void handle(req, res).catch((err) => {
    logger.error('companion handle error', err);
    try { json(res, 500, { error: 'internal' }); } catch { /* ignore */ }
  }); });
  server.on('error', (err) => { lastError = err.message; });
  server.listen(port, '0.0.0.0', () => {
    logger.info(`companion listening on ${boundHost}:${port}`);
  });
  return getState();
}

export function stop(): CompanionState {
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
  for (const c of sseClients) { try { c.end(); } catch { /* ignore */ } }
  sseClients.clear();
  pairToken = '';
  return getState();
}

export function getState(): CompanionState {
  if (!server) return { running: false, host: '', port: 0, error: lastError };
  return {
    running: true,
    host: boundHost,
    port: boundPort,
    pairToken,
    pairUrl: `http://${boundHost}:${boundPort}/?t=${pairToken}`,
    error: lastError,
  };
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:companion-state', () => getState());
ipcMain.handle('paia:companion-start', (_e, p: { port?: number }) => start(p?.port));
ipcMain.handle('paia:companion-stop', () => stop());

void app;
