// Cross-session memory.
//
// Unlike the chat history (which is scoped to a thread), memory entries
// persist across every conversation. They come in four flavours:
//
//   user        — stable facts about the user ("prefers TypeScript, works
//                  in UTC-8, dislikes Comic Sans").
//   preference  — explicit corrections the user has given ("always respond
//                  in the imperative", "don't mock DBs in tests").
//   fact        — durable information the agent extracted or was told
//                  ("API base URL is http://internal.example.com").
//   episode     — summaries of past interactions the agent deems worth
//                  recalling later ("on 2026-04-14 we debugged the OAuth
//                  redirect bug by setting X").
//
// Episodes are embedded with Ollama so recall() does semantic search.
// User/preference/fact entries are short enough that a text LIKE scan is
// fine, but we still embed them lazily so they participate in the same
// vector search when available.

import * as db from './db';
import { embed } from './rag';
import { logger } from './logger';
import * as settingsStore from './settings';
import { checkAndRecord } from './metering';
import type { MemoryEntry, MemoryScope } from '../shared/types';

const EMBED_MODEL = 'nomic-embed-text';

/**
 * Save a new memory entry. If Ollama's embedding model is available, we
 * attach an embedding so recall() can find it semantically; if not, the
 * entry still persists and falls back to substring search.
 */
export async function remember(
  scope: MemoryScope,
  text: string,
  tags: string[] = [],
  pinned: boolean = false,
): Promise<MemoryEntry> {
  if (!settingsStore.load().memoryEnabled) {
    throw new Error('Memory is disabled in Settings → Memory.');
  }
  checkAndRecord('memory-entry');
  let embedding: number[] | undefined;
  try {
    embedding = await embed(text.slice(0, 1500), EMBED_MODEL);
  } catch (err) {
    logger.warn('memory.remember: embed failed, persisting without vector', err);
  }
  return db.addMemoryEntry(scope, text, tags, pinned, embedding);
}

/**
 * Retrieve memories relevant to a query. Tries vector similarity first,
 * then falls back to a substring search ranked by recency.
 */
export async function recall(
  query: string,
  topK: number = 5,
  scope?: MemoryScope,
): Promise<MemoryEntry[]> {
  if (!settingsStore.load().memoryEnabled) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const qEmb = await embed(trimmed, EMBED_MODEL);
    const results = db.searchMemoryByEmbedding(qEmb, topK * 2);
    const filtered = scope ? results.filter((m) => m.scope === scope) : results;
    const pinnedFirst = filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
    if (pinnedFirst.length > 0) return pinnedFirst.slice(0, topK);
  } catch (err) {
    logger.warn('memory.recall: vector search failed, falling back to LIKE', err);
  }

  // Fallback: substring + recency.
  const all = db.listMemory(scope, 500);
  const q = trimmed.toLowerCase();
  const hits = all.filter((m) => m.text.toLowerCase().includes(q));
  const pinnedFirst = [...hits].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return pinnedFirst.slice(0, topK);
}

/**
 * Build a context block to inject into the system prompt. Used by the
 * chat pipeline to surface always-relevant memories (pinned + recent
 * preferences/user) and whatever semantically matches the current user
 * message.
 */
export async function buildContextBlock(userText: string): Promise<string> {
  if (!settingsStore.load().memoryEnabled) return '';
  const pinned = db.listMemory(undefined, 50).filter((m) => m.pinned);
  const preferences = db.listMemory('preference', 10);
  const userFacts = db.listMemory('user', 10);
  const relevant = await recall(userText, 5);

  const mergedById = new Map<string, MemoryEntry>();
  for (const m of [...pinned, ...preferences, ...userFacts, ...relevant]) {
    mergedById.set(m.id, m);
  }
  if (mergedById.size === 0) return '';

  const blocks = Array.from(mergedById.values()).map((m) => `- (${m.scope}) ${m.text}`);
  return [
    '─── Long-term memory ───',
    'The following entries are what PAiA has learned about the user across prior sessions. Treat them as authoritative preferences / facts, but verify before acting on anything surprising.',
    ...blocks,
    '─── End long-term memory ───',
  ].join('\n');
}

export function listAll(scope?: MemoryScope): MemoryEntry[] {
  return db.listMemory(scope, 500);
}

export function forget(id: string): void {
  db.deleteMemory(id);
}
