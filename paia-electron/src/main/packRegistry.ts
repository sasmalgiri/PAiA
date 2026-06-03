// Pack registry fetcher.
//
// A registry is just a JSON index served from any static host (default:
// GitHub releases — see project-paia-v3-plan). The index lists available
// packs with their download URLs; integrity is enforced by the pack
// signature, not by the host.
//
// Schema (registry index, served as JSON):
//   {
//     "version": 1,
//     "publishedAt": <epoch ms>,
//     "packs": [
//       {
//         "id": "paia-legal",
//         "version": "1.0.0",
//         "name": "PAiA Legal",
//         "description": "...",
//         "author": { "name": "...", "url": "..." },
//         "kind": "vertical",
//         "requiresTier": "legal",
//         "downloadUrl": "https://.../paia-legal-1.0.0.paia-pack",
//         "sizeBytes": 12345678,
//         "iconUrl": "...optional...",
//         "tags": ["legal", "patent", "compliance"]
//       },
//       ...
//     ]
//   }
//
// The downloaded `.paia-pack` then goes through packs.loadFromFile which
// verifies the signature. Even a compromised registry host can't ship a
// malicious pack — they don't have the signing key.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import type { PackKind, PackTier } from '../shared/packFormat';

export const DEFAULT_REGISTRY_URLS = [
  // GitHub release artifact serving the official index. The repo's
  // packs/index.json is published on every pack-release tag push.
  'https://github.com/sasmalgiri/PAiA/releases/latest/download/index.json',
];

export interface RegistryEntry {
  id: string;
  version: string;
  name: string;
  description: string;
  author: { name: string; url?: string };
  kind: PackKind;
  requiresTier?: PackTier;
  downloadUrl: string;
  sizeBytes: number;
  iconUrl?: string;
  tags?: string[];
  publishedAt?: number;
}

interface RegistryIndex {
  version: number;
  publishedAt: number;
  packs: RegistryEntry[];
}

interface CachedIndex {
  url: string;
  fetchedAt: number;
  index: RegistryIndex;
}

const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour — re-fetch if stale
let memoryCache: CachedIndex[] = [];

function isEntry(x: unknown): x is RegistryEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Partial<RegistryEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.version === 'string' &&
    typeof e.name === 'string' &&
    typeof e.description === 'string' &&
    typeof e.downloadUrl === 'string' &&
    typeof e.sizeBytes === 'number' &&
    (e.kind === 'vertical' || e.kind === 'persona-only' || e.kind === 'knowledge-only') &&
    e.author !== undefined && typeof e.author === 'object' &&
    typeof (e.author as { name?: unknown }).name === 'string'
  );
}

function validateIndex(raw: unknown): RegistryIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RegistryIndex>;
  if (typeof r.version !== 'number') return null;
  if (typeof r.publishedAt !== 'number') return null;
  if (!Array.isArray(r.packs)) return null;
  const packs = r.packs.filter(isEntry);
  return { version: r.version, publishedAt: r.publishedAt, packs };
}

export async function fetchIndex(url: string, opts?: { signal?: AbortSignal }): Promise<RegistryIndex> {
  const cached = memoryCache.find((c) => c.url === url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.index;
  }
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Registry ${url} returned HTTP ${res.status}`);
  }
  const raw = await res.json() as unknown;
  const valid = validateIndex(raw);
  if (!valid) {
    throw new Error(`Registry ${url} returned a malformed index`);
  }
  memoryCache = memoryCache.filter((c) => c.url !== url);
  memoryCache.push({ url, fetchedAt: Date.now(), index: valid });
  return valid;
}

/**
 * Fetch every configured registry and merge into a single deduped
 * list, latest version per pack id. Errors per-registry are logged but
 * don't fail the call (degrade to fewer registries rather than zero).
 */
export async function listAvailable(urls: string[] = DEFAULT_REGISTRY_URLS): Promise<RegistryEntry[]> {
  const byId = new Map<string, RegistryEntry>();
  for (const url of urls) {
    try {
      const index = await fetchIndex(url);
      for (const entry of index.packs) {
        const prior = byId.get(entry.id);
        if (!prior || prior.version < entry.version) {
          byId.set(entry.id, entry);
        }
      }
    } catch (err) {
      logger.warn(`packRegistry: fetch failed for ${url}`, err);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Download a pack from a registry entry to a temp file. Returns the
 * temp file path — caller is responsible for cleanup. Verifies size
 * matches the declared sizeBytes within 10% to catch obviously-truncated
 * downloads (signature verification handles the rest).
 */
export async function downloadPack(entry: RegistryEntry, opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(entry.downloadUrl, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Pack download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Sanity check: declared size vs received bytes.
  if (entry.sizeBytes && Math.abs(buf.length - entry.sizeBytes) / entry.sizeBytes > 0.1) {
    throw new Error(
      `Pack download size mismatch (expected ~${entry.sizeBytes}, got ${buf.length}).`,
    );
  }
  const tmp = path.join(os.tmpdir(), `paia-pack-dl-${entry.id}-${Date.now()}.paia-pack`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/** Invalidates the in-memory registry cache. Useful after a successful
 *  install so the next browse refetches. */
export function invalidateCache(): void {
  memoryCache = [];
}
