// Smart persona router.
//
// Two-stage routing over every persona in the pool (built-in + user):
//   (1) Semantic pre-filter — embed the query with the same model used
//       for RAG and rank personas by cosine similarity. Keep top 10.
//   (2) LLM rerank — hand the top 10 to a fast local model and ask for
//       the best N (poolSize) as JSON. If the LLM call fails, fall back
//       to the top N from stage 1.
//
// Cache layout (userData/persona-embeddings.json):
//   { version, embeddings: [{ id, textHash, vector }] }
// Personas whose system prompt changes get their hash invalidated and
// are re-embedded on next route() call. Removed personas are pruned.
//
// All routing decisions are appended to userData/router.log as JSONL so
// the user can audit why a query went to a specific persona.

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as personas from './personas';
import * as providers from './providers';
import * as rag from './rag';
import * as settingsStore from './settings';
import { logger } from './logger';
import type { Persona } from '../shared/types';

const EMBED_CACHE_VERSION = 1;
const TOP_K_SEMANTIC = 10;
const DEFAULT_POOL_SIZE = 4;
const MAX_POOL_SIZE = 6;

interface PersonaEmbedding {
  id: string;
  textHash: string;
  vector: number[];
}

interface EmbeddingCache {
  version: number;
  embeddings: PersonaEmbedding[];
}

let cache: EmbeddingCache | null = null;
let routingLog: Array<{ ts: number; query: string; picks: string[]; reason: string; mode: string }> = [];

function cachePath(): string {
  return path.join(app.getPath('userData'), 'persona-embeddings.json');
}

function logPath(): string {
  return path.join(app.getPath('userData'), 'router.log');
}

function loadCache(): EmbeddingCache {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as EmbeddingCache;
    if (parsed.version === EMBED_CACHE_VERSION) {
      cache = parsed;
      return parsed;
    }
  } catch {
    /* fall through to fresh cache */
  }
  cache = { version: EMBED_CACHE_VERSION, embeddings: [] };
  return cache;
}

function saveCache(c: EmbeddingCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(c));
    cache = c;
  } catch (err) {
    logger.warn('router: cache write failed', err);
  }
}

// Stable identity hash for the persona's prompt. FNV-1a — not crypto,
// just deterministic and fast.
function quickHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, an = 0, bn = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
  }
  if (an === 0 || bn === 0) return 0;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

// One-line summary the router sees per persona. The opening boilerplate
// ("You are PAiA as a …") is stripped so the differentiating instruction
// surfaces.
function personaCard(p: Persona): string {
  const sys = p.systemPrompt
    .replace(/^You are PAiA(\s+(in|as)\s+[^.]+\.)?\s*/i, '')
    .split(/(?<=[.!?])\s+/)[0]
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return `${p.id} (${p.name}): ${sys}`;
}

/**
 * Walks every persona, embeds the ones that are missing or whose prompt
 * hash changed. Prunes entries whose persona was deleted.
 */
export async function refreshEmbeddings(): Promise<{ embedded: number; reused: number; failed: number }> {
  const list = personas.listPersonas();
  const existing = new Map(loadCache().embeddings.map((e) => [e.id, e] as const));
  let embedded = 0, reused = 0, failed = 0;
  const next: PersonaEmbedding[] = [];

  for (const p of list) {
    const hash = quickHash(p.systemPrompt);
    const prior = existing.get(p.id);
    if (prior && prior.textHash === hash && prior.vector.length > 0) {
      next.push(prior);
      reused++;
      continue;
    }
    try {
      const vec = await rag.embed(`${p.name}. ${p.systemPrompt}`);
      next.push({ id: p.id, textHash: hash, vector: vec });
      embedded++;
    } catch (err) {
      logger.warn(`router: embed failed for ${p.id}`, err);
      // Keep prior embedding if any so we degrade gracefully.
      if (prior) next.push(prior);
      failed++;
    }
  }
  saveCache({ version: EMBED_CACHE_VERSION, embeddings: next });
  logger.info(`router: embeddings refreshed (embedded=${embedded}, reused=${reused}, failed=${failed})`);
  return { embedded, reused, failed };
}

function isCacheFresh(list: Persona[]): boolean {
  const c = loadCache();
  if (c.embeddings.length !== list.length) return false;
  const byId = new Map(c.embeddings.map((e) => [e.id, e] as const));
  for (const p of list) {
    const entry = byId.get(p.id);
    if (!entry) return false;
    if (entry.textHash !== quickHash(p.systemPrompt)) return false;
    if (entry.vector.length === 0) return false;
  }
  return true;
}

function appendLog(entry: { ts: number; query: string; picks: string[]; reason: string; mode: string }): void {
  routingLog.push(entry);
  if (routingLog.length > 200) routingLog = routingLog.slice(-200);
  try {
    fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n');
  } catch {
    /* non-fatal */
  }
}

export interface RoutingCandidate {
  id: string;
  name: string;
  emoji: string;
  score: number;
}

export interface RoutingDecision {
  personaIds: string[];
  reason: string;
  candidates: RoutingCandidate[];
  mode: 'embedding-only' | 'embedding+llm' | 'no-personas';
}

