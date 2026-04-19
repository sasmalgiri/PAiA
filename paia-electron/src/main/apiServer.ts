// Local REST API server.
//
// Bound to 127.0.0.1 ONLY. Other processes on the same machine can
// drive PAiA — Raycast / Alfred / custom CLI scripts / IDE extensions /
// Shortcuts / whatever. Bearer-token auth using a randomly-generated
// API key (rotates every time the server restarts unless the user
// explicitly pins one). Not exposed on the LAN even accidentally.
//
// Endpoints (every one requires `Authorization: Bearer <key>`):
//
//   GET   /v1/info                                app version + model
//   GET   /v1/threads                             list threads
//   POST  /v1/threads         {title?}            create a thread
//   GET   /v1/threads/:id/messages                messages in a thread
//   POST  /v1/chat            {threadId, text}    one-shot chat, SSE reply
//   POST  /v1/agent           {threadId, goal}    start an agent run
//   GET   /v1/agent/:id                           run status + steps
//   POST  /v1/research        {threadId, q}       start deep research
//   GET   /v1/memory                              list memory entries
//   POST  /v1/memory          {scope, text, …}    save a memory
//
// Everything returns JSON except /v1/chat which streams text/event-stream.

import { app, ipcMain } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type {
  ApiServerState,
  ChatMessage,
} from '../shared/types';
import * as db from './db';
import * as agent from './agent';
import * as researchSvc from './research';
import * as memorySvc from './memory';
import * as personas from './personas';
import * as settingsStore from './settings';
import * as providers from './providers';
import { redact } from '../shared/redaction';
import { logger } from './logger';

// ─── persisted key + port ────────────────────────────────────────

interface ApiConfig {
  port: number;
  apiKey: string;
  pinnedKey: boolean;
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'api-server.json');
}

function loadConfig(): ApiConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ApiConfig>;
    if (typeof parsed.port === 'number' && typeof parsed.apiKey === 'string') {
      return { port: parsed.port, apiKey: parsed.apiKey, pinnedKey: parsed.pinnedKey === true };
    }
  } catch { /* ignore */ }
  const cfg: ApiConfig = { port: 8744, apiKey: crypto.randomBytes(24).toString('base64url'), pinnedKey: false };
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}

