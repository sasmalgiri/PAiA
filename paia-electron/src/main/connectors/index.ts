// Connector manager.
//
// Exposes a uniform API over five third-party services:
//
//   gmail     — Google Gmail (OAuth → IMAP-free REST send/search)
//   calendar  — Google Calendar
//   drive     — Google Drive
//   github    — GitHub (repos, issues, PRs)
//   slack     — Slack (read channels, post messages)
//
// Each connector:
//   - descriptor: static metadata shown in Settings → Connectors
//   - config:     persisted clientId/clientSecret per connector
//   - status:     whether a token is present + when it expires
//   - connect():  run the OAuth flow + save the token
//   - disconnect(): delete the stored token
//   - tools:      returns a ToolHandler[] the Agent can call after connect
//
// Tokens live in sqlite (`connector_tokens` table) keyed by connector id.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as db from '../db';
import type {
  ConnectorConfig,
  ConnectorDescriptor,
  ConnectorId,
  ConnectorStatus,
  ToolDefinition,
} from '../../shared/types';
import type { ToolHandler } from '../tools';
import { runOAuthFlow, refresh, type OAuthProviderConfig } from './oauth';
import { requireFeature } from '../license';
import { logger } from '../logger';

// ─── descriptors ───────────────────────────────────────────────────

export const DESCRIPTORS: ConnectorDescriptor[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    emoji: '✉️',
    description: 'Read, search, and send email through your Google account.',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    requiresClientId: true,
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    emoji: '📅',
    description: 'List events, create meetings, and check availability.',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar',
    ],
    requiresClientId: true,
  },
  {
    id: 'drive',
    name: 'Google Drive',
    emoji: '🗂',
    description: 'Search files, read docs, and upload new ones.',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/drive',
    ],
    requiresClientId: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    emoji: '🐙',
    description: 'Browse repos, open issues, manage pull requests.',
    scopes: ['repo', 'read:user', 'user:email'],
    requiresClientId: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    emoji: '💬',
    description: 'Read channels and post messages on your behalf.',
    scopes: ['channels:read', 'channels:history', 'chat:write', 'users:read'],
    requiresClientId: true,
  },
];

// ─── persisted configs ─────────────────────────────────────────────

function configPath(): string {
  return path.join(app.getPath('userData'), 'connectors.json');
}

export function loadConfigs(): ConnectorConfig[] {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as ConnectorConfig[];
    const result: ConnectorConfig[] = [];
    for (const d of DESCRIPTORS) {
      result.push(parsed.find((p) => p.id === d.id) ?? { id: d.id, enabled: false });
    }
    return result;
  } catch {
    return DESCRIPTORS.map((d) => ({ id: d.id, enabled: false }));
  }
}

export function saveConfigs(list: ConnectorConfig[]): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(list, null, 2));
}

function getCfg(id: ConnectorId): ConnectorConfig {
  return loadConfigs().find((c) => c.id === id)!;
}

// ─── OAuth descriptors per provider ───────────────────────────────

function oauthFor(id: ConnectorId, cfg: ConnectorConfig): OAuthProviderConfig {
  const descriptor = DESCRIPTORS.find((d) => d.id === id)!;
  if (!cfg.clientId) throw new Error(`${descriptor.name} client ID is not configured.`);
  switch (id) {
    case 'gmail':
    case 'calendar':
    case 'drive':
      return {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: descriptor.scopes,
        extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
      };
    case 'github':
      return {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: descriptor.scopes,
      };
    case 'slack':
      return {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        authorizeUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: descriptor.scopes,
        extraAuthorizeParams: { user_scope: descriptor.scopes.join(',') },
      };
  }
}

// ─── connect / disconnect ─────────────────────────────────────────

export async function connect(id: ConnectorId): Promise<ConnectorStatus> {
  requireFeature('connectors');
  const cfg = getCfg(id);
  const oauth = oauthFor(id, cfg);
  const tokens = await runOAuthFlow(oauth);
  const descriptor = DESCRIPTORS.find((d) => d.id === id)!;
  const account = await lookupAccountName(id, tokens.accessToken).catch(() => '');
  db.saveConnectorToken({
    id,
    account,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
    scopes: tokens.scopes.length > 0 ? tokens.scopes : descriptor.scopes,
    expiresAt: tokens.expiresAt,
    updatedAt: Date.now(),
  });
  return status(id);
}

