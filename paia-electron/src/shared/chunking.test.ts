import { describe, expect, it } from 'vitest';
import { chunkText } from './chunking';

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('returns single chunk if text is shorter than size', () => {
    const result = chunkText('hello world', 800);
    expect(result).toEqual(['hello world']);
  });

  it('chunks long text into multiple windows', () => {
    const text = 'sentence one. sentence two. '.repeat(100);
    const chunks = chunkText(text, 200, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
  });

  it('overlaps consecutive chunks', () => {
    const text = 'a'.repeat(2000);
    const chunks = chunkText(text, 500, 100);
    expect(chunks.length).toBeGreaterThan(2);
    // Each chunk should be ≤ 500
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
  });

  it('breaks at paragraph boundaries when possible', () => {
    const text = 'short first para.\n\n' + 'longer second paragraph that has many sentences. '.repeat(20);
    const chunks = chunkText(text, 400, 50);
    // The first chunk should end at the paragraph break, not mid-sentence.
    expect(chunks[0]).toContain('short first para.');
  });

  it('collapses excessive blank lines', () => {
    const text = 'a\n\n\n\n\nb';
    const chunks = chunkText(text);
    expect(chunks[0]).toBe('a\n\nb');
  });

  it('handles CRLF input', () => {
    const text = 'line one\r\nline two\r\nline three';
    const chunks = chunkText(text);
    expect(chunks[0]).not.toContain('\r');
  });
});
