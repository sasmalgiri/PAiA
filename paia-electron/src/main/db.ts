// SQLite-backed persistence for chat threads, messages, and attachments.
//
// Implementation uses sql.js (SQLite compiled to WebAssembly) so we have
// zero native build dependencies on the user's machine. The database file
// lives at userData/paia.sqlite. We persist on every write — this is fast
// enough for chat-scale workloads (hundreds of writes/sec, kilobyte rows).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { randomUUID } from 'crypto';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  Artifact,
  ArtifactKind,
  DbAttachment,
  DbMessage,
  DbThread,
  KnowledgeChunk,
  KnowledgeCollection,
  KnowledgeDocument,
  MemoryEntry,
  MemoryScope,
  ResearchRun,
  ResearchSource,
  ResearchStage,
  Role,
  ScheduledTask,
} from '../shared/types';
import { logger } from './logger';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

function dbPath(): string {
  return path.join(app.getPath('userData'), 'paia.sqlite');
}

/** Initialise sql.js + open (or create) the on-disk database file. */
export async function initDatabase(): Promise<void> {
  if (db) return;
  // sql.js needs to know where to fetch the wasm file. We bundle it into
  // dist/main/sql-wasm.wasm during the copy step.
  SQL = await initSqlJs({
    locateFile: (file: string) => path.join(__dirname, file),
  });

  const file = dbPath();
  if (fs.existsSync(file)) {
    const bytes = fs.readFileSync(file);
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      persona_id TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      redacted_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

    -- ── knowledge collections (RAG) ────────────────────────────────
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      embedding_model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      -- embedding stored as JSON array of floats; sql.js has no BLOB
      -- arithmetic and we keep cosine similarity in JS anyway.
      embedding TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_collection ON chunks(collection_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

    -- ── thread ↔ collection links ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS thread_collections (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, collection_id)
    );

    -- ── artifacts (canvas side panel) ──────────────────────────────
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'txt',
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id);

    -- ── cross-session memory ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      text TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope, updated_at);

    -- ── agent runs + steps ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      goal TEXT NOT NULL,
      model TEXT NOT NULL,
      autonomy TEXT NOT NULL,
      status TEXT NOT NULL,
      step_budget INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id, started_at);

    CREATE TABLE IF NOT EXISTS agent_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      tool_error TEXT,
      tool_approved INTEGER,
      tool_duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, ordinal);

    -- ── research runs ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      sub_questions TEXT NOT NULL DEFAULT '[]',
      sources TEXT NOT NULL DEFAULT '[]',
      report TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_research_runs_thread ON research_runs(thread_id, started_at);

    -- ── scheduled tasks ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger TEXT NOT NULL,
      action TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_run_at INTEGER,
      last_status TEXT,
      last_error TEXT,
      next_run_at INTEGER
    );

    -- ── oauth / connectors ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS connector_tokens (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      scopes TEXT NOT NULL DEFAULT '[]',
      expires_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: older installs don't have threads.deleted_at. Add it
  // idempotently; SQLite throws "duplicate column name" if it's already
  // there, which we swallow so the migration is safe to re-run.
  try { db.exec(`ALTER TABLE threads ADD COLUMN deleted_at INTEGER`); }
  catch { /* column already exists — fine */ }

  // Housekeeping: sweep any soft-deleted thread older than 7 days so
  // the trash doesn't grow forever.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try { db.run(`DELETE FROM threads WHERE deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]); }
  catch { /* table may be brand new */ }

  // Persist immediately so the file always exists on disk.
  persist();
  logger.info('database initialised at', file);
}

/** Flush the in-memory db to disk. Cheap for our scale. */
export function persist(): void {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath(), Buffer.from(data));
  } catch (err) {
    logger.error('failed to persist database', err);
  }
}

function ensureDb(): Database {
  if (!db) throw new Error('Database not initialised — call initDatabase() first');
  return db;
}

// ─── threads ────────────────────────────────────────────────────────

export function createThread(title: string, personaId: string | null, model: string | null): DbThread {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO threads (id, title, persona_id, model, created_at, updated_at, pinned) VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, title, personaId, model, now, now],
  );
  persist();
  return {
    id,
    title,
    personaId,
    model,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    pinned: false,
  };
}

