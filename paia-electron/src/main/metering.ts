// Per-feature metering for the free tier.
//
// A small bookkeeping service that:
//   1. Records an incrementing counter per meter kind.
//   2. Separates "per-day" meters (agent runs, research runs) from
//      "lifetime" meters (RAG documents, memory entries).
//   3. Exposes a `checkCap()` that throws a tier-flavoured error when
//      a free-tier user is over a cap. Pro / Team / trial users bypass
//      all caps.
//
// Storage is a single JSON file in userData. Day buckets are keyed by
// YYYY-MM-DD in local time — deliberately local, not UTC, so "your
// daily allowance resets at midnight" matches what users expect.

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { status as licenseStatus } from './license';

export type MeterKind =
  | 'agent-run'
  | 'research-run'
  | 'media-generate'
  | 'autopilot-fire'
  | 'rag-document'
  | 'memory-entry';

/**
 * Free-tier caps per meter. A cap of 0 means "not capped on free".
 * `perDay: true` uses a day bucket; `perDay: false` is a lifetime cap.
 */
export const FREE_CAPS: Record<MeterKind, { limit: number; perDay: boolean; label: string }> = {
  'agent-run':       { limit: 5,   perDay: true,  label: 'agent runs per day' },
  'research-run':    { limit: 2,   perDay: true,  label: 'deep research runs per day' },
  'media-generate':  { limit: 3,   perDay: true,  label: 'image generations per day' },
  'autopilot-fire':  { limit: 10,  perDay: true,  label: 'autopilot fires per day' },
  'rag-document':    { limit: 3,   perDay: false, label: 'RAG documents total' },
  'memory-entry':    { limit: 200, perDay: false, label: 'memory entries total' },
};

interface Bucket {
  dayCounts: Record<string, number>; // "2026-04-19" → 7
  lifetime: number;
}

type State = Partial<Record<MeterKind, Bucket>>;

function storePath(): string {
  return path.join(app.getPath('userData'), 'metering.json');
}

function loadState(): State {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf-8')) as State; }
  catch { return {}; }
}

function saveState(s: State): void {
  fs.writeFileSync(storePath(), JSON.stringify(s));
}

function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucket(s: State, kind: MeterKind): Bucket {
  if (!s[kind]) s[kind] = { dayCounts: {}, lifetime: 0 };
  return s[kind]!;
}

function isCapped(): boolean {
  // Only free tier gets metered. Trial and paid licenses bypass.
  return licenseStatus().effectiveTier === 'free';
}

export function recordUse(kind: MeterKind): void {
  const s = loadState();
  const b = bucket(s, kind);
  const day = todayKey();
  b.dayCounts[day] = (b.dayCounts[day] ?? 0) + 1;
  b.lifetime++;
  // Garbage-collect day buckets older than 90 days so the file stays small.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffKey = todayKey(cutoff);
  for (const k of Object.keys(b.dayCounts)) {
    if (k < cutoffKey) delete b.dayCounts[k];
  }
  saveState(s);
}

export function countToday(kind: MeterKind): number {
  return bucket(loadState(), kind).dayCounts[todayKey()] ?? 0;
}

export function countLifetime(kind: MeterKind): number {
  return bucket(loadState(), kind).lifetime;
}

export interface MeterSnapshot {
  kind: MeterKind;
  label: string;
  perDay: boolean;
  limit: number;
  used: number;
  capped: boolean;
}

export function snapshots(): MeterSnapshot[] {
  const capped = isCapped();
  return (Object.keys(FREE_CAPS) as MeterKind[]).map((kind) => {
    const cfg = FREE_CAPS[kind];
    const used = cfg.perDay ? countToday(kind) : countLifetime(kind);
    return {
      kind,
      label: cfg.label,
      perDay: cfg.perDay,
      limit: cfg.limit,
      used,
      capped: capped && cfg.limit > 0,
    };
  });
}

/**
 * Throws when a free-tier user would exceed the meter's cap. Records
 * the use when allowed. Call BEFORE doing the work so the meter and
 * the side-effect stay consistent.
 */
export function checkAndRecord(kind: MeterKind): void {
  if (!isCapped()) return;
  const cfg = FREE_CAPS[kind];
  if (cfg.limit <= 0) return;
  const used = cfg.perDay ? countToday(kind) : countLifetime(kind);
  if (used >= cfg.limit) {
    // Stable error phrase so UpgradePrompt.detectUpgradeError() picks it up.
    const horizon = cfg.perDay ? 'today' : 'on the free tier';
    throw new Error(
      `Feature "${kind}" requires PAiA Pro. You've used ${used}/${cfg.limit} ${cfg.label} ${horizon}. ` +
      `Start a trial or activate a license in Settings → License.`,
    );
  }
  recordUse(kind);
}

// ─── IPC ──────────────────────────────────────────────────────────

ipcMain.handle('paia:metering-snapshots', () => snapshots());
