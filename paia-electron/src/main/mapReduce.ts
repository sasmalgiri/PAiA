// Long-document map-reduce over a parallel pool of LLM workers.
//
// Use case: user attaches a long doc (200-page PDF, big markdown file)
// and asks a question. Normal RAG retrieves a handful of relevant chunks
// — fine for narrow questions, weak for "summarise the whole thing" or
// "list every risk mentioned." Map-reduce processes EVERY chunk in
// parallel waves, filters to chunks that contain question-relevant
// content, then synthesises across them.
//
// Pipeline:
//   chunk(doc) → map(N concurrent, "extract relevant or say NONE")
//             → filter NONE
//             → reduce(synthesise)
//
// Events streamed to the renderer:
//   {kind:'started', totalChunks, parallelism}
//   {kind:'chunk-progress', k, n, hasContent}
//   {kind:'reduce-started', usableChunks}
//   {kind:'reduce-token', token}
//   {kind:'finished', answer, sourceChunkCount}
//   {kind:'error', error}

import { randomUUID } from 'crypto';
import type { BrowserWindow } from 'electron';
import * as providers from './providers';
import * as db from './db';
import * as personas from './personas';
import { chunkText } from '../shared/chunking';
import { logger } from './logger';
import type { ChatMessage } from '../shared/types';

const MAP_CHUNK_SIZE = 4000;       // characters per map chunk
const MAP_CHUNK_OVERLAP = 200;
const NONE_MARKER = 'NONE';
const MAX_REDUCE_BATCH_SIZE = 6;   // partials per reduce call (hierarchical)

const MAP_SYSTEM = `You extract content from a single chunk of a longer document.
The user has a question about the whole document. You only see one chunk.

If the chunk contains content relevant to the question, return the relevant
information in compact paragraphs — quote sparingly, summarise faithfully.
If the chunk has NOTHING relevant, return exactly the single word: ${NONE_MARKER}

Do not speculate beyond what's in the chunk. Do not add framing like
"This chunk discusses…" — just the extracted content.`;

const REDUCE_SYSTEM = `You merge partial answers from across a long document.
The user asked one question. You're given N partial answers, each extracted
from a different chunk of the document.

Synthesise these into a single coherent reply that:
  1. Leads with the answer the user wants.
  2. Combines information from across partials, removing duplicates.
  3. Flags contradictions if any partials disagree.
  4. Preserves the source ordering when listing items (e.g. "Section 3 finds…")
     if the partials are presented in document order.

Be concise. No "Synthesis" header. Plain prose / bullets.`;

const REDUCE_HIERARCHY_SYSTEM = `You merge partial answers from across a long document.
You're given a batch of N partial answers (each is itself already a partial
synthesis from a sub-section of the document). Merge them into ONE consolidated
partial that captures everything relevant to the user's question, without losing
detail. Don't add a header.`;

export interface MapReduceEvent {
  runId: string;
  threadId: string;
  kind:
    | 'started'
    | 'chunk-progress'
    | 'reduce-started'
    | 'reduce-token'
    | 'finished'
    | 'error';
  totalChunks?: number;
  parallelism?: number;
  k?: number;
  n?: number;
  hasContent?: boolean;
  usableChunks?: number;
  sourceChunkCount?: number;
  token?: string;
  answer?: string;
  error?: string;
}

interface RunOptions {
  threadId: string;
  question: string;
  documentText: string;
  documentLabel: string;
  model: string;
  parallelism?: number;
  personaId?: string;
  win: BrowserWindow;
}

const activeRuns = new Map<string, AbortController>();

function emit(win: BrowserWindow, ev: MapReduceEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('paia:map-reduce-event', ev);
  }
}