export function listThreads(): DbThread[] {
  const d = ensureDb();
  // Soft-deleted threads (deleted_at IS NOT NULL) are hidden from the
  // regular list — they still live in the DB for up to 7 days so the
  // "Undo delete" toast in the renderer has something to restore.
  const rows = d.exec(`
    SELECT t.id, t.title, t.persona_id, t.model, t.created_at, t.updated_at, t.pinned,
           (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
    FROM threads t
    WHERE t.deleted_at IS NULL
    ORDER BY t.pinned DESC, t.updated_at DESC
  `);
  if (rows.length === 0) return [];
  return rows[0].values.map((row) => ({
    id: row[0] as string,
    title: row[1] as string,
    personaId: (row[2] as string) ?? null,
    model: (row[3] as string) ?? null,
    createdAt: row[4] as number,
    updatedAt: row[5] as number,
    pinned: (row[6] as number) === 1,
    messageCount: row[7] as number,
  }));
}

export function getThread(id: string): DbThread | null {
  const d = ensureDb();
  // Include soft-deleted — the renderer's undo path needs to fetch a
  // thread by id even while it's in the 7-day trash window.
  const rows = d.exec(
    `SELECT id, title, persona_id, model, created_at, updated_at, pinned,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = threads.id) AS message_count
     FROM threads WHERE id = ?`,
    [id],
  );
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  const row = rows[0].values[0];
  return {
    id: row[0] as string,
    title: row[1] as string,
    personaId: (row[2] as string) ?? null,
    model: (row[3] as string) ?? null,
    createdAt: row[4] as number,
    updatedAt: row[5] as number,
    pinned: (row[6] as number) === 1,
    messageCount: row[7] as number,
  };
}

export function updateThread(
  id: string,
  patch: Partial<Pick<DbThread, 'title' | 'personaId' | 'model' | 'pinned'>>,
): void {
  const d = ensureDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.personaId !== undefined) { fields.push('persona_id = ?'); values.push(patch.personaId); }
  if (patch.model !== undefined) { fields.push('model = ?'); values.push(patch.model); }
  if (patch.pinned !== undefined) { fields.push('pinned = ?'); values.push(patch.pinned ? 1 : 0); }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  d.run(`UPDATE threads SET ${fields.join(', ')} WHERE id = ?`, values);
  persist();
}

/**
 * Soft-delete: marks the thread with deleted_at = now(). The row (and
 * its messages) stay on disk for up to 7 days; the startup sweep in
 * initDatabase() hard-deletes anything past that. A companion
 * `restoreThread()` clears the flag for the "undo" toast path.
 */
export function deleteThread(id: string): void {
  const d = ensureDb();
  d.run(`UPDATE threads SET deleted_at = ? WHERE id = ?`, [Date.now(), id]);
  persist();
}

/** Restore a soft-deleted thread — clears the deleted_at flag. Used by the undo toast. */
export function restoreThread(id: string): void {
  const d = ensureDb();
  d.run(`UPDATE threads SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [Date.now(), id]);
  persist();
}

/** Hard-delete a thread and its messages. Used only by the "empty trash" / sweep paths. */
export function purgeThread(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM threads WHERE id = ?`, [id]);
  persist();
}

// ─── messages ──────────────────────────────────────────────────────

export function addMessage(
  threadId: string,
  role: Role,
  content: string,
  redactedCount: number,
  attachments: Omit<DbAttachment, 'id' | 'messageId'>[] = [],
): DbMessage {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO messages (id, thread_id, role, content, created_at, redacted_count) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, threadId, role, content, now, redactedCount],
  );
  d.run(`UPDATE threads SET updated_at = ? WHERE id = ?`, [now, threadId]);

  const persistedAttachments: DbAttachment[] = [];
  for (const a of attachments) {
    const aid = randomUUID();
    d.run(
      `INSERT INTO attachments (id, message_id, kind, filename, mime_type, size_bytes, content) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [aid, id, a.kind, a.filename, a.mimeType, a.sizeBytes, a.content],
    );
    persistedAttachments.push({ id: aid, messageId: id, ...a });
  }

  persist();
  return {
    id,
    threadId,
    role,
    content,
    createdAt: now,
    redactedCount,
    attachments: persistedAttachments,
  };
}

/**
 * Attach an inline blob to an existing message. Used by the sync pull
 * path when reconstructing attachments from remote chunks. No-ops if
 * the parent message doesn't exist locally yet (the thread/message
 * replay must run first).
 */
export function addAttachmentRaw(p: {
  messageId: string;
  kind: DbAttachment['kind'];
  filename: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
}): void {
  const d = ensureDb();
  // Guard: only attach to messages that exist locally.
  const exists = d.exec(`SELECT 1 FROM messages WHERE id = ?`, [p.messageId]);
  if (exists.length === 0 || exists[0].values.length === 0) return;
  const aid = randomUUID();
  d.run(
    `INSERT INTO attachments (id, message_id, kind, filename, mime_type, size_bytes, content) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [aid, p.messageId, p.kind, p.filename, p.mimeType, p.sizeBytes, p.content],
  );
  persist();
}