export async function route(
  query: string,
  opts?: { poolSize?: number; model?: string },
): Promise<RoutingDecision> {
  const poolSize = Math.max(1, Math.min(MAX_POOL_SIZE, opts?.poolSize ?? DEFAULT_POOL_SIZE));
  const list = personas.listPersonas();
  if (list.length === 0) {
    return { personaIds: [], reason: 'No personas available.', candidates: [], mode: 'no-personas' };
  }

  if (!isCacheFresh(list)) {
    await refreshEmbeddings();
  }

  // Stage 1 — semantic pre-filter.
  let candidates: Array<{ persona: Persona; score: number }> = [];
  try {
    const qVec = await rag.embed(query);
    const byId = new Map(loadCache().embeddings.map((e) => [e.id, e.vector] as const));
    candidates = list
      .map((p) => ({ persona: p, score: cosineSim(qVec, byId.get(p.id) ?? []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_SEMANTIC);
  } catch (err) {
    logger.warn('router: semantic pre-filter failed, falling back to all personas as candidates', err);
    candidates = list.slice(0, TOP_K_SEMANTIC).map((p) => ({ persona: p, score: 0 }));
  }

  const candidateDebug: RoutingCandidate[] = candidates.map((c) => ({
    id: c.persona.id,
    name: c.persona.name,
    emoji: c.persona.emoji,
    score: c.score,
  }));

  // Stage 2 — LLM rerank. Skip if no model configured.
  const settings = settingsStore.load();
  const model = opts?.model ?? settings.model;
  if (!model) {
    const picks = candidates.slice(0, poolSize).map((c) => c.persona.id);
    const decision: RoutingDecision = {
      personaIds: picks,
      reason: 'No default model set — used semantic similarity only.',
      candidates: candidateDebug,
      mode: 'embedding-only',
    };
    appendLog({ ts: Date.now(), query, picks, reason: decision.reason, mode: decision.mode });
    return decision;
  }

  const cards = candidates.map((c) => personaCard(c.persona)).join('\n');
  const system = `You route user queries to the most relevant assistant personas.
Given a query and a list of candidate personas, pick up to ${poolSize} that are best suited.
Prefer 1 persona for simple/narrow queries; up to ${poolSize} for cross-domain queries.
Return ONLY a JSON object on a single line: {"personaIds":["id1","id2"],"reason":"one short sentence"}.
Do not include any other text. Do not include markdown fences.`;
  const user = `Candidates:\n${cards}\n\nQuery: ${query}\n\nJSON:`;

  let raw = '';
  try {
    raw = await providers.chat(
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      () => {
        /* discard tokens, we only want the final string */
      },
    );
  } catch (err) {
    logger.warn('router: LLM rerank failed, falling back to semantic top-N', err);
    const picks = candidates.slice(0, poolSize).map((c) => c.persona.id);
    const decision: RoutingDecision = {
      personaIds: picks,
      reason: 'Router model unavailable — used semantic similarity only.',
      candidates: candidateDebug,
      mode: 'embedding-only',
    };
    appendLog({ ts: Date.now(), query, picks, reason: decision.reason, mode: decision.mode });
    return decision;
  }

  const parsed = parseRouterJson(raw);
  if (!parsed) {
    const picks = candidates.slice(0, poolSize).map((c) => c.persona.id);
    const decision: RoutingDecision = {
      personaIds: picks,
      reason: 'Router output was not valid JSON — used semantic similarity only.',
      candidates: candidateDebug,
      mode: 'embedding-only',
    };
    appendLog({ ts: Date.now(), query, picks, reason: decision.reason, mode: decision.mode });
    return decision;
  }

  // Filter to known persona IDs only (small models hallucinate IDs).
  const validIds = new Set(list.map((p) => p.id));
  const picks = parsed.personaIds.filter((id) => validIds.has(id)).slice(0, poolSize);
  if (picks.length === 0) {
    const fallback = candidates.slice(0, poolSize).map((c) => c.persona.id);
    const decision: RoutingDecision = {
      personaIds: fallback,
      reason: 'Router returned no valid persona IDs — used semantic similarity only.',
      candidates: candidateDebug,
      mode: 'embedding-only',
    };
    appendLog({ ts: Date.now(), query, picks: fallback, reason: decision.reason, mode: decision.mode });
    return decision;
  }

  const decision: RoutingDecision = {
    personaIds: picks,
    reason: parsed.reason || 'Picked by router.',
    candidates: candidateDebug,
    mode: 'embedding+llm',
  };
  appendLog({ ts: Date.now(), query, picks, reason: decision.reason, mode: decision.mode });
  return decision;
}

function parseRouterJson(raw: string): { personaIds: string[]; reason: string } | null {
  // Small models often wrap JSON in fences or chat about it. Extract the
  // first object that mentions personaIds and try to parse.
  const m = raw.match(/\{[\s\S]*?"personaIds"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { personaIds?: unknown; reason?: unknown };
    if (!Array.isArray(obj.personaIds)) return null;
    const ids = obj.personaIds.filter((x): x is string => typeof x === 'string');
    return { personaIds: ids, reason: typeof obj.reason === 'string' ? obj.reason : '' };
  } catch {
    return null;
  }
}

/** Read-only access for UI to surface recent decisions. */
export function recentDecisions(limit = 50): Array<{ ts: number; query: string; picks: string[]; reason: string; mode: string }> {
  return routingLog.slice(-limit);
}
