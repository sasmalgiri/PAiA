// Artifacts (Canvas) — structured documents the agent or user can
// iterate on in a side panel. Anything the LLM would normally dump
// into a monolithic code block (a file, a draft email, a plot spec)
// is better as an artifact: versioned, diffable, copyable, and
// pin-able to a thread.
//
// The store is a thin facade over db.ts so the IPC / agent layers
// have a stable import surface.

import * as db from './db';
import { requireFeature } from './license';
import type { Artifact, ArtifactKind } from '../shared/types';

export function create(
  threadId: string | null,
  title: string,
  kind: ArtifactKind,
  language: string,
  content: string,
): Artifact {
  requireFeature('canvas');
  return db.createArtifact(threadId, title, kind, language, content);
}

export function update(id: string, content: string): Artifact | null {
  return db.updateArtifact(id, content);
}

export function get(id: string): Artifact | null {
  return db.getArtifact(id);
}

export function list(threadId?: string): Artifact[] {
  return db.listArtifacts(threadId);
}

export function remove(id: string): void {
  db.deleteArtifact(id);
}

/** Guess a reasonable artifact kind + language from a filename/path. */
export function kindForFilename(filename: string): { kind: ArtifactKind; language: string } {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const table: Record<string, { kind: ArtifactKind; language: string }> = {
    md: { kind: 'markdown', language: 'md' },
    markdown: { kind: 'markdown', language: 'md' },
    html: { kind: 'html', language: 'html' },
    htm: { kind: 'html', language: 'html' },
    svg: { kind: 'svg', language: 'svg' },
    json: { kind: 'json', language: 'json' },
    ts: { kind: 'code', language: 'ts' },
    tsx: { kind: 'code', language: 'tsx' },
    js: { kind: 'code', language: 'js' },
    jsx: { kind: 'code', language: 'jsx' },
    py: { kind: 'code', language: 'python' },
    rs: { kind: 'code', language: 'rust' },
    go: { kind: 'code', language: 'go' },
    java: { kind: 'code', language: 'java' },
    c: { kind: 'code', language: 'c' },
    cpp: { kind: 'code', language: 'cpp' },
    cs: { kind: 'code', language: 'csharp' },
    rb: { kind: 'code', language: 'ruby' },
    sh: { kind: 'code', language: 'bash' },
    sql: { kind: 'code', language: 'sql' },
  };
  return table[ext] ?? { kind: 'code', language: 'txt' };
}