export function disconnect(id: ConnectorId): ConnectorStatus {
  db.deleteConnectorToken(id);
  return status(id);
}

export function status(id: ConnectorId): ConnectorStatus {
  const tok = db.getConnectorToken(id);
  if (!tok) return { id, connected: false };
  return {
    id,
    connected: true,
    account: tok.account || undefined,
    scopes: tok.scopes,
    expiresAt: tok.expiresAt,
  };
}

export function listStatuses(): ConnectorStatus[] {
  return DESCRIPTORS.map((d) => status(d.id));
}

// ─── authenticated fetch ──────────────────────────────────────────

async function authedFetch(id: ConnectorId, url: string, init: RequestInit = {}): Promise<Response> {
  let tok = db.getConnectorToken(id);
  if (!tok) throw new Error(`${id} is not connected`);

  // Best-effort refresh if we're within 60 seconds of expiry.
  if (tok.expiresAt && tok.refreshToken && Date.now() > tok.expiresAt - 60_000) {
    try {
      const cfg = getCfg(id);
      const oauth = oauthFor(id, cfg);
      const refreshed = await refresh(oauth, tok.refreshToken);
      const next = {
        ...tok,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? tok.refreshToken,
        expiresAt: refreshed.expiresAt,
        updatedAt: Date.now(),
      };
      db.saveConnectorToken(next);
      tok = next;
    } catch (err) {
      logger.warn(`${id}: token refresh failed`, err);
    }
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `${tok.tokenType} ${tok.accessToken}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(url, { ...init, headers });
}

async function lookupAccountName(id: ConnectorId, accessToken: string): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    switch (id) {
      case 'gmail':
      case 'calendar':
      case 'drive': {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers });
        if (!r.ok) return '';
        const j = (await r.json()) as { email?: string };
        return j.email ?? '';
      }
      case 'github': {
        const r = await fetch('https://api.github.com/user', {
          headers: { Authorization: `token ${accessToken}`, Accept: 'application/json' },
        });
        if (!r.ok) return '';
        const j = (await r.json()) as { login?: string };
        return j.login ?? '';
      }
      case 'slack': {
        const r = await fetch('https://slack.com/api/auth.test', { headers });
        if (!r.ok) return '';
        const j = (await r.json()) as { user?: string };
        return j.user ?? '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

// ─── tool handlers per connector ───────────────────────────────────

function wrap(definition: ToolDefinition, execute: (args: Record<string, unknown>) => Promise<string>): ToolHandler {
  return { definition, execute };
}

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required string argument "${name}"`);
  return v;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Gmail ------------------------------------------------------------

function gmailTools(): ToolHandler[] {
  return [
    wrap(
      {
        name: 'gmail.search',
        description: 'Search the user\'s Gmail inbox. Uses Gmail search syntax (from:, subject:, is:unread, …).',
        category: 'connector',
        risk: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            max: { type: 'number' },
          },
          required: ['q'],
        },
      },
      async (args) => {
        const q = asString(args.q, 'q');
        const max = Math.min(asNumber(args.max, 10), 50);
        const listRes = await authedFetch(
          'gmail',
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
        );
        if (!listRes.ok) throw new Error(`Gmail list failed: HTTP ${listRes.status}`);
        const list = (await listRes.json()) as { messages?: { id: string }[] };
        const ids = (list.messages ?? []).slice(0, max).map((m) => m.id);

        const summaries: string[] = [];
        for (const id of ids) {
          const r = await authedFetch(
            'gmail',
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          );
          if (!r.ok) continue;
          const m = (await r.json()) as {
            snippet?: string;
            payload?: { headers?: { name: string; value: string }[] };
          };
          const get = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
          summaries.push(`id=${id} | ${get('Date')}\nFrom: ${get('From')}\nSubject: ${get('Subject')}\n${m.snippet ?? ''}`);
        }
        return summaries.length === 0 ? '(no messages)' : summaries.join('\n\n');
      },
    ),
    wrap(
      {
        name: 'gmail.send',
        description: 'Send an email on the user\'s behalf. This action is not reversible.',
        category: 'connector',
        risk: 'high',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            body: { type: 'string' },
            cc: { type: 'string' },
            bcc: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      async (args) => {
        const to = asString(args.to, 'to');
        const subject = asString(args.subject, 'subject');
        const body = asString(args.body, 'body');
        const cc = typeof args.cc === 'string' ? args.cc : '';
        const bcc = typeof args.bcc === 'string' ? args.bcc : '';
        const lines = [
          `To: ${to}`,
          cc ? `Cc: ${cc}` : '',
          bcc ? `Bcc: ${bcc}` : '',
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=UTF-8',
          '',
          body,
        ].filter(Boolean);
        const raw = Buffer.from(lines.join('\r\n')).toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const r = await authedFetch('gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (!r.ok) throw new Error(`Gmail send failed: HTTP ${r.status}`);
        const j = (await r.json()) as { id?: string };
        return `Sent email ${j.id ?? ''} to ${to}`;
      },
    ),
  ];
}

// Calendar ---------------------------------------------------------

function calendarTools(): ToolHandler[] {
  return [
    wrap(
      {
        name: 'calendar.list',
        description: 'List events from the user\'s primary calendar in a time window.',
        category: 'connector',
        risk: 'safe',
        inputSchema: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'RFC3339 start; defaults to now.' },
            timeMax: { type: 'string', description: 'RFC3339 end; defaults to +7 days.' },
            max: { type: 'number' },
          },
        },
      },
      async (args) => {
        const now = new Date();
        const weekLater = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
        const timeMin = typeof args.timeMin === 'string' ? args.timeMin : now.toISOString();
        const timeMax = typeof args.timeMax === 'string' ? args.timeMax : weekLater.toISOString();
        const max = Math.min(asNumber(args.max, 20), 100);
        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${max}`;
        const r = await authedFetch('calendar', url);
        if (!r.ok) throw new Error(`Calendar list failed: HTTP ${r.status}`);
        const j = (await r.json()) as {
          items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; id?: string }[];
        };
        const events = j.items ?? [];
        if (events.length === 0) return '(no events in window)';
        return events
          .map((e) => {
            const start = e.start?.dateTime ?? e.start?.date ?? '';
            const end = e.end?.dateTime ?? e.end?.date ?? '';
            return `${start} → ${end} · ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''} (id=${e.id})`;
          })
          .join('\n');
      },
    ),
    wrap(
      {
        name: 'calendar.create',
        description: 'Create a new event on the user\'s primary calendar.',
        category: 'connector',
        risk: 'high',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            start: { type: 'string', description: 'RFC3339 dateTime.' },
            end: { type: 'string', description: 'RFC3339 dateTime.' },
            description: { type: 'string' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Emails.' },
          },
          required: ['summary', 'start', 'end'],
        },
      },
      async (args) => {
        const summary = asString(args.summary, 'summary');
        const start = asString(args.start, 'start');
        const end = asString(args.end, 'end');
        const description = typeof args.description === 'string' ? args.description : undefined;
        const attendees = Array.isArray(args.attendees)
          ? args.attendees.filter((x): x is string => typeof x === 'string').map((email) => ({ email }))
          : [];
        const r = await authedFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary,
            description,
            start: { dateTime: start },
            end: { dateTime: end },
            attendees: attendees.length > 0 ? attendees : undefined,
          }),
        });
        if (!r.ok) throw new Error(`Calendar create failed: HTTP ${r.status}`);
        const j = (await r.json()) as { id?: string; htmlLink?: string };
        return `Created ${j.id ?? ''} — ${j.htmlLink ?? ''}`;
      },
    ),
  ];
}

// Drive ------------------------------------------------------------

function driveTools(): ToolHandler[] {
  return [
    wrap(
      {
        name: 'drive.search',
        description: 'Search the user\'s Google Drive files by name or content.',
        category: 'connector',
        risk: 'safe',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            max: { type: 'number' },
          },
          required: ['q'],
        },
      },
      async (args) => {
        const q = asString(args.q, 'q');
        const max = Math.min(asNumber(args.max, 10), 50);
        const r = await authedFetch(
          'drive',
          `https://www.googleapis.com/drive/v3/files?pageSize=${max}&q=${encodeURIComponent(`fullText contains '${q.replace(/'/g, "\\'")}' or name contains '${q.replace(/'/g, "\\'")}'`)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`,
        );
        if (!r.ok) throw new Error(`Drive search failed: HTTP ${r.status}`);
        const j = (await r.json()) as {
          files?: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }[];
        };
        if (!j.files || j.files.length === 0) return '(no files)';
        return j.files
          .map((f) => `${f.modifiedTime} | ${f.mimeType}\n${f.name}\n${f.webViewLink} (id=${f.id})`)
          .join('\n\n');
      },
    ),
    wrap(
      {
        name: 'drive.read',
        description: 'Fetch the text content of a Google Doc / Sheet / plain file by id.',
        category: 'connector',
        risk: 'low',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      async (args) => {
        const id = asString(args.id, 'id');
        // First get metadata to decide if this needs export (Google-native) or direct download.
        const metaR = await authedFetch(
          'drive',
          `https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType,name`,
        );
        if (!metaR.ok) throw new Error(`Drive read metadata failed: HTTP ${metaR.status}`);
        const meta = (await metaR.json()) as { mimeType: string; name: string };
        const isGoogle = meta.mimeType.startsWith('application/vnd.google-apps.');
        const url = isGoogle
          ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`
          : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
        const r = await authedFetch('drive', url);
        if (!r.ok) throw new Error(`Drive read failed: HTTP ${r.status}`);
        const text = await r.text();
        return text.length > 20000 ? text.slice(0, 20000) + '\n…[truncated]' : text;
      },
    ),
  ];
}

// GitHub -----------------------------------------------------------

function githubTools(): ToolHandler[] {
  const base = 'https://api.github.com';
  const ghHeaders = (tok: string) => ({
    Authorization: `token ${tok}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  async function gh(url: string, init: RequestInit = {}): Promise<Response> {
    const tok = db.getConnectorToken('github');
    if (!tok) throw new Error('GitHub is not connected');
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(ghHeaders(tok.accessToken))) headers.set(k, v);
    return fetch(url, { ...init, headers });
  }
  return [
    wrap(
      {
        name: 'github.searchRepos',
        description: 'Search GitHub repositories.',
        category: 'connector',
        risk: 'safe',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' }, max: { type: 'number' } },
          required: ['q'],
        },
      },
      async (args) => {
        const q = asString(args.q, 'q');
        const max = Math.min(asNumber(args.max, 10), 30);
        const r = await gh(`${base}/search/repositories?q=${encodeURIComponent(q)}&per_page=${max}`);
        if (!r.ok) throw new Error(`GitHub search failed: HTTP ${r.status}`);
        const j = (await r.json()) as { items?: { full_name: string; description?: string; stargazers_count: number; html_url: string }[] };
        return (j.items ?? [])
          .map((it) => `${it.full_name} ★${it.stargazers_count}\n${it.description ?? ''}\n${it.html_url}`)
          .join('\n\n');
      },
    ),
    wrap(
      {
        name: 'github.listIssues',
        description: 'List issues on a repository.',
        category: 'connector',
        risk: 'safe',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed', 'all'] },
            max: { type: 'number' },
          },
          required: ['owner', 'repo'],
        },
      },
      async (args) => {
        const owner = asString(args.owner, 'owner');
        const repo = asString(args.repo, 'repo');
        const state = typeof args.state === 'string' ? args.state : 'open';
        const max = Math.min(asNumber(args.max, 20), 100);
        const r = await gh(`${base}/repos/${owner}/${repo}/issues?state=${state}&per_page=${max}`);
        if (!r.ok) throw new Error(`GitHub issues failed: HTTP ${r.status}`);
        const j = (await r.json()) as { number: number; title: string; html_url: string; state: string; user?: { login: string } }[];
        if (j.length === 0) return '(no issues)';
        return j.map((i) => `#${i.number} [${i.state}] ${i.title} — @${i.user?.login ?? '?'} — ${i.html_url}`).join('\n');
      },
    ),
    wrap(
      {
        name: 'github.createIssue',
        description: 'Open a new issue on a repository.',
        category: 'connector',
        risk: 'high',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
          },
          required: ['owner', 'repo', 'title'],
        },
      },
      async (args) => {
        const owner = asString(args.owner, 'owner');
        const repo = asString(args.repo, 'repo');
        const title = asString(args.title, 'title');
        const body = typeof args.body === 'string' ? args.body : '';
        const labels = Array.isArray(args.labels)
          ? args.labels.filter((x): x is string => typeof x === 'string')
          : undefined;
        const r = await gh(`${base}/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, labels }),
        });
        if (!r.ok) throw new Error(`GitHub issue create failed: HTTP ${r.status}`);
        const j = (await r.json()) as { number?: number; html_url?: string };
        return `Opened #${j.number ?? '?'} — ${j.html_url ?? ''}`;
      },
    ),
  ];
}