export function listMessages(threadId: string): DbMessage[] {
  const d = ensureDb();
  const msgRows = d.exec(
    `SELECT id, thread_id, role, content, created_at, redacted_count
     FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
    [threadId],
  );
  if (msgRows.length === 0) return [];

  const messages: DbMessage[] = msgRows[0].values.map((r) => ({
    id: r[0] as string,
    threadId: r[1] as string,
    role: r[2] as Role,
    content: r[3] as string,
    createdAt: r[4] as number,
    redactedCount: r[5] as number,
    attachments: [],
  }));

  // Pull all attachments for the thread in one shot, then bucket them.
  const attRows = d.exec(
    `SELECT a.id, a.message_id, a.kind, a.filename, a.mime_type, a.size_bytes, a.content
     FROM attachments a
     JOIN messages m ON m.id = a.message_id
     WHERE m.thread_id = ?`,
    [threadId],
  );
  if (attRows.length > 0) {
    const byMessage = new Map<string, DbAttachment[]>();
    for (const r of attRows[0].values) {
      const a: DbAttachment = {
        id: r[0] as string,
        messageId: r[1] as string,
        kind: r[2] as DbAttachment['kind'],
        filename: r[3] as string,
        mimeType: r[4] as string,
        sizeBytes: r[5] as number,
        content: r[6] as string,
      };
      const list = byMessage.get(a.messageId) ?? [];
      list.push(a);
      byMessage.set(a.messageId, list);
    }
    for (const m of messages) {
      m.attachments = byMessage.get(m.id) ?? [];
    }
  }

  return messages;
}

export function deleteMessage(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM messages WHERE id = ?`, [id]);
  persist();
}

// ─── knowledge collections ──────────────────────────────────────────

export function createCollection(name: string, description: string, embeddingModel: string): KnowledgeCollection {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO collections (id, name, description, embedding_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, description, embeddingModel, now, now],
  );
  persist();
  return {
    id, name, description, embeddingModel,
    createdAt: now, updatedAt: now,
    documentCount: 0, chunkCount: 0,
  };
}

export function listCollections(): KnowledgeCollection[] {
  const d = ensureDb();
  const rows = d.exec(`
    SELECT c.id, c.name, c.description, c.embedding_model, c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM documents WHERE collection_id = c.id) AS doc_count,
      (SELECT COUNT(*) FROM chunks WHERE collection_id = c.id) AS chunk_count
    FROM collections c
    ORDER BY c.updated_at DESC
  `);
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    name: r[1] as string,
    description: r[2] as string,
    embeddingModel: r[3] as string,
    createdAt: r[4] as number,
    updatedAt: r[5] as number,
    documentCount: r[6] as number,
    chunkCount: r[7] as number,
  }));
}

export function deleteCollection(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM collections WHERE id = ?`, [id]);
  persist();
}

export function touchCollection(id: string): void {
  const d = ensureDb();
  d.run(`UPDATE collections SET updated_at = ? WHERE id = ?`, [Date.now(), id]);
  persist();
}

export function listDocuments(collectionId: string): KnowledgeDocument[] {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT d.id, d.collection_id, d.filename, d.mime_type, d.size_bytes, d.created_at,
            (SELECT COUNT(*) FROM chunks WHERE document_id = d.id) AS chunk_count
     FROM documents d
     WHERE d.collection_id = ?
     ORDER BY d.created_at DESC`,
    [collectionId],
  );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    collectionId: r[1] as string,
    filename: r[2] as string,
    mimeType: r[3] as string,
    sizeBytes: r[4] as number,
    createdAt: r[5] as number,
    chunkCount: r[6] as number,
  }));
}

