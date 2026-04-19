// Closed-beta scaffolding.
//
// Two pieces:
//
//   1. Signed invite codes (Ed25519). Anyone can paste a base64 blob;
//      we verify it with the embedded PAIA_PUBLIC_KEY (shared with the
//      license system) and store the decoded payload in userData.
//      Once stored, the `beta` feature flag unlocks.
//
//   2. Feedback submission. The user taps the feedback icon, writes a
//      message, and either it posts to a configured endpoint OR it
//      queues locally. Queued messages retry on the next app start.
//
// No server ships with PAiA — the build owner runs whatever feedback
// collector they like (Linear webhook, Discord webhook, custom API) and
// sets its URL in Settings → Beta.

import { app, ipcMain } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  BetaInvitePayload,
  BetaState,
  FeedbackSubmission,
  SignedBetaInvite,
} from '../shared/types';
import { publicKeyFromB64 } from '../shared/licenseVerify';
import { logger } from './logger';

const PAIA_PUBLIC_KEY_B64 = process.env.PAIA_PUBLIC_KEY ?? '';

function invitePath(): string {
  return path.join(app.getPath('userData'), 'beta-invite.json');
}

function feedbackQueuePath(): string {
  return path.join(app.getPath('userData'), 'beta-feedback-queue.json');
}

function feedbackConfigPath(): string {
  return path.join(app.getPath('userData'), 'beta-feedback-config.json');
}

// ─── invite load / save ──────────────────────────────────────────

function loadStoredInvite(): SignedBetaInvite | null {
  try {
    const raw = fs.readFileSync(invitePath(), 'utf-8');
    return JSON.parse(raw) as SignedBetaInvite;
  } catch { return null; }
}

function saveStoredInvite(inv: SignedBetaInvite): void {
  fs.writeFileSync(invitePath(), JSON.stringify(inv, null, 2));
}

function clearStoredInvite(): void {
  try { fs.unlinkSync(invitePath()); } catch { /* ignore */ }
}

// ─── verify ──────────────────────────────────────────────────────

function verifyInviteSignature(inv: SignedBetaInvite): { ok: boolean; reason?: string } {
  if (!PAIA_PUBLIC_KEY_B64) return { ok: false, reason: 'PAIA_PUBLIC_KEY not set in this build — invites cannot be verified.' };
  const pub = publicKeyFromB64(PAIA_PUBLIC_KEY_B64);
  if (!pub) return { ok: false, reason: 'PAIA_PUBLIC_KEY could not be parsed.' };
  try {
    if (inv.payload.kind !== 'beta-invite') return { ok: false, reason: 'Payload is not a beta-invite.' };
    if (inv.payload.expiresAt !== null && inv.payload.expiresAt < Date.now()) {
      return { ok: false, reason: 'Invite has expired.' };
    }
    if (typeof inv.signatureBase64 !== 'string') return { ok: false, reason: 'Invalid signature.' };
    const sig = Buffer.from(inv.signatureBase64, 'base64');
    // Ed25519 signatures are always 64 bytes. Reject mangled input early.
    if (sig.length !== 64) return { ok: false, reason: 'Invalid signature length.' };
    const msg = Buffer.from(JSON.stringify(inv.payload));
    const valid = crypto.verify(null, msg, pub, sig);
    return valid ? { ok: true } : { ok: false, reason: 'Invalid signature.' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function state(): BetaState {
  const stored = loadStoredInvite();
  if (!stored) return { enabled: false };
  const verdict = verifyInviteSignature(stored);
  if (!verdict.ok) return { enabled: false, reason: verdict.reason };
  return {
    enabled: true,
    invite: stored.payload,
    enabledAt: stored.payload.issuedAt,
  };
}

export function activateInvite(raw: string): BetaState {
  // Accept either raw JSON or base64-encoded JSON.
  let parsed: SignedBetaInvite | null = null;
  try {
    parsed = JSON.parse(raw) as SignedBetaInvite;
  } catch {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      parsed = JSON.parse(decoded) as SignedBetaInvite;
    } catch { /* handled below */ }
  }
  if (!parsed) return { enabled: false, reason: 'Could not parse the invite. Paste the full JSON or base64 blob.' };
  const verdict = verifyInviteSignature(parsed);
  if (!verdict.ok) return { enabled: false, reason: verdict.reason };
  saveStoredInvite(parsed);
  return state();
}

export function revokeInvite(): BetaState {
  clearStoredInvite();
  return state();
}

// ─── feedback config + queue ─────────────────────────────────────

interface FeedbackConfig { endpoint?: string; headers?: Record<string, string>; }

// A malicious renderer (XSS via a chat attachment, compromised plugin,
// etc.) could otherwise persist a config whose `headers` override
// `Authorization` on every subsequent feedback POST — leaking credentials
// to an attacker-controlled endpoint. Strip to a narrow whitelist of
// custom `X-*` headers that users legitimately need for their collectors.
const ALLOWED_FEEDBACK_HEADER = /^x-[a-z0-9-]+$/i;

function sanitizeConfig(cfg: FeedbackConfig): FeedbackConfig {
  const out: FeedbackConfig = {};
  if (typeof cfg.endpoint === 'string' && /^https?:\/\//i.test(cfg.endpoint)) {
    out.endpoint = cfg.endpoint;
  }
  if (cfg.headers && typeof cfg.headers === 'object') {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.headers)) {
      if (typeof v !== 'string') continue;
      if (!ALLOWED_FEEDBACK_HEADER.test(k)) continue;
      if (v.length > 512) continue;
      clean[k] = v;
    }
    out.headers = clean;
  }
  return out;
}

