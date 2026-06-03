import { describe, expect, it } from 'vitest';
import {
  PACK_FORMAT_VERSION,
  canonicalize,
  buildSignablePayload,
  validatePackShape,
  compareVersions,
  type SignedPack,
} from './packFormat';

describe('canonicalize', () => {
  it('sorts keys deterministically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 1 })).toBe('{"a":1,"z":{"x":2,"y":1}}');
  });

  it('handles arrays element-order-preserved', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('encodes primitives consistently with JSON.stringify', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
  });

  it('emits the same string for two equivalent objects regardless of insertion order', () => {
    const a = { foo: 1, bar: { baz: [2, 3] }, qux: 'x' };
    const b = { qux: 'x', bar: { baz: [2, 3] }, foo: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('coerces non-finite numbers to null (matches strict JSON)', () => {
    expect(canonicalize(NaN)).toBe('null');
    expect(canonicalize(Infinity)).toBe('null');
  });
});

describe('buildSignablePayload', () => {
  it('returns a deterministic buffer for the same input', () => {
    const bundle = {
      version: PACK_FORMAT_VERSION,
      manifest: {
        id: 'test', name: 'Test', version: '1.0.0', description: 'd',
        author: { name: 'a' }, publishedAt: 0, kind: 'vertical' as const,
        contents: { personaCount: 0, collectionCount: 0, totalDocCount: 0 },
      },
      files: { readme: 'hi' },
    };
    const a = buildSignablePayload(bundle);
    const b = buildSignablePayload(bundle);
    expect(a.equals(b)).toBe(true);
  });
});

describe('validatePackShape', () => {
  function basePack(): SignedPack {
    return {
      version: PACK_FORMAT_VERSION,
      manifest: {
        id: 'paia-test',
        name: 'Test Pack',
        version: '1.0.0',
        description: 'A test',
        author: { name: 'PAiA' },
        publishedAt: 0,
        kind: 'vertical',
        contents: { personaCount: 0, collectionCount: 0, totalDocCount: 0 },
      },
      files: {},
      signature: 'aGVsbG8=',
    };
  }

  it('accepts a well-formed pack', () => {
    const r = validatePackShape(basePack());
    expect(r.ok).toBe(true);
  });

  it('rejects null / non-object', () => {
    expect(validatePackShape(null).ok).toBe(false);
    expect(validatePackShape('hi').ok).toBe(false);
    expect(validatePackShape(42).ok).toBe(false);
  });

  it('rejects a version mismatch', () => {
    const p = { ...basePack(), version: 99 as unknown as 1 };
    const r = validatePackShape(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/version/);
  });

  it('rejects a missing signature', () => {
    const p = { ...basePack(), signature: '' };
    const r = validatePackShape(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/);
  });

  it('rejects a manifest with a missing required field', () => {
    const p = basePack();
    p.manifest.description = '';
    const r = validatePackShape(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/description/);
  });

  it('rejects a non-kebab-case id (prevents path-traversal-via-id)', () => {
    const p = basePack();
    p.manifest.id = 'PAIA_Legal' as string;
    const r1 = validatePackShape(p);
    expect(r1.ok).toBe(false);
    p.manifest.id = '../etc/shadow';
    const r2 = validatePackShape(p);
    expect(r2.ok).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const p = basePack();
    p.manifest.version = 'latest';
    const r = validatePackShape(p);
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid kind', () => {
    const p = basePack();
    (p.manifest as { kind: unknown }).kind = 'invalid';
    const r = validatePackShape(p);
    expect(r.ok).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders simple cases correctly', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('1.10.0', '1.2.0')).toBe(1);  // numeric, not lexicographic
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('returns 0 on garbage rather than throwing', () => {
    expect(compareVersions('abc', 'def')).toBe(0);
  });

  it('ignores suffixes after patch (so 1.0.0-beta == 1.0.0)', () => {
    // parseInt('0-beta', 10) === 0
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
  });
});