/** Run N tasks at a time. Order of inputs is preserved on output. */
async function runPool<T, U>(items: T[], parallelism: number, task: (item: T, idx: number) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array<U>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await task(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, parallelism) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function reduceBatch(model: string, question: string, partials: string[], system: string): Promise<string> {
  const user = [
    `User question: ${question}`,
    '',
    'Partial answers:',
    ...partials.map((p, i) => `--- Partial ${i + 1} ---\n${p}`),
    '',
    'Merged answer:',
  ].join('\n');
  return providers.chat(
    model,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    () => {
      /* discard intermediate tokens for hierarchical reduce */
    },
  );
}

export async function runMapReduce(opts: RunOptions): Promise<string> {
  const { threadId, question, documentText, documentLabel, model, win } = opts;
  const parallelism = Math.max(1, Math.min(8, opts.parallelism ?? 4));
  const runId = randomUUID();
  const abort = new AbortController();
  activeRuns.set(runId, abort);

  try {
    const chunks = chunkText(documentText, MAP_CHUNK_SIZE, MAP_CHUNK_OVERLAP);
    if (chunks.length === 0) {
      emit(win, { runId, threadId, kind: 'error', error: 'Document text is empty.' });
      return runId;
    }
    emit(win, { runId, threadId, kind: 'started', totalChunks: chunks.length, parallelism });

    // Optional persona lens: prefixed to MAP_SYSTEM so each chunk is read
    // through that domain's eyes.
    let mapSystem = MAP_SYSTEM;
    if (opts.personaId) {
      const p = personas.getPersona(opts.personaId);
      if (p) {
        mapSystem = `${p.systemPrompt}\n\n${MAP_SYSTEM}`;
      }
    }

    // Phase 1: map.
    const partials = await runPool(chunks, parallelism, async (chunk, idx) => {
      if (abort.signal.aborted) return NONE_MARKER;
      const messages: ChatMessage[] = [
        { role: 'system', content: mapSystem },
        { role: 'user', content: `Question: ${question}\n\nChunk ${idx + 1} of ${chunks.length}:\n${chunk}` },
      ];
      try {
        const out = await providers.chat(model, messages, () => { /* discard */ });
        const trimmed = out.trim();
        const hasContent = trimmed.length > 0 && trimmed.toUpperCase() !== NONE_MARKER;
        emit(win, { runId, threadId, kind: 'chunk-progress', k: idx + 1, n: chunks.length, hasContent });
        return hasContent ? trimmed : NONE_MARKER;
      } catch (err) {
        logger.warn(`map-reduce: chunk ${idx + 1} failed`, err);
        emit(win, { runId, threadId, kind: 'chunk-progress', k: idx + 1, n: chunks.length, hasContent: false });
        return NONE_MARKER;
      }
    });

    if (abort.signal.aborted) {
      emit(win, { runId, threadId, kind: 'error', error: 'Aborted.' });
      return runId;
    }

    const usable = partials.filter((p) => p !== NONE_MARKER);
    emit(win, { runId, threadId, kind: 'reduce-started', usableChunks: usable.length });

    if (usable.length === 0) {
      const noContent = `No chunks of "${documentLabel}" contained information relevant to: ${question}`;
      emit(win, { runId, threadId, kind: 'finished', answer: noContent, sourceChunkCount: 0 });
      return runId;
    }

    // Phase 2: reduce. Hierarchical if > MAX_REDUCE_BATCH_SIZE.
    let working = usable;
    while (working.length > MAX_REDUCE_BATCH_SIZE) {
      const next: string[] = [];
      for (let i = 0; i < working.length; i += MAX_REDUCE_BATCH_SIZE) {
        const batch = working.slice(i, i + MAX_REDUCE_BATCH_SIZE);
        const merged = await reduceBatch(model, question, batch, REDUCE_HIERARCHY_SYSTEM);
        next.push(merged);
        if (abort.signal.aborted) {
          emit(win, { runId, threadId, kind: 'error', error: 'Aborted during reduce.' });
          return runId;
        }
      }
      working = next;
    }

    // Final reduce — stream tokens.
    const finalUser = [
      `User question: ${question}`,
      '',
      'Partial answers:',
      ...working.map((p, i) => `--- Partial ${i + 1} ---\n${p}`),
      '',
      'Final answer:',
    ].join('\n');
    let answer = '';
    try {
      answer = await providers.chat(
        model,
        [
          { role: 'system', content: REDUCE_SYSTEM },
          { role: 'user', content: finalUser },
        ],
        (token) => {
          if (abort.signal.aborted) return;
          answer += token;
          emit(win, { runId, threadId, kind: 'reduce-token', token });
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(win, { runId, threadId, kind: 'error', error: `Reduce failed: ${msg}` });
      return runId;
    }

    emit(win, { runId, threadId, kind: 'finished', answer, sourceChunkCount: usable.length });

    // Persist.
    try {
      const payload = JSON.stringify({
        question,
        documentLabel,
        totalChunks: chunks.length,
        sourceChunkCount: usable.length,
        parallelism,
      });
      db.addMessage(threadId, 'assistant', answer, 0, [
        {
          kind: 'map-reduce-payload',
          mimeType: 'application/json',
          filename: 'map-reduce.json',
          sizeBytes: payload.length,
          content: payload,
        },
      ]);
    } catch (err) {
      logger.warn('map-reduce: persist failed', err);
    }

    return runId;
  } finally {
    activeRuns.delete(runId);
  }
}

export function abortMapReduce(runId: string): boolean {
  const ctrl = activeRuns.get(runId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}