export function createDocument(
  collectionId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
): KnowledgeDocument {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO documents (id, collection_id, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, collectionId, filename, mimeType, sizeBytes, now],
  );
  persist();
  return { id, collectionId, filename, mimeType, sizeBytes, createdAt: now, chunkCount: 0 };
}

export function deleteDocument(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM documents WHERE id = ?`, [id]);
  persist();
}

export function insertChunks(
  collectionId: string,
  documentId: string,
  chunks: { ordinal: number; text: string; embedding: number[] }[],
): void {
  const d = ensureDb();
  for (const c of chunks) {
    d.run(
      `INSERT INTO chunks (id, document_id, collection_id, ordinal, text, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), documentId, collectionId, c.ordinal, c.text, JSON.stringify(c.embedding)],
    );
  }
  persist();
}

/**
 * Brute-force cosine similarity over all chunks in the given collections.
 * For our scale (a few thousand chunks of ~800 tokens each) this runs in
 * a handful of milliseconds — no need for a vector index extension.
 */
export function searchChunks(
  collectionIds: string[],
  queryEmbedding: number[],
  topK: number,
): KnowledgeChunk[] {
  if (collectionIds.length === 0) return [];
  const d = ensureDb();
  const placeholders = collectionIds.map(() => '?').join(',');
  const rows = d.exec(
    `SELECT c.id, c.document_id, c.collection_id, c.ordinal, c.text, c.embedding, doc.filename
     FROM chunks c
     JOIN documents doc ON doc.id = c.document_id
     WHERE c.collection_id IN (${placeholders})`,
    collectionIds,
  );
  if (rows.length === 0) return [];

  const qNorm = norm(queryEmbedding);
  const scored: KnowledgeChunk[] = rows[0].values.map((r) => {
    const emb = JSON.parse(r[5] as string) as number[];
    const score = dot(emb, queryEmbedding) / ((norm(emb) * qNorm) || 1);
    return {
      id: r[0] as string,
      documentId: r[1] as string,
      collectionId: r[2] as string,
      ordinal: r[3] as number,
      text: r[4] as string,
      filename: r[6] as string,
      score,
    };
  });

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.slice(0, topK);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

// ─── thread ↔ collection links ─────────────────────────────────────

export function attachCollectionToThread(threadId: string, collectionId: string): void {
  const d = ensureDb();
  d.run(
    `INSERT OR IGNORE INTO thread_collections (thread_id, collection_id) VALUES (?, ?)`,
    [threadId, collectionId],
  );
  persist();
}

export function detachCollectionFromThread(threadId: string, collectionId: string): void {
  const d = ensureDb();
  d.run(
    `DELETE FROM thread_collections WHERE thread_id = ? AND collection_id = ?`,
    [threadId, collectionId],
  );
  persist();
}

export function listThreadCollections(threadId: string): string[] {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT collection_id FROM thread_collections WHERE thread_id = ?`,
    [threadId],
  );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => r[0] as string);
}

// ─── artifacts ──────────────────────────────────────────────────────

export function createArtifact(
  threadId: string | null,
  title: string,
  kind: ArtifactKind,
  language: string,
  content: string,
): Artifact {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO artifacts (id, thread_id, title, kind, language, content, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, threadId, title, kind, language, content, now, now],
  );
  d.run(
    `INSERT INTO artifact_versions (id, artifact_id, version, content, created_at) VALUES (?, ?, 1, ?, ?)`,
    [randomUUID(), id, content, now],
  );
  persist();
  return {
    id, threadId, title, kind, language, content,
    version: 1, createdAt: now, updatedAt: now,
  };
}

export function updateArtifact(id: string, content: string): Artifact | null {
  const d = ensureDb();
  const existing = getArtifact(id);
  if (!existing) return null;
  const nextVersion = existing.version + 1;
  const now = Date.now();
  d.run(
    `UPDATE artifacts SET content = ?, version = ?, updated_at = ? WHERE id = ?`,
    [content, nextVersion, now, id],
  );
  d.run(
    `INSERT INTO artifact_versions (id, artifact_id, version, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), id, nextVersion, content, now],
  );
  persist();
  return { ...existing, content, version: nextVersion, updatedAt: now };
}