// Slack ------------------------------------------------------------

function slackTools(): ToolHandler[] {
  async function slack(method: string, init: RequestInit = {}): Promise<Response> {
    const tok = db.getConnectorToken('slack');
    if (!tok) throw new Error('Slack is not connected');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${tok.accessToken}`);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
    return fetch(`https://slack.com/api/${method}`, { ...init, headers });
  }
  return [
    wrap(
      {
        name: 'slack.listChannels',
        description: 'List Slack channels the user is a member of.',
        category: 'connector',
        risk: 'safe',
        inputSchema: { type: 'object', properties: { max: { type: 'number' } } },
      },
      async (args) => {
        const max = Math.min(asNumber(args.max, 50), 200);
        const r = await slack(`conversations.list?limit=${max}&types=public_channel,private_channel`);
        const j = (await r.json()) as { ok: boolean; channels?: { id: string; name: string; is_member?: boolean }[]; error?: string };
        if (!j.ok) throw new Error(`Slack list failed: ${j.error}`);
        return (j.channels ?? [])
          .filter((c) => c.is_member)
          .map((c) => `#${c.name} (id=${c.id})`)
          .join('\n') || '(no channels)';
      },
    ),
    wrap(
      {
        name: 'slack.postMessage',
        description: 'Post a message to a Slack channel as the user.',
        category: 'connector',
        risk: 'high',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id or name (e.g. C12345 or #general).' },
            text: { type: 'string' },
          },
          required: ['channel', 'text'],
        },
      },
      async (args) => {
        const channel = asString(args.channel, 'channel');
        const text = asString(args.text, 'text');
        const r = await slack('chat.postMessage', {
          method: 'POST',
          body: JSON.stringify({ channel, text }),
        });
        const j = (await r.json()) as { ok: boolean; ts?: string; error?: string };
        if (!j.ok) throw new Error(`Slack post failed: ${j.error}`);
        return `Posted to ${channel} (ts=${j.ts})`;
      },
    ),
  ];
}

// ─── public tool listing ──────────────────────────────────────────

export function connectorTools(): ToolHandler[] {
  const out: ToolHandler[] = [];
  for (const id of ['gmail', 'calendar', 'drive', 'github', 'slack'] as ConnectorId[]) {
    if (!db.getConnectorToken(id)) continue;
    if (id === 'gmail') out.push(...gmailTools());
    else if (id === 'calendar') out.push(...calendarTools());
    else if (id === 'drive') out.push(...driveTools());
    else if (id === 'github') out.push(...githubTools());
    else if (id === 'slack') out.push(...slackTools());
  }
  return out;
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:connectors-list', () => {
  return DESCRIPTORS.map((d) => ({
    descriptor: d,
    config: getCfg(d.id),
    status: status(d.id),
  }));
});

ipcMain.handle('paia:connectors-save-configs', (_e, list: ConnectorConfig[]) => {
  saveConfigs(list);
  return loadConfigs();
});

ipcMain.handle('paia:connectors-connect', async (_e, id: ConnectorId) => {
  try {
    return { ok: true, status: await connect(id) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('paia:connectors-disconnect', (_e, id: ConnectorId) => disconnect(id));