function saveConfig(cfg: ApiConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// ─── runtime state ───────────────────────────────────────────────

let server: http.Server | null = null;
let lastError: string | undefined;

// ─── helpers ─────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
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

// ─── handler ──────────────────────────────────────────────────────

async function handle(req: http.IncomingMessage, res: http.ServerResponse, cfg: ApiConfig): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  // /v1/info is still auth-protected — this is a private API.
  // Timing-safe comparison: even though the server binds to 127.0.0.1,
  // a co-resident process can still time HTTP requests and brute-force
  // the key character-by-character against a naive `!==`.
  const token = bearer(req);
  const ok = token != null
    && token.length === cfg.apiKey.length
    && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cfg.apiKey));
  if (!ok) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }

  // GET /v1/info
  if (req.method === 'GET' && url.pathname === '/v1/info') {
    json(res, 200, {
      product: 'paia',
      version: app.getVersion(),
      model: settingsStore.load().model,
    });
    return;
  }

  // GET /v1/threads
  if (req.method === 'GET' && url.pathname === '/v1/threads') {
    json(res, 200, db.listThreads());
    return;
  }

  // POST /v1/threads {title?}
  if (req.method === 'POST' && url.pathname === '/v1/threads') {
    const body = (await readJson(req)) as { title?: string } | null;
    const s = settingsStore.load();
    const t = db.createThread(body?.title ?? 'API thread', s.personaId, s.model || null);
    json(res, 200, t);
    return;
  }

  // GET /v1/threads/:id/messages
  const msgMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/);
  if (req.method === 'GET' && msgMatch) {
    json(res, 200, db.listMessages(msgMatch[1]));
    return;
  }

  // POST /v1/chat
  if (req.method === 'POST' && url.pathname === '/v1/chat') {
    const body = (await readJson(req)) as { threadId?: string; text?: string; model?: string } | null;
    if (!body?.threadId || !body.text) {
      json(res, 400, { error: 'threadId + text required' });
      return;
    }
    const settings = settingsStore.load();
    const model = body.model ?? settings.model;
    if (!model) { json(res, 400, { error: 'no model configured' }); return; }

    const persona = personas.listPersonas().find((p) => p.id === settings.personaId) ?? personas.listPersonas()[0];
    let systemPrompt = persona?.systemPrompt ?? 'You are a helpful assistant.';
    try { const mem = await memorySvc.buildContextBlock(body.text); if (mem) systemPrompt += '\n\n' + mem; }
    catch { /* ignore */ }

    const redacted = redact(body.text);
    db.addMessage(body.threadId, 'user', redacted.redacted, redacted.matchCount);

    const history = db.listMessages(body.threadId);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');

    let assembled = '';
    try {
      const text = await providers.chat(model, messages, (token) => {
        assembled += token;
        res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
      });
      db.addMessage(body.threadId, 'assistant', text || assembled, 0);
      res.write(`event: done\ndata: ${JSON.stringify({ text: text || assembled })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    res.end();
    return;
  }

  // POST /v1/agent
  if (req.method === 'POST' && url.pathname === '/v1/agent') {
    const body = (await readJson(req)) as { threadId?: string; goal?: string; model?: string; autonomy?: 'manual' | 'assisted' | 'autonomous'; stepBudget?: number } | null;
    if (!body?.threadId || !body.goal) {
      json(res, 400, { error: 'threadId + goal required' });
      return;
    }
    const settings = settingsStore.load();
    try {
      const run = await agent.startRun({
        threadId: body.threadId,
        goal: body.goal,
        model: body.model ?? settings.model,
        autonomy: body.autonomy ?? settings.agentAutonomy,
        stepBudget: body.stepBudget ?? settings.agentStepBudget,
      });
      json(res, 200, run);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // GET /v1/agent/:id
  const agentMatch = url.pathname.match(/^\/v1\/agent\/([^/]+)$/);
  if (req.method === 'GET' && agentMatch) {
    const runId = agentMatch[1];
    const steps = db.listAgentSteps(runId);
    const run = db.listAgentRuns().find((r) => r.id === runId);
    if (!run) { json(res, 404, { error: 'run not found' }); return; }
    json(res, 200, { run, steps });
    return;
  }

  // POST /v1/research
  if (req.method === 'POST' && url.pathname === '/v1/research') {
    const body = (await readJson(req)) as { threadId?: string; question?: string; model?: string } | null;
    if (!body?.threadId || !body.question) {
      json(res, 400, { error: 'threadId + question required' });
      return;
    }
    try {
      const run = await researchSvc.startRun({
        threadId: body.threadId,
        question: body.question,
        model: body.model ?? settingsStore.load().model,
      });
      json(res, 200, run);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // GET /v1/memory
  if (req.method === 'GET' && url.pathname === '/v1/memory') {
    json(res, 200, memorySvc.listAll());
    return;
  }

  // POST /v1/memory
  if (req.method === 'POST' && url.pathname === '/v1/memory') {
    const body = (await readJson(req)) as { scope?: 'user' | 'preference' | 'fact' | 'episode'; text?: string; tags?: string[]; pinned?: boolean } | null;
    if (!body?.text) {
      json(res, 400, { error: 'text required' });
      return;
    }
    try {
      const entry = await memorySvc.remember(body.scope ?? 'fact', body.text, body.tags ?? [], body.pinned === true);
      json(res, 200, entry);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
}

// ─── lifecycle ────────────────────────────────────────────────────

export function start(port?: number): ApiServerState {
  stop();
  const saved = loadConfig();
  const cfg: ApiConfig = {
    port: port ?? saved.port,
    apiKey: saved.pinnedKey ? saved.apiKey : crypto.randomBytes(24).toString('base64url'),
    pinnedKey: saved.pinnedKey,
  };
  saveConfig(cfg);
  server = http.createServer((req, res) => {
    void handle(req, res, cfg).catch((err) => {
      logger.error('api server handle error', err);
      try { json(res, 500, { error: 'internal' }); } catch { /* ignore */ }
    });
  });
  server.on('error', (err) => { lastError = err.message; });
  server.listen(cfg.port, '127.0.0.1', () => {
    logger.info(`api server listening on 127.0.0.1:${cfg.port}`);
  });
  return getState();
}

export function stop(): ApiServerState {
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
  return getState();
}

export function getState(): ApiServerState {
  const cfg = loadConfig();
  return {
    running: !!server,
    port: cfg.port,
    apiKey: server ? cfg.apiKey : undefined,
    error: lastError,
  };
}

export function regenerateKey(): ApiServerState {
  const cfg = loadConfig();
  cfg.apiKey = crypto.randomBytes(24).toString('base64url');
  saveConfig(cfg);
  // If running, restart so the new key takes effect.
  if (server) { stop(); start(cfg.port); }
  return getState();
}

export function setPinnedKey(pinned: boolean): ApiServerState {
  const cfg = loadConfig();
  cfg.pinnedKey = pinned;
  saveConfig(cfg);
  return getState();
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:api-server-state', () => getState());
ipcMain.handle('paia:api-server-start', (_e, p: { port?: number }) => start(p?.port));
ipcMain.handle('paia:api-server-stop', () => stop());
ipcMain.handle('paia:api-server-regenerate-key', () => regenerateKey());
ipcMain.handle('paia:api-server-set-pinned', (_e, pinned: boolean) => setPinnedKey(pinned));