export function getArtifact(id: string): Artifact | null {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT id, thread_id, title, kind, language, content, version, created_at, updated_at
     FROM artifacts WHERE id = ?`,
    [id],
  );
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  const r = rows[0].values[0];
  return {
    id: r[0] as string,
    threadId: (r[1] as string) ?? null,
    title: r[2] as string,
    kind: r[3] as ArtifactKind,
    language: r[4] as string,
    content: r[5] as string,
    version: r[6] as number,
    createdAt: r[7] as number,
    updatedAt: r[8] as number,
  };
}

export function listArtifacts(threadId?: string): Artifact[] {
  const d = ensureDb();
  const rows = threadId
    ? d.exec(
        `SELECT id, thread_id, title, kind, language, content, version, created_at, updated_at
         FROM artifacts WHERE thread_id = ? ORDER BY updated_at DESC`,
        [threadId],
      )
    : d.exec(
        `SELECT id, thread_id, title, kind, language, content, version, created_at, updated_at
         FROM artifacts ORDER BY updated_at DESC LIMIT 200`,
      );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    threadId: (r[1] as string) ?? null,
    title: r[2] as string,
    kind: r[3] as ArtifactKind,
    language: r[4] as string,
    content: r[5] as string,
    version: r[6] as number,
    createdAt: r[7] as number,
    updatedAt: r[8] as number,
  }));
}

export function deleteArtifact(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM artifacts WHERE id = ?`, [id]);
  persist();
}

// ─── memory ─────────────────────────────────────────────────────────

export function addMemoryEntry(
  scope: MemoryScope,
  text: string,
  tags: string[] = [],
  pinned: boolean = false,
  embedding?: number[],
): MemoryEntry {
  const d = ensureDb();
  const id = randomUUID();
  const now = Date.now();
  d.run(
    `INSERT INTO memory (id, scope, text, tags, pinned, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, scope, text, JSON.stringify(tags), pinned ? 1 : 0,
     embedding ? JSON.stringify(embedding) : null, now, now],
  );
  persist();
  return { id, scope, text, tags, pinned, embedding, createdAt: now, updatedAt: now };
}

export function listMemory(scope?: MemoryScope, limit = 200): MemoryEntry[] {
  const d = ensureDb();
  const rows = scope
    ? d.exec(
        `SELECT id, scope, text, tags, pinned, embedding, created_at, updated_at
         FROM memory WHERE scope = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
        [scope, limit],
      )
    : d.exec(
        `SELECT id, scope, text, tags, pinned, embedding, created_at, updated_at
         FROM memory ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
        [limit],
      );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    scope: r[1] as MemoryScope,
    text: r[2] as string,
    tags: safeJsonArray(r[3] as string),
    pinned: (r[4] as number) === 1,
    embedding: r[5] ? (JSON.parse(r[5] as string) as number[]) : undefined,
    createdAt: r[6] as number,
    updatedAt: r[7] as number,
  }));
}

export function deleteMemory(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM memory WHERE id = ?`, [id]);
  persist();
}

