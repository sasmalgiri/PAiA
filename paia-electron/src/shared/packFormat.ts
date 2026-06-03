// Knowledge stack pack format — pure / testable / no Electron deps.
//
// A pack is a JSON blob: { version, manifest, files, signature }, gzipped
// for transport. The signature is Ed25519 over canonical(version + manifest
// + files), reusing PAIA_PUBLIC_KEY as the root of trust (one trust chain
// for licenses AND packs — simpler operationally; if it leaks, both are
// affected anyway).
//
// JSON+base64+gzip (no tar dependency) was chosen over a tar archive:
//   - Tar would need either a parser dep or ~150 lines of hand-rolled
//     header decoding. Either is more risky than JSON.parse.
//   - Pack sizes are bounded (<50 MB typical) so loading the whole thing
//     into memory is fine — no streaming needed.
//   - Base64 adds ~33% overhead, well worth the simplicity.
//   - Makes packs trivially inspectable: gunzip + jq.

export const PACK_FORMAT_VERSION = 1 as const;

export type PackKind = 'vertical' | 'persona-only' | 'knowledge-only';
export type PackTier = 'free' | 'pro' | 'team' | 'legal';

export interface PackManifest {
  id: string;                    // e.g. 'paia-legal', 'paia-eng'
  name: string;                  // e.g. 'PAiA Legal'
  version: string;               // semver, e.g. '1.0.0'
  description: string;
  author: { name: string; url?: string };
  publishedAt: number;           // epoch ms
  kind: PackKind;
  requiresTier?: PackTier;       // gate paid packs at install time
  contents: {
    personaCount: number;
    collectionCount: number;
    totalDocCount: number;
  };
  paiaMinVersion?: string;       // semver — refuse install on older app
  ollamaModels?: string[];       // models the pack expects (warn if missing)
}

export interface PackFilePersona {
  filename: string;              // 'personas/<id>.json'
  /** Persona JSON as a string. Matches the Persona shape from shared/types,
   *  but parsed late so the format module stays Persona-free. */
  content: string;
}

export interface PackFileDocument {
  filename: string;              // original filename, used for display + RAG
  mimeType: string;
  bytesBase64: string;
}

export interface PackFileCollection {
  id: string;                    // stable id used to namespace the install
  meta: {
    name: string;
    description: string;
    embedModel: string;
  };
  documents: PackFileDocument[];
}

export interface PackFiles {
  personas?: PackFilePersona[];
  collections?: PackFileCollection[];
  /** Optional settings deltas (e.g. enforcement banner text). Applied
   *  only with user consent at install time. */
  defaults?: Record<string, unknown>;
  /** Optional readable rendered in the installer preview. */
  readme?: string;
}

export interface SignedPack {
  version: typeof PACK_FORMAT_VERSION;
  manifest: PackManifest;
  files: PackFiles;
  /** Base64 Ed25519 signature over canonicalize({ version, manifest, files }). */
  signature: string;
}

/**
 * Canonical JSON: deterministic key order so signatures are stable across
 * re-serialisations. Keys sorted lexicographically, no whitespace, identical
 * primitive encoding to JSON.stringify.
 *
 * NOTE: does not handle BigInt, undefined, or symbols — none of which appear
 * in pack payloads. If a future format needs them, extend deliberately.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
      .join(',') + '}';
  }
  return 'null';
}

/** Build the byte buffer that gets signed / verified. */
export function buildSignablePayload(bundle: Omit<SignedPack, 'signature'>): Buffer {
  return Buffer.from(canonicalize(bundle), 'utf-8');
}

/** Shape check + version check. Returns ok or a reason for the failure. */
export function validatePackShape(pack: unknown): { ok: true; pack: SignedPack } | { ok: false; reason: string } {
  if (!pack || typeof pack !== 'object') return { ok: false, reason: 'not an object' };
  const p = pack as Partial<SignedPack>;
  if (p.version !== PACK_FORMAT_VERSION) return { ok: false, reason: `unsupported pack version ${p.version}` };
  if (typeof p.signature !== 'string' || p.signature.length === 0) return { ok: false, reason: 'missing signature' };
  if (!p.manifest || typeof p.manifest !== 'object') return { ok: false, reason: 'missing manifest' };
  const m = p.manifest;
  for (const key of ['id', 'name', 'version', 'description'] as const) {
    if (typeof m[key] !== 'string' || (m[key] as string).length === 0) {
      return { ok: false, reason: `manifest.${key} missing or empty` };
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(m.id)) return { ok: false, reason: 'manifest.id must be kebab-case lowercase' };
  if (!/^\d+\.\d+\.\d+/.test(m.version)) return { ok: false, reason: 'manifest.version must be semver' };
  if (!m.author || typeof m.author.name !== 'string') return { ok: false, reason: 'manifest.author.name missing' };
  if (m.kind !== 'vertical' && m.kind !== 'persona-only' && m.kind !== 'knowledge-only') {
    return { ok: false, reason: 'manifest.kind invalid' };
  }
  if (!p.files || typeof p.files !== 'object') return { ok: false, reason: 'missing files' };
  return { ok: true, pack: p as SignedPack };
}

/**
 * Compare two semver-ish strings (major.minor.patch only). Returns
 *   -1 if a < b, 0 if equal, +1 if a > b.
 * Returns 0 on any parse failure — callers should treat "unknown" as
 * equivalent rather than refusing install.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').slice(0, 3).map((n) => parseInt(n, 10));
  const pb = b.split('.').slice(0, 3).map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = isNaN(pa[i]) ? 0 : pa[i];
    const bi = isNaN(pb[i]) ? 0 : pb[i];
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}
