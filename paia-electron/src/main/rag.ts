// RAG (retrieval-augmented generation) service.
//
// Pipeline:
//   1. Extract — pull plain text out of an uploaded file (txt/md/json/csv/pdf)
//   2. Chunk   — split into ~800 char windows with 150 char overlap
//   3. Embed   — call Ollama /api/embeddings with `nomic-embed-text` (or
//                whatever the user picked) one chunk at a time
//   4. Persist — store chunks + embeddings in the SQLite db
//
// Search is brute-force cosine similarity in JS — see db.searchChunks().
// For our scale (single-user knowledge base, a few thousand chunks) this
// is fast enough that a vector index extension isn't worth the deps.

import * as fs from 'fs';
import * as path from 'path';
import * as db from './db';
import { requireFeature } from './license';
import { checkAndRecord } from './metering';
import { logger } from './logger';
import { chunkText as sharedChunkText } from '../shared/chunking';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  RagIngestProgress,
} from '../shared/types';

const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const OLLAMA_BASE = 'http://127.0.0.1:11434';

// ─── extraction ────────────────────────────────────────────────────

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const isPdf = mimeType === 'application/pdf' || ext === '.pdf';
  const isText =
    mimeType.startsWith('text/') ||
    ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.yml', '.yaml', '.xml', '.html', '.htm'].includes(ext);

  if (isPdf) return extractPdf(filePath);
  if (isText) return fs.readFileSync(filePath, 'utf-8');

  // Last resort — try utf-8 and hope for the best.
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Unsupported file type for ${path.basename(filePath)}: ${mimeType}`);
  }
}

async function extractPdf(filePath: string): Promise<string> {
  // pdfjs-dist's legacy build is the only one that runs cleanly under Node.
  // We import it dynamically to avoid loading 3 MB at app startup.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    // Disable the optional worker — we're already in a background-y context.
    useWorker: false,
    isEvalSupported: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ');
    pages.push(text);
  }
  return pages.join('\n\n');
}

// ─── chunking ──────────────────────────────────────────────────────

// chunkText is now in shared/ so it can be unit-tested without booting
// Electron. Re-exported here so the rest of rag.ts (and any callers
// outside this file) can keep importing it from `./rag`.
export const chunkText = sharedChunkText;

// ─── embedding via Ollama ──────────────────────────────────────────

export async function embed(text: string, model = DEFAULT_EMBED_MODEL): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings failed: HTTP ${res.status}. Have you pulled the embedding model? Try: ollama pull ${model}`);
  }
  const body = (await res.json()) as { embedding?: number[] };
  if (!body.embedding) throw new Error('Ollama embeddings response missing embedding field');
  return body.embedding;
}

// ─── ingest pipeline ───────────────────────────────────────────────

export interface IngestOptions {
  collectionId: string;
  filePath: string;
  filename: string;
  mimeType: string;
  embeddingModel?: string;
  onProgress?: (p: RagIngestProgress) => void;
}

export async function ingestFile(opts: IngestOptions): Promise<KnowledgeDocument> {
  requireFeature('rag');
  checkAndRecord('rag-document');
  const { collectionId, filePath, filename, mimeType, onProgress } = opts;
  const model = opts.embeddingModel ?? DEFAULT_EMBED_MODEL;
  const stat = fs.statSync(filePath);

  onProgress?.({ stage: 'extract', current: 0, total: 1, message: `Reading ${filename}…` });
  const text = await extractText(filePath, mimeType);

  onProgress?.({ stage: 'chunk', current: 0, total: 1, message: 'Chunking…' });
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`No text extracted from ${filename}`);
  }

  const doc = db.createDocument(collectionId, filename, mimeType, stat.size);

  // Embed chunks one-by-one. Ollama's embeddings endpoint is single-shot.
  // We could parallelise but Ollama serializes anyway.
  const records: { ordinal: number; text: string; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      stage: 'embed',
      current: i,
      total: chunks.length,
      message: `Embedding ${i + 1}/${chunks.length}`,
    });
    try {
      const v = await embed(chunks[i], model);
      records.push({ ordinal: i, text: chunks[i], embedding: v });
    } catch (err) {
      logger.error('embed failed for chunk', i, err);
      throw err;
    }
  }

  onProgress?.({ stage: 'persist', current: 0, total: 1, message: 'Saving…' });
  db.insertChunks(collectionId, doc.id, records);
  db.touchCollection(collectionId);

  onProgress?.({ stage: 'done', current: chunks.length, total: chunks.length, message: 'Done' });
  return { ...doc, chunkCount: records.length };
}

// ─── query-time helpers ────────────────────────────────────────────

/**
 * Embed a user query and retrieve the top-k chunks across the given
 * collections. Returns the chunks with their similarity scores attached.
 */
export async function retrieve(
  collectionIds: string[],
  query: string,
  topK = 5,
  embeddingModel = DEFAULT_EMBED_MODEL,
): Promise<KnowledgeChunk[]> {
  if (collectionIds.length === 0 || !query.trim()) return [];
  const qEmb = await embed(query, embeddingModel);
  return db.searchChunks(collectionIds, qEmb, topK);
}

/**
 * Format retrieved chunks as a context block to inject into the system
 * prompt. Each chunk gets a [source] marker so the model can cite.
 */
export function formatContext(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return '';
  const blocks = chunks.map((c, i) => {
    const src = c.filename ? c.filename : `chunk ${c.ordinal}`;
    return `[${i + 1}] (source: ${src})\n${c.text}`;
  });
  return [
    '─── Retrieved knowledge ───',
    'The user has attached a knowledge collection. Use the following context where relevant. Cite sources by their bracket number, e.g. [1].',
    '',
    ...blocks,
    '',
    '─── End retrieved knowledge ───',
  ].join('\n');
}