export function searchMemoryByEmbedding(query: number[], topK: number): MemoryEntry[] {
  const all = listMemory(undefined, 1000).filter((m) => m.embedding);
  if (all.length === 0) return [];
  const qn = norm(query);
  const scored = all
    .map((m) => ({
      m,
      score: dot(m.embedding!, query) / ((norm(m.embedding!) * qn) || 1),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.m);
}

function safeJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ─── agent runs ─────────────────────────────────────────────────────

export function createAgentRun(run: Omit<AgentRun, 'startedAt' | 'status'> & { status?: AgentRunStatus }): AgentRun {
  const d = ensureDb();
  const now = Date.now();
  const status: AgentRunStatus = run.status ?? 'running';
  d.run(
    `INSERT INTO agent_runs (id, thread_id, goal, model, autonomy, status, step_budget, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [run.id, run.threadId, run.goal, run.model, run.autonomy, status, run.stepBudget, now],
  );
  persist();
  return { ...run, status, startedAt: now };
}

export function updateAgentRun(id: string, patch: Partial<AgentRun>): void {
  const d = ensureDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.summary !== undefined) { fields.push('summary = ?'); values.push(patch.summary); }
  if (patch.endedAt !== undefined) { fields.push('ended_at = ?'); values.push(patch.endedAt); }
  if (fields.length === 0) return;
  values.push(id);
  d.run(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`, values);
  persist();
}

export function addAgentStep(step: AgentStep): void {
  const d = ensureDb();
  d.run(
    `INSERT INTO agent_steps (id, run_id, ordinal, kind, content, tool_name, tool_args, tool_result, tool_error, tool_approved, tool_duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      step.id,
      step.runId,
      step.ordinal,
      step.kind,
      step.content,
      step.tool?.name ?? null,
      step.tool ? JSON.stringify(step.tool.args) : null,
      step.tool?.result ?? null,
      step.tool?.error ?? null,
      step.tool ? (step.tool.approved ? 1 : 0) : null,
      step.tool?.durationMs ?? null,
      step.createdAt,
    ],
  );
  persist();
}

export function listAgentRuns(threadId?: string, limit = 50): AgentRun[] {
  const d = ensureDb();
  const rows = threadId
    ? d.exec(
        `SELECT id, thread_id, goal, model, autonomy, status, step_budget, started_at, ended_at, summary
         FROM agent_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT ?`,
        [threadId, limit],
      )
    : d.exec(
        `SELECT id, thread_id, goal, model, autonomy, status, step_budget, started_at, ended_at, summary
         FROM agent_runs ORDER BY started_at DESC LIMIT ?`,
        [limit],
      );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    threadId: r[1] as string,
    goal: r[2] as string,
    model: r[3] as string,
    autonomy: r[4] as AgentRun['autonomy'],
    status: r[5] as AgentRunStatus,
    stepBudget: r[6] as number,
    startedAt: r[7] as number,
    endedAt: (r[8] as number) ?? undefined,
    summary: (r[9] as string) ?? undefined,
  }));
}

export function listAgentSteps(runId: string): AgentStep[] {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT id, run_id, ordinal, kind, content, tool_name, tool_args, tool_result, tool_error, tool_approved, tool_duration_ms, created_at
     FROM agent_steps WHERE run_id = ? ORDER BY ordinal ASC`,
    [runId],
  );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    runId: r[1] as string,
    ordinal: r[2] as number,
    kind: r[3] as AgentStep['kind'],
    content: r[4] as string,
    tool: r[5]
      ? {
          name: r[5] as string,
          args: r[6] ? JSON.parse(r[6] as string) : {},
          result: (r[7] as string) ?? undefined,
          error: (r[8] as string) ?? undefined,
          approved: (r[9] as number) === 1,
          durationMs: (r[10] as number) ?? 0,
        }
      : undefined,
    createdAt: r[11] as number,
  }));
}

// ─── research runs ──────────────────────────────────────────────────

export function createResearchRun(run: ResearchRun): void {
  const d = ensureDb();
  d.run(
    `INSERT INTO research_runs (id, thread_id, question, model, status, sub_questions, sources, report, started_at, ended_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id, run.threadId, run.question, run.model, run.status,
      JSON.stringify(run.subQuestions), JSON.stringify(run.sources),
      run.report ?? null, run.startedAt, run.endedAt ?? null, run.error ?? null,
    ],
  );
  persist();
}

export function updateResearchRun(id: string, patch: Partial<ResearchRun>): void {
  const d = ensureDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.subQuestions !== undefined) { fields.push('sub_questions = ?'); values.push(JSON.stringify(patch.subQuestions)); }
  if (patch.sources !== undefined) { fields.push('sources = ?'); values.push(JSON.stringify(patch.sources)); }
  if (patch.report !== undefined) { fields.push('report = ?'); values.push(patch.report); }
  if (patch.endedAt !== undefined) { fields.push('ended_at = ?'); values.push(patch.endedAt); }
  if (patch.error !== undefined) { fields.push('error = ?'); values.push(patch.error); }
  if (fields.length === 0) return;
  values.push(id);
  d.run(`UPDATE research_runs SET ${fields.join(', ')} WHERE id = ?`, values);
  persist();
}

export function listResearchRuns(threadId?: string, limit = 50): ResearchRun[] {
  const d = ensureDb();
  const rows = threadId
    ? d.exec(
        `SELECT id, thread_id, question, model, status, sub_questions, sources, report, started_at, ended_at, error
         FROM research_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT ?`,
        [threadId, limit],
      )
    : d.exec(
        `SELECT id, thread_id, question, model, status, sub_questions, sources, report, started_at, ended_at, error
         FROM research_runs ORDER BY started_at DESC LIMIT ?`,
        [limit],
      );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    threadId: r[1] as string,
    question: r[2] as string,
    model: r[3] as string,
    status: r[4] as ResearchStage,
    subQuestions: JSON.parse((r[5] as string) || '[]') as string[],
    sources: JSON.parse((r[6] as string) || '[]') as ResearchSource[],
    report: (r[7] as string) ?? undefined,
    startedAt: r[8] as number,
    endedAt: (r[9] as number) ?? undefined,
    error: (r[10] as string) ?? undefined,
  }));
}

// ─── scheduled tasks ────────────────────────────────────────────────

export function saveScheduledTask(task: ScheduledTask): void {
  const d = ensureDb();
  d.run(
    `INSERT OR REPLACE INTO scheduled_tasks (id, name, enabled, trigger, action, model, created_at, last_run_at, last_status, last_error, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.name,
      task.enabled ? 1 : 0,
      JSON.stringify(task.trigger),
      JSON.stringify(task.action),
      task.model,
      task.createdAt,
      task.lastRunAt ?? null,
      task.lastStatus ?? null,
      task.lastError ?? null,
      task.nextRunAt ?? null,
    ],
  );
  persist();
}