function loadFeedbackConfig(): FeedbackConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(feedbackConfigPath(), 'utf-8')) as FeedbackConfig;
    return sanitizeConfig(raw);
  } catch { return {}; }
}

function saveFeedbackConfig(cfg: FeedbackConfig): void {
  const safe = sanitizeConfig(cfg);
  fs.writeFileSync(feedbackConfigPath(), JSON.stringify(safe, null, 2));
}

function loadQueue(): FeedbackSubmission[] {
  try { return JSON.parse(fs.readFileSync(feedbackQueuePath(), 'utf-8')) as FeedbackSubmission[]; }
  catch { return []; }
}

function saveQueue(q: FeedbackSubmission[]): void {
  fs.writeFileSync(feedbackQueuePath(), JSON.stringify(q, null, 2));
}

export async function submitFeedback(p: { body: string; email?: string; rating?: number }): Promise<FeedbackSubmission> {
  const entry: FeedbackSubmission = {
    id: crypto.randomUUID(),
    at: Date.now(),
    body: p.body,
    email: p.email,
    rating: p.rating,
    sent: false,
  };
  const cfg = loadFeedbackConfig();
  const endpoint = cfg.endpoint;
  if (endpoint) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) },
        body: JSON.stringify({
          product: 'paia',
          version: app.getVersion(),
          invite: state().invite?.email,
          ...entry,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      entry.sent = res.ok;
      entry.endpoint = endpoint;
      if (!res.ok) logger.warn(`feedback submit failed: HTTP ${res.status}`);
    } catch (err) {
      logger.warn('feedback submit threw', err);
    }
  }
  const q = loadQueue();
  q.unshift(entry);
  saveQueue(q.slice(0, 500));
  return entry;
}

/** On app startup, retry any unsent entries (bounded effort). */
export async function flushQueue(): Promise<void> {
  const cfg = loadFeedbackConfig();
  if (!cfg.endpoint) return;
  const q = loadQueue();
  let changed = false;
  for (const entry of q) {
    if (entry.sent) continue;
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) },
        body: JSON.stringify({ product: 'paia', version: app.getVersion(), ...entry }),
      });
      if (res.ok) { entry.sent = true; entry.endpoint = cfg.endpoint; changed = true; }
    } catch { /* keep in queue */ }
  }
  if (changed) saveQueue(q);
}

export function listFeedback(): FeedbackSubmission[] {
  return loadQueue();
}

export function clearFeedback(): void {
  saveQueue([]);
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:beta-state', () => state());
ipcMain.handle('paia:beta-activate', (_e, raw: string) => activateInvite(raw));
ipcMain.handle('paia:beta-revoke', () => revokeInvite());

ipcMain.handle('paia:feedback-config', () => loadFeedbackConfig());
ipcMain.handle('paia:feedback-save-config', (_e, cfg: FeedbackConfig) => { saveFeedbackConfig(cfg); return loadFeedbackConfig(); });
ipcMain.handle('paia:feedback-submit', (_e, p: { body: string; email?: string; rating?: number }) => submitFeedback(p));
ipcMain.handle('paia:feedback-list', () => listFeedback());
ipcMain.handle('paia:feedback-clear', () => { clearFeedback(); return listFeedback(); });
