// Pure text chunking for the RAG pipeline. Extracted into the shared
// folder so it can be unit-tested without pulling in Electron.

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 150;

/**
 * Splits text into overlapping windows. We chunk on character count
 * rather than tokens because (a) we don't want a tokenizer dependency
 * and (b) for embedding-time use, character count is a fine proxy.
 *
 * Tries to break at paragraph or sentence boundaries within each window
 * for more natural-reading chunks.
 */
export function chunkText(
  text: string,
  size = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= size) return [cleaned];

  const out: string[] = [];
  let pos = 0;
  while (pos < cleaned.length) {
    const end = Math.min(pos + size, cleaned.length);
    let breakAt = end;
    if (end < cleaned.length) {
      const lookback = cleaned.slice(pos, end);
      const para = lookback.lastIndexOf('\n\n');
      const sent = lookback.lastIndexOf('. ');
      const candidate = Math.max(para, sent);
      if (candidate > size * 0.5) breakAt = pos + candidate + 1;
    }
    out.push(cleaned.slice(pos, breakAt).trim());
    if (breakAt >= cleaned.length) break;
    pos = Math.max(0, breakAt - overlap);
  }
  return out;
}