export function listScheduledTasks(): ScheduledTask[] {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT id, name, enabled, trigger, action, model, created_at, last_run_at, last_status, last_error, next_run_at
     FROM scheduled_tasks ORDER BY created_at DESC`,
  );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    name: r[1] as string,
    enabled: (r[2] as number) === 1,
    trigger: JSON.parse(r[3] as string),
    action: JSON.parse(r[4] as string),
    model: r[5] as string,
    createdAt: r[6] as number,
    lastRunAt: (r[7] as number) ?? undefined,
    lastStatus: ((r[8] as string) as 'ok' | 'error' | null) ?? undefined,
    lastError: (r[9] as string) ?? undefined,
    nextRunAt: (r[10] as number) ?? undefined,
  }));
}

export function deleteScheduledTask(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM scheduled_tasks WHERE id = ?`, [id]);
  persist();
}

// ─── connector tokens ──────────────────────────────────────────────

export interface StoredConnectorToken {
  id: string;
  account: string;
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt?: number;
  updatedAt: number;
}

export function saveConnectorToken(t: StoredConnectorToken): void {
  const d = ensureDb();
  d.run(
    `INSERT OR REPLACE INTO connector_tokens (id, account, access_token, refresh_token, token_type, scopes, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.id, t.account, t.accessToken, t.refreshToken ?? null,
      t.tokenType, JSON.stringify(t.scopes), t.expiresAt ?? null, t.updatedAt,
    ],
  );
  persist();
}

export function getConnectorToken(id: string): StoredConnectorToken | null {
  const d = ensureDb();
  const rows = d.exec(
    `SELECT id, account, access_token, refresh_token, token_type, scopes, expires_at, updated_at
     FROM connector_tokens WHERE id = ?`,
    [id],
  );
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  const r = rows[0].values[0];
  return {
    id: r[0] as string,
    account: r[1] as string,
    accessToken: r[2] as string,
    refreshToken: (r[3] as string) ?? undefined,
    tokenType: r[4] as string,
    scopes: JSON.parse((r[5] as string) || '[]') as string[],
    expiresAt: (r[6] as number) ?? undefined,
    updatedAt: r[7] as number,
  };
}

export function deleteConnectorToken(id: string): void {
  const d = ensureDb();
  d.run(`DELETE FROM connector_tokens WHERE id = ?`, [id]);
  persist();
}

export function searchMessages(query: string, limit = 50): DbMessage[] {
  const d = ensureDb();
  const like = `%${query.toLowerCase()}%`;
  const rows = d.exec(
    `SELECT id, thread_id, role, content, created_at, redacted_count
     FROM messages
     WHERE LOWER(content) LIKE ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [like, limit],
  );
  if (rows.length === 0) return [];
  return rows[0].values.map((r) => ({
    id: r[0] as string,
    threadId: r[1] as string,
    role: r[2] as Role,
    content: r[3] as string,
    createdAt: r[4] as number,
    redactedCount: r[5] as number,
    attachments: [],
  }));
}
