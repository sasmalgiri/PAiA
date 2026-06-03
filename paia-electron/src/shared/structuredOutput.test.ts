import { describe, expect, it } from 'vitest';
import { extractJson, validateAgainst, describeSchema, type SchemaShape } from './structuredOutput';

describe('extractJson', () => {
  it('returns null for empty / non-string input', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('   ')).toBeNull();
    // @ts-expect-error testing runtime tolerance
    expect(extractJson(null)).toBeNull();
  });

  it('parses pure JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n{"personaIds": ["a", "b"], "reason": "x"}\n```';
    expect(extractJson(raw)).toEqual({ personaIds: ['a', 'b'], reason: 'x' });
  });

  it('strips unlabelled ``` fences', () => {
    const raw = '```\n{"k":42}\n```';
    expect(extractJson(raw)).toEqual({ k: 42 });
  });

  it('finds JSON inside a prose preamble', () => {
    const raw = 'Here is the JSON you asked for: {"a":1, "b":2}';
    expect(extractJson(raw)).toEqual({ a: 1, b: 2 });
  });

  it('finds JSON inside a prose postamble', () => {
    const raw = '{"a":1} Let me know if you need anything else.';
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it('handles nested objects and arrays', () => {
    const raw = 'Output: {"list":[{"id":"a","tags":["x","y"]}], "n": 3}';
    expect(extractJson(raw)).toEqual({ list: [{ id: 'a', tags: ['x', 'y'] }], n: 3 });
  });

  it('handles strings containing braces or brackets', () => {
    const raw = '{"q":"who said {hello}?","r":"answer with [n]"}';
    expect(extractJson(raw)).toEqual({ q: 'who said {hello}?', r: 'answer with [n]' });
  });

  it('handles escaped quotes inside strings', () => {
    const raw = '{"q":"she said \\"hi\\""}';
    expect(extractJson(raw)).toEqual({ q: 'she said "hi"' });
  });

  it('picks the largest valid candidate when there are multiple', () => {
    const raw = '{"a":1} ... actually meant: {"a":1,"b":2,"c":3}';
    expect(extractJson(raw)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('returns null on irrecoverably malformed JSON', () => {
    expect(extractJson('not json at all')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
  });

  it('parses a top-level array with prose', () => {
    const raw = 'Items: [1, 2, 3]';
    expect(extractJson(raw)).toEqual([1, 2, 3]);
  });
});

describe('validateAgainst', () => {
  it('validates primitive types', () => {
    expect(validateAgainst('hi', { kind: 'string' }).ok).toBe(true);
    expect(validateAgainst(42, { kind: 'number' }).ok).toBe(true);
    expect(validateAgainst(true, { kind: 'boolean' }).ok).toBe(true);
    expect(validateAgainst(42, { kind: 'string' }).ok).toBe(false);
    expect(validateAgainst(NaN, { kind: 'number' }).ok).toBe(false);
  });

  it('validates enums', () => {
    const schema: SchemaShape = { kind: 'enum', values: ['off', 'ask', 'auto'] };
    expect(validateAgainst('ask', schema).ok).toBe(true);
    expect(validateAgainst('maybe', schema).ok).toBe(false);
  });

  it('validates arrays element-by-element', () => {
    const schema: SchemaShape = { kind: 'array', items: { kind: 'string' } };
    expect(validateAgainst(['a', 'b'], schema).ok).toBe(true);
    const bad = validateAgainst(['a', 2], schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.path).toBe('[1]');
  });

  it('reports missing required fields with the path', () => {
    const schema: SchemaShape = {
      kind: 'object',
      fields: {
        personaIds: { schema: { kind: 'array', items: { kind: 'string' } } },
        reason: { schema: { kind: 'string' } },
      },
    };
    const r = validateAgainst({ personaIds: ['a'] }, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe('reason');
  });

  it('skips optional fields when absent', () => {
    const schema: SchemaShape = {
      kind: 'object',
      fields: {
        personaIds: { schema: { kind: 'array', items: { kind: 'string' } } },
        difficulty: { schema: { kind: 'enum', values: ['trivial', 'moderate', 'hard'] }, required: false },
      },
    };
    expect(validateAgainst({ personaIds: ['a'] }, schema).ok).toBe(true);
    expect(validateAgainst({ personaIds: ['a'], difficulty: 'hard' }, schema).ok).toBe(true);
    const bad = validateAgainst({ personaIds: ['a'], difficulty: 'impossible' }, schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.path).toBe('difficulty');
  });

  it('reports nested array element failures with full path', () => {
    const schema: SchemaShape = {
      kind: 'object',
      fields: {
        items: {
          schema: {
            kind: 'array',
            items: {
              kind: 'object',
              fields: {
                id: { schema: { kind: 'string' } },
              },
            },
          },
        },
      },
    };
    const r = validateAgainst({ items: [{ id: 'a' }, { id: 42 }] }, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe('items[1].id');
  });
});

describe('describeSchema', () => {
  it('produces a usable LLM hint', () => {
    const schema: SchemaShape = {
      kind: 'object',
      fields: {
        personaIds: { schema: { kind: 'array', items: { kind: 'string' } } },
        reason: { schema: { kind: 'string' } },
        difficulty: { schema: { kind: 'enum', values: ['trivial', 'moderate', 'hard'] }, required: false },
      },
    };
    const out = describeSchema(schema);
    expect(out).toContain('"personaIds": string[]');
    expect(out).toContain('"reason": string');
    expect(out).toContain('"difficulty"?:');
    expect(out).toContain('"trivial" | "moderate" | "hard"');
  });
});
